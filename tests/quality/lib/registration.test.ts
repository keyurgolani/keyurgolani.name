import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  interactionsOn,
  loadRegistrations,
  RegistrationError,
  validateSurface,
  validateUnit,
  type Interaction,
  type SurfaceRegistration,
} from './registration';

const LOGIN: SurfaceRegistration = {
  id: 'login',
  owner: '#2',
  profile: 'owner',
  routes: ['/studio/sign-in'],
  sources: ['apps/web/src/app/(studio)/studio/sign-in/**'],
  stateFixtures: [{ id: 'signed-out', query: {}, status: 200 }],
  performanceTier: 'light',
  auth: 'none',
  interactions: [
    { kind: 'status', name: 'Sign in', route: '/studio/sign-in', announces: 'Each state.' },
  ],
  primaryActions: ['Sign in'],
  notApplicable: [],
};

/** The problems validateSurface() finds in `exports`, or [] when it passes. */
function problems(exports: Record<string, unknown>, file = 'quality/surfaces/login.ts'): string[] {
  try {
    validateSurface(exports, file);
    return [];
  } catch (error) {
    assert.ok(error instanceof RegistrationError);
    return [...error.problems];
  }
}

test("the repository's registrations load and pass: #2's login page among them", async () => {
  const { surfaces, units } = await loadRegistrations();
  const login = surfaces.find((surface) => surface.id === 'login');
  assert.ok(login, 'quality/surfaces/login.ts registers login');
  assert.equal(login.profile, 'owner');
  assert.deepEqual(login.routes, ['/studio/sign-in']);
  assert.equal(login.auth, 'none');
  assert.ok(login.stateFixtures.length >= 1);
  assert.ok(Array.isArray(units));
});

test('a surface needs every field the contract lists', () => {
  assert.deepEqual(problems({ ...LOGIN }), []);
  for (const field of Object.keys(LOGIN)) {
    const { [field]: _gone, ...rest } = LOGIN as unknown as Record<string, unknown>;
    void _gone;
    assert.ok(
      problems(rest).some((problem) => problem.includes(`exports no ${field}`)),
      `without ${field}`,
    );
  }
});

test("a surface exports nothing the contract doesn't take", () => {
  assert.deepEqual(problems({ ...LOGIN, rows: ['default'] }), [
    "exports rows, which a registration doesn't take",
  ]);
});

test("a surface's id is its file's name, its routes are paths, and its values are the contract's", () => {
  assert.ok(problems({ ...LOGIN, id: 'sign-in' }).includes("id is login, the file's name"));
  assert.ok(problems({ ...LOGIN, routes: ['studio'] }).some((p) => p.includes("isn't a path")));
  assert.ok(problems({ ...LOGIN, routes: [] }).includes('routes names at least one'));
  assert.ok(
    problems({ ...LOGIN, profile: 'admin' }).some((p) => p.startsWith('profile is one of')),
  );
  assert.ok(problems({ ...LOGIN, auth: 'basic' }).some((p) => p.startsWith('auth is one of')));
  assert.ok(
    problems({ ...LOGIN, performanceTier: 'huge' }).some((p) => p.startsWith('performanceTier')),
  );
  assert.ok(
    problems({ ...LOGIN, stateFixtures: [] }).includes('stateFixtures lists at least one state'),
  );
  assert.ok(
    problems({
      ...LOGIN,
      stateFixtures: [
        { id: 'a', query: {}, status: 200 },
        { id: 'a', query: {}, status: 200 },
      ],
    }).some((p) => p.includes('listed twice')),
  );
});

test('a drag names its alternative, and a status change what it announces', () => {
  assert.ok(
    problems({
      ...LOGIN,
      interactions: [{ kind: 'drag', name: 'Focal point', route: '/studio' }],
    }).some((p) => p.includes('names its keyboard or single-pointer alternative')),
  );
  assert.ok(
    problems({ ...LOGIN, interactions: [{ kind: 'status', name: 'Save', route: '/studio' }] }).some(
      (p) => p.includes('says what its live region announces'),
    ),
  );
  assert.ok(
    problems({ ...LOGIN, interactions: [{ kind: 'hover', name: 'Menu', route: '/' }] }).some((p) =>
      p.startsWith('interactions[0].kind is one of'),
    ),
  );
});

test('an exclusion names exact cells with a reason, never a wildcard', () => {
  const exclude = (notApplicable: unknown) => problems({ ...LOGIN, notApplicable });
  assert.deepEqual(exclude([{ match: { viewport: '390x844' }, reason: 'Not on phones yet.' }]), []);
  assert.ok(
    exclude([{ match: { viewport: '*' }, reason: 'All.' }]).some((p) =>
      p.includes('never a wildcard'),
    ),
  );
  assert.ok(
    exclude([{ match: {}, reason: 'Nothing.' }]).some((p) => p.includes('names at least one')),
  );
  assert.ok(
    exclude([{ match: { tuple: 'x' }, reason: 'x' }]).some((p) => p.includes("isn't a cell field")),
  );
  assert.ok(exclude([{ match: { row: 'default' } }]).some((p) => p.includes('reason says why')));
  for (const reason of [' ', 'n/a', ' Not on phones yet.', 'Not on phones yet'])
    assert.ok(
      exclude([{ match: { row: 'default' }, reason }]).some((p) => p.includes('reason says why')),
      JSON.stringify(reason),
    );
});

test('a unit exports only interactions, primaryActions, and notApplicable', () => {
  const unit = validateUnit({ primaryActions: ['Open menu'] }, 'quality/units/fallback.ts');
  assert.equal(unit.id, 'fallback');
  assert.deepEqual(unit.primaryActions, ['Open menu']);
  assert.throws(
    () => validateUnit({ routes: ['/'] }, 'quality/units/fallback.ts'),
    /routes, which a registration/,
  );
  assert.throws(() => validateUnit({}, 'quality/units/fallback.ts'), /exports none of/);
});

test("a unit may say its composition is pending the distinct guards, with 'pending' and nothing else", async (t) => {
  const file = 'quality/units/spatial-bento.ts';
  assert.equal(validateUnit({ distinct: 'pending' }, file).distinct, 'pending');
  assert.equal(validateUnit({ notApplicable: [] }, file).distinct, undefined);
  for (const bad of ['done', 'Pending', '', true, null, ['pending'], { pending: true }]) {
    assert.throws(
      () => validateUnit({ notApplicable: [], distinct: bad }, file),
      /distinct is 'pending' while the composition waits for its redesign/,
      JSON.stringify(bad),
    );
  }
  // A bad value fails the plan: loadRegistrations() reads every unit and throws.
  const root = mkdtempSync(path.join(tmpdir(), 'quality-distinct-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'units'));
  writeFileSync(path.join(root, 'units', 'spatial-bento.ts'), "export const distinct = 'done';\n");
  await assert.rejects(loadRegistrations(root), (error: unknown) => {
    assert.ok(error instanceof RegistrationError);
    assert.match(error.message, /units\/spatial-bento\.ts is not a valid registration/);
    assert.match(error.message, /distinct is 'pending'/);
    return true;
  });
});

test("a unit may say its composition's coverage is pending, with 'pending' and nothing else", () => {
  const file = 'quality/units/spatial-bento.ts';
  assert.equal(validateUnit({ coverage: 'pending' }, file).coverage, 'pending');
  assert.equal(validateUnit({ notApplicable: [] }, file).coverage, undefined);
  for (const bad of ['done', 'Pending', '', true, null, ['pending']]) {
    assert.throws(
      () => validateUnit({ notApplicable: [], coverage: bad }, file),
      /coverage is 'pending' while the composition still uses shared renderers/,
      JSON.stringify(bad),
    );
  }
});

test("a unit's outlineKnown gives a reason and its own findings, each once", () => {
  const file = 'quality/units/obsidian-atelier.ts';
  const good = {
    reason: 'It shows a works section whole, one room a work, so the section has no frame.',
    findings: ['obsidian-atelier sparse / outline.frame projects'],
  };
  assert.deepEqual(validateUnit({ outlineKnown: good }, file).outlineKnown, good);
  assert.equal(validateUnit({ notApplicable: [] }, file).outlineKnown, undefined);
  const bad: [unknown, RegExp][] = [
    [null, /outlineKnown is an object with reason and findings/],
    [[], /outlineKnown is an object with reason and findings/],
    [{ ...good, reason: '' }, /outlineKnown\.reason says why/],
    [{ ...good, findings: [] }, /lists at least one finding: remove outlineKnown/],
    [
      { ...good, findings: ['editorial-evidence sparse / outline.frame projects'] },
      /not one of obsidian-atelier's own/,
    ],
    [
      { ...good, findings: [good.findings[0], good.findings[0]] },
      /lists obsidian-atelier sparse \/ outline\.frame projects twice/,
    ],
    [{ ...good, extra: 1 }, /outlineKnown has unknown fields: extra/],
  ];
  for (const [value, message] of bad) {
    assert.throws(
      () => validateUnit({ outlineKnown: value }, file),
      message,
      JSON.stringify(value),
    );
  }
});

test("a unit's contentRuled names each field once, each with its reason; one without a reason fails", () => {
  const file = 'quality/units/mission-control.ts';
  const good = {
    field: 'section(hero).greeting',
    reason: 'The status line opens the page, so it sets no greeting.',
  };
  assert.deepEqual(validateUnit({ contentRuled: [good] }, file).contentRuled, [good]);
  assert.equal(validateUnit({ notApplicable: [] }, file).contentRuled, undefined);
  const bad: [unknown, RegExp][] = [
    [[], /contentRuled lists at least one \{ field, reason \}/],
    [good, /contentRuled lists at least one/],
    [[{ field: good.field }], /contentRuled\[0\]\.reason says why/],
    [[{ ...good, reason: '' }], /contentRuled\[0\]\.reason says why/],
    [[{ ...good, reason: 'by design' }], /contentRuled\[0\]\.reason says why/],
    [[{ ...good, field: '' }], /contentRuled\[0\]\.field is a field pattern/],
    [[good, good], /contentRuled\[1\]\.field section\(hero\)\.greeting is ruled twice/],
    [[{ ...good, why: 'x' }], /contentRuled\[0\] has unknown fields: why/],
    [[null], /contentRuled\[0\] is an object/],
  ];
  for (const [value, message] of bad) {
    assert.throws(
      () => validateUnit({ contentRuled: value }, file),
      message,
      JSON.stringify(value),
    );
  }
});

test('a signed-in Studio surface may say it needs its script, with why; nothing else may', async () => {
  const file = 'quality/surfaces/studio.ts';
  const studio = {
    ...LOGIN,
    id: 'studio',
    routes: ['/studio'],
    auth: 'session',
    requiresScript: { reason: 'Studio draws its workspace with JavaScript.' },
  };
  assert.deepEqual(problems(studio, file), []);
  assert.deepEqual(validateSurface(studio, file).requiresScript, {
    reason: 'Studio draws its workspace with JavaScript.',
  });
  // The sign-in page is under /studio, and a visitor reaches it signed out: it may not.
  assert.ok(
    problems({ ...LOGIN, requiresScript: studio.requiresScript }).some((each) =>
      each.includes("its auth isn't session"),
    ),
  );
  // Without it, a surface's registration has none.
  assert.equal(
    validateSurface({ ...LOGIN }, 'quality/surfaces/login.ts').requiresScript,
    undefined,
  );
  // The reason is required, and says why in a sentence.
  for (const [bad, problem] of [
    [{}, 'requiresScript.reason says why'],
    [{ reason: '' }, 'requiresScript.reason says why'],
    [{ reason: 'Script.' }, 'requiresScript.reason says why'],
    [{ reason: 'Studio draws it.', expires: '2027-01-01' }, 'unknown fields: expires'],
    [true, 'requiresScript is an object'],
  ] as const) {
    assert.ok(
      problems({ ...studio, requiresScript: bad }, file).some((each) => each.includes(problem)),
      problem,
    );
  }
  // A surface whose pages aren't Studio's may not, and no composition may.
  assert.ok(
    problems({ ...studio, routes: ['/', '/studio'] }, file).some((each) =>
      each.includes("its routes aren't Studio's"),
    ),
  );
  assert.throws(
    () =>
      validateUnit(
        { requiresScript: { reason: 'It draws with JavaScript.' } },
        'quality/units/fallback.ts',
      ),
    /declares requiresScript, which only a Studio surface may/,
  );
  // Demo Studio (#9) has no session, and may too: under demo, at /studio, its one page.
  const demo = {
    ...studio,
    id: 'demo-studio',
    profile: 'demo',
    auth: 'none',
    routes: ['/studio'],
    requiresScript: { reason: 'Demo Studio keeps its changes in the browser with JavaScript.' },
  };
  assert.deepEqual(problems(demo, 'quality/surfaces/demo-studio.ts'), []);
  // Signed out anywhere else it may not: the sign-in page under any profile, any other
  // Studio path under demo, /studio under another profile, and no route at all.
  for (const [bad, what] of [
    [{ ...demo, routes: ['/studio/sign-in'] }, 'the sign-in page under demo'],
    [{ ...demo, routes: ['/studio', '/studio/sign-in'] }, 'the sign-in page beside /studio'],
    [{ ...demo, routes: ['/studio/preview'] }, 'another Studio page under demo'],
    [{ ...demo, profile: 'owner' }, '/studio signed out under owner'],
    [{ ...demo, profile: 'read-only' }, '/studio under read-only'],
    [
      { ...LOGIN, profile: 'demo', requiresScript: demo.requiresScript },
      'the login surface under demo',
    ],
    [{ ...demo, routes: [] }, 'no route'],
  ] as const) {
    assert.ok(
      problems(bad, 'quality/surfaces/demo-studio.ts').some((each) =>
        each.includes("its auth isn't session"),
      ),
      what,
    );
  }
  // The repository's Owner Studio declares it, with its reason, which its cells carry.
  const { surfaces } = await loadRegistrations();
  assert.match(
    surfaces.find((surface) => surface.id === 'studio')?.requiresScript?.reason ?? '',
    /JavaScript/,
  );
});

test("a surface's perfState names one of its states, and nothing else", () => {
  const file = 'quality/surfaces/studio.ts';
  const states = [
    { id: 'content', query: {}, status: 200 },
    { id: 'history', query: { task: 'history' }, status: 200 },
  ];
  const studio = { ...LOGIN, id: 'studio', routes: ['/studio'], stateFixtures: states };
  assert.deepEqual(problems({ ...studio, perfState: 'history' }, file), []);
  for (const bad of ['media', '', 7, null]) {
    assert.ok(
      problems({ ...studio, perfState: bad }, file).some((each) =>
        each.includes('perfState names one of stateFixtures'),
      ),
      String(bad),
    );
  }
});

test("a surface's framed says which cells cover its frame, the old framedContrast is refused, and only Demo Studio declares framed", async () => {
  const file = 'quality/surfaces/login.ts';
  const reason = "The frame's document is checked by its composition cells.";
  assert.deepEqual(problems({ ...LOGIN, framed: { reason } }, file), []);
  for (const [bad, problem] of [
    [{}, 'framed.reason names the cells'],
    [{ reason: 'Covered.' }, 'framed.reason names the cells'],
    [{ reason, extra: 1 }, 'framed has unknown fields: extra'],
    [true, 'framed is an object'],
  ] as const) {
    assert.ok(
      problems({ ...LOGIN, framed: bad }, file).some((each) => each.includes(problem)),
      problem,
    );
  }
  // The flag's old name, which covered the contrast sampler alone, is no export a surface may have.
  assert.ok(
    problems({ ...LOGIN, framedContrast: { reason } }, file).some((each) =>
      each.includes('framedContrast'),
    ),
  );
  const { surfaces } = await loadRegistrations();
  // Demo Studio's frame shows the sample or an import, and Owner Studio's the owner's draft
  // under a preview grant: each in a registered composition, whose own cells check it.
  assert.deepEqual(
    surfaces.filter((surface) => surface.framed).map((surface) => surface.id),
    ['demo-studio', 'studio'],
  );
  for (const id of ['demo-studio', 'studio']) {
    assert.match(
      surfaces.find((surface) => surface.id === id)!.framed!.reason,
      /composition cells check its contrast and its focus/,
      id,
    );
  }
});

test('a registration file with a problem fails the load', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  try {
    mkdirSync(path.join(root, 'surfaces'));
    writeFileSync(path.join(root, 'surfaces', 'broken.ts'), "export const id = 'broken';\n");
    await assert.rejects(loadRegistrations(root), (error: unknown) => {
      assert.ok(error instanceof RegistrationError);
      assert.match(error.message, /surfaces\/broken\.ts is not a valid registration/);
      assert.ok(error.problems.includes('exports no owner'));
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing directory registers nothing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  try {
    assert.deepEqual(await loadRegistrations(root), { surfaces: [], units: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an interaction named from one state's content is looked up on that state only, and one with no state on every state of its route (row 102)", () => {
  const registered = [
    { kind: 'dialog', name: '3 linked records', route: '/', state: 'complete' },
    { kind: 'disclosure', name: 'Menu', route: '/' },
    { kind: 'disclosure', name: 'Filters', route: '/work' },
  ] as unknown as readonly Interaction[];
  const names = (state: string, route = '/') =>
    interactionsOn(registered, route, state).map((each) => each.name);
  assert.deepEqual(names('complete'), ['3 linked records', 'Menu']);
  assert.deepEqual(names('sparse'), ['Menu']);
  assert.deepEqual(names('missing-media'), ['Menu']);
  assert.deepEqual(names('sparse', '/work'), ['Filters']);
});

test("Mission Control's controls named from the complete fixture are looked up on it alone, so a sparse or missing-media page owes none of them (#211, row 102)", async () => {
  const { units } = await loadRegistrations();
  const registered = units.find((unit) => unit.id === 'mission-control')!.interactions;
  const complete = [
    '3 linked records',
    'Education title 1 entry',
    '2 earlier entries',
    'Credits and notes',
  ];
  assert.deepEqual(
    interactionsOn(registered, '/', 'complete').map((each) => each.name),
    complete,
  );
  // On main these four were owed on every state of /, and the overlay check recorded each as
  // "no control on the page has that name" on the sparse and missing-media pages (#211, rc1-fe-4).
  for (const state of ['sparse', 'missing-media'])
    assert.deepEqual(
      interactionsOn(registered, '/', state)
        .map((each) => each.name)
        .filter((name) => complete.includes(name)),
      [],
      state,
    );
  // Each keeps what its own page holds (its server render, row 102's SSR probe).
  assert.deepEqual(
    interactionsOn(registered, '/', 'sparse').map((each) => each.name),
    ['Skills 1 group'],
  );
  assert.deepEqual(
    interactionsOn(registered, '/', 'missing-media').map((each) => each.name),
    ['Frames'],
  );
});

test("an interaction's state is one its target renders: a surface's own stateFixtures, a composition unit's fixtures", () => {
  const surface = (state: unknown) =>
    problems({
      ...LOGIN,
      interactions: [
        {
          kind: 'status',
          name: 'Sign in',
          route: '/studio/sign-in',
          announces: 'Each state.',
          state,
        },
      ],
    });
  assert.deepEqual(surface('signed-out'), []);
  assert.ok(
    surface('complete').some((p) => p.includes('interactions[0].state names one of its states')),
  );
  assert.ok(surface('').some((p) => p.includes('interactions[0].state names one of its states')));
  const unit = (state: unknown) => {
    try {
      validateUnit(
        { interactions: [{ kind: 'disclosure', name: 'Credits and notes', route: '/', state }] },
        'quality/units/mission-control.ts',
      );
      return [];
    } catch (error) {
      assert.ok(error instanceof RegistrationError);
      return [...error.problems];
    }
  };
  assert.deepEqual(unit('complete'), []);
  assert.deepEqual(unit('missing-media'), []);
  assert.ok(
    unit('signed-out').some((p) => p.includes('interactions[0].state names one of its states')),
  );
});

test("a registration that names a state its target doesn't have fails the load, naming it (row 102)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  const good = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  try {
    mkdirSync(path.join(root, 'units'));
    writeFileSync(
      path.join(root, 'units', 'mission-control.ts'),
      "export const interactions = [{ kind: 'disclosure', name: 'Credits and notes', route: '/', state: 'signed-out' }];\n",
    );
    await assert.rejects(loadRegistrations(root), (error: unknown) => {
      assert.ok(error instanceof RegistrationError);
      assert.match(error.message, /units\/mission-control\.ts is not a valid registration/);
      assert.ok(
        error.problems.some((p) => p.startsWith('interactions[0].state names one of its states')),
        error.problems.join('; '),
      );
      return true;
    });
    // A root of its own: the module loader keeps the first file's module under its path.
    mkdirSync(path.join(good, 'units'));
    writeFileSync(
      path.join(good, 'units', 'mission-control.ts'),
      "export const interactions = [{ kind: 'disclosure', name: 'Credits and notes', route: '/', state: 'sparse' }];\n",
    );
    assert.deepEqual(
      (await loadRegistrations(good)).units.map((unit) => unit.interactions[0]?.state),
      ['sparse'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});
