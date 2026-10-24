import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceSelection, VisitorControls } from '@portfolio/schema';
import {
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  visitorAppearanceModel,
  type ResolveInput,
  type VisitorModelInput,
} from '../index';
import { elements, html, one, slotted, text } from '../test-support/markup';
import { testRegistry } from '../test-support/packs';
import { PresentationBoundary, saveAppearance, VisitorAppearance, type SaveDeps } from '.';
import { MAX_PRELOADS, packStylesheets, postJson, preloadStylesheet } from './save';
import { PACK_AXES } from '../axes';

// VisitorAppearance (#19, Slice 3, item 3), on its own: Slice 4 adds POST
// /api/appearance and renders it in #5's VisitorControlSlot, so these tests
// render it with react-dom/server and run its save step with fakes. The
// browser behavior is tests/appearance's.

const registry = testRegistry();
/** The dark-only fixture scheme's name, as the control says it. */
const DARK_ONLY = registry.packs.colorScheme.get('fixture-dark-only')!.manifest.name;
const PUBLISHED: AppearanceSelection = { ...PLATFORM_DEFAULTS, variant: 'acme-gallery' };
const ALL_SELECTABLE: VisitorControls = {
  variant: 'selectable',
  designLanguage: 'selectable',
  colorScheme: 'selectable',
  typography: 'selectable',
  displayMode: 'selectable',
};

function resolve(extra: Partial<ResolveInput> = {}) {
  return resolveAppearance({
    published: PUBLISHED,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry,
    ...extra,
  });
}

function model(extra: Partial<VisitorModelInput> = {}) {
  return visitorAppearanceModel({
    registry,
    appearance: resolve(),
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    profile: 'owner',
    ...extra,
  });
}

test('the model has one control per selectable axis, in axis order, and none under demo', () => {
  assert.deepEqual(
    model().controls.map((control) => [control.axis, control.name, control.label, control.value]),
    [
      ['colorScheme', 'scheme', 'Color scheme', 'warm-parchment'],
      ['displayMode', 'mode', 'Display mode', 'system'],
    ],
  );
  assert.deepEqual(
    model({ visitorControls: ALL_SELECTABLE }).controls.map((control) => control.name),
    ['variant', 'language', 'scheme', 'type', 'mode'],
  );
  assert.deepEqual(model({ profile: 'demo', visitorControls: ALL_SELECTABLE }).controls, []);
  const locked: VisitorControls = {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  };
  assert.deepEqual(model({ visitorControls: locked }).controls, []);
});

test('packs are grouped by tier with Stable first, unrenderable generated schemes left out', () => {
  const scheme = model().controls[0]!;
  assert.deepEqual(
    scheme.groups.map((group) => [group.label, group.choices.map((choice) => choice.value)]),
    [
      ['Stable', ['warm-parchment']],
      ['Extended', ['fixture-light-only']],
      ['Experimental', ['fixture-dark-only']],
    ],
  );
  // fixture-seed and fixture-asset are generated, and nothing generated them.
  const generated = model({
    generated: {
      'fixture-seed': {
        light: registry.packs.colorScheme.get('warm-parchment')!.sets.light!,
        dark: registry.packs.colorScheme.get('warm-parchment')!.sets.dark!,
      },
    },
  }).controls[0]!;
  assert.ok(generated.groups.at(-1)!.choices.some((choice) => choice.value === 'fixture-seed'));
  // No choice names a stylesheet: a page names only those it renders (#6's purity check).
  for (const group of scheme.groups)
    for (const choice of group.choices) assert.equal('stylesheet' in choice, false, choice.value);
});

test('variants are listed by name, without the fallback composition', () => {
  const variant = model({ visitorControls: ALL_SELECTABLE }).controls[0]!;
  assert.deepEqual(
    variant.groups.map((group) => [group.tier, group.choices.map((choice) => choice.value)]),
    [[null, ['acme-gallery', 'editorial-evidence']]],
  );
});

test('a choice the current selection cannot take is disabled with the reason', () => {
  const light = resolve({ published: { ...PUBLISHED, displayMode: 'light' } });
  const scheme = model({ appearance: light }).controls[0]!;
  const darkOnly = scheme.groups
    .flatMap((group) => group.choices)
    .find((choice) => choice.value === 'fixture-dark-only')!;
  assert.equal(darkOnly.unavailable, 'no light mode');

  const dark = resolve({ published: { ...PUBLISHED, colorScheme: 'fixture-dark-only' } });
  const mode = model({ appearance: dark }).controls[1]!;
  assert.deepEqual(
    mode.groups[0]!.choices.map((choice) => [choice.value, choice.unavailable]),
    [
      ['system', undefined],
      ['light', `${DARK_ONLY} has no light mode`],
      ['dark', undefined],
      ['high-contrast', undefined],
    ],
  );
  assert.equal(mode.note, `${DARK_ONLY} has only a dark mode, so it shows dark.`);
});

test('a scheme that pins the mode shows a mode it lacks as the mode that renders, and keeps System', () => {
  for (const [published, value] of [
    // A mode the scheme lacks shows as its own, which the form can post.
    [{ ...PUBLISHED, colorScheme: 'fixture-dark-only', displayMode: 'light' as const }, 'dark'],
    // System stays System, as the approved control keeps it: the scheme resolves it to dark.
    [{ ...PUBLISHED, colorScheme: 'fixture-dark-only' }, 'system'],
  ] as const) {
    const appearance = resolve({ published });
    assert.equal(appearance.modeLocked, true);
    assert.equal(appearance.resolvedMode, 'dark');
    const mode = model({ appearance }).controls[1]!;
    assert.equal(mode.value, value, published.displayMode);
    assert.equal(mode.note, `${DARK_ONLY} has only a dark mode, so it shows dark.`);
    // The checked radio is one the form posts: never a disabled one.
    const markup = html(<VisitorAppearance model={model({ appearance })} returnTo="/" />);
    const checked = elements(markup).filter(
      (element) => element.tag === 'input' && element.attributes.checked !== undefined,
    );
    assert.deepEqual(
      checked.map((element) => [element.attributes.value, element.attributes.disabled]),
      [[value, undefined]],
      published.displayMode,
    );
  }
  // A scheme with both modes keeps the visitor's own value, system included.
  const system = model({ appearance: resolve() }).controls[1]!;
  assert.equal(system.value, 'system');
});

test('what renders shows as the current value even when a visitor could not pick it', () => {
  const fallback = resolve({ published: { ...PUBLISHED, variant: 'missing-variant' } });
  const variant = model({ appearance: fallback, visitorControls: ALL_SELECTABLE }).controls[0]!;
  assert.equal(variant.value, 'fallback');
  assert.deepEqual(variant.groups[0], {
    tier: null,
    label: 'Current',
    choices: [{ value: 'fallback', label: 'Test composition', unavailable: "can't be selected" }],
  });
});

test('without JavaScript it is a form in an Appearance disclosure that posts the selectable axes', () => {
  const markup = html(
    <VisitorAppearance
      model={model({ visitorControls: ALL_SELECTABLE })}
      returnTo="/work?x=1#top"
    />,
  );
  const disclosure = one(markup, 'disclosure');
  assert.equal(disclosure.tag, 'details');
  assert.equal(disclosure.attributes.open, undefined, 'in the flow, closed until opened');
  assert.match(markup, /<summary data-ui-slot="disclosure.summary">Appearance<\/summary>/);
  const form = one(markup, 'appearance-control.form');
  assert.equal(form.tag, 'form');
  assert.equal(form.attributes.method, 'post');
  assert.equal(form.attributes.action, '/api/appearance');
  const hidden = elements(markup).find((element) => element.attributes.type === 'hidden')!;
  assert.deepEqual([hidden.attributes.name, hidden.attributes.value], ['return', '/work?x=1#top']);
  assert.deepEqual(
    slotted(markup, 'select.control').map((select) => select.attributes.name),
    ['variant', 'language', 'scheme', 'type'],
  );
  assert.deepEqual(
    slotted(markup, 'select.label').map((label) => label.attributes.for),
    [
      'appearance-variant',
      'appearance-design-language',
      'appearance-color-scheme',
      'appearance-typography',
    ],
  );
  assert.deepEqual(
    slotted(markup, 'radio.control').map((radio) => [
      radio.attributes.name,
      radio.attributes.value,
    ]),
    [
      ['mode', 'system'],
      ['mode', 'light'],
      ['mode', 'dark'],
      ['mode', 'high-contrast'],
    ],
  );
  const [apply, reset] = slotted(markup, 'action');
  assert.equal(text(markup).includes('Apply'), true);
  assert.equal(apply!.attributes.type, 'submit');
  assert.equal(apply!.attributes.hidden, undefined, 'Apply shows until JavaScript hides it');
  assert.deepEqual([reset!.attributes.name, reset!.attributes.value], ['reset', '1']);
  assert.match(text(markup), /Reset to site default/);
  const status = one(markup, 'appearance-control.status');
  assert.equal(status.attributes.role, 'status');
  assert.equal(text(markup).includes('Retry'), false);
});

test('the select groups its packs by tier and says why an option is unavailable', () => {
  const light = resolve({ published: { ...PUBLISHED, displayMode: 'light' } });
  const markup = html(<VisitorAppearance model={model({ appearance: light })} returnTo="/" />);
  assert.deepEqual(
    elements(markup)
      .filter((element) => element.tag === 'optgroup')
      .map((group) => group.attributes.label),
    ['Stable', 'Extended', 'Experimental'],
  );
  const options = elements(markup).filter((element) => element.tag === 'option');
  assert.equal(
    options.find((option) => option.attributes.value === 'warm-parchment')!.attributes.selected,
    '',
  );
  assert.equal(
    options.find((option) => option.attributes.value === 'fixture-dark-only')!.attributes.disabled,
    '',
  );
  assert.ok(text(markup).includes(`${DARK_ONLY} (no light mode)`), text(markup));
  const light2 = slotted(markup, 'radio.control').find(
    (radio) => radio.attributes.value === 'light',
  )!;
  assert.equal(light2.attributes.checked, '');
});

test('it renders nothing when no axis is selectable, or under demo', () => {
  assert.equal(html(<VisitorAppearance model={{ controls: [] }} returnTo="/" />), '');
  assert.equal(
    html(
      <VisitorAppearance
        model={model({ profile: 'demo', visitorControls: ALL_SELECTABLE })}
        returnTo="/"
      />,
    ),
    '',
  );
});

test("in a plate it's the same form, with the plate's id prefix and nothing to listen to", () => {
  const markup = html(
    <PresentationBoundary
      kind="plate"
      appearance={resolve()}
      ids={{ prefix: 'pl-1-', main: 'pl-1-main' }}
    >
      <VisitorAppearance model={model()} returnTo="/" refresh={() => {}} />
    </PresentationBoundary>,
  );
  assert.equal(one(markup, 'disclosure').attributes.id, 'pl-1-appearance');
  assert.equal(one(markup, 'select.control').attributes.id, 'pl-1-appearance-color-scheme');
  assert.equal(slotted(markup, 'radio')[0]!.attributes.id, 'pl-1-appearance--display-mode');
  assert.equal(
    slotted(markup, 'action')[0]!.attributes.hidden,
    undefined,
    'no JavaScript path in a plate',
  );
});

/** A compiled pack's URL as registry generation names it. */
const pack = (id: string) => `/_portfolio/pack/${id}.0123456789ab.css`;

/** Save dependencies whose post and preload resolve when the test says. */
function fakes(stylesheets: readonly string[] = []) {
  const calls: string[] = [];
  const pending = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();
  const deps: SaveDeps = {
    post: (url, body, signal) =>
      new Promise((resolve, reject) => {
        calls.push(`post ${url} ${body}`);
        pending.set('post', { resolve: () => resolve({ ok: true, stylesheets }), reject });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    preload: (href, signal) =>
      new Promise<void>((resolve, reject) => {
        calls.push(`preload ${href}`);
        pending.set(`preload ${href}`, { resolve, reject });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return { deps, calls, pending };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a save posts the values as JSON, then preloads the stylesheets the answer names, then counts as saved', async () => {
  const { deps, calls, pending } = fakes([pack('nord')]);
  let outcome: string | undefined;
  const saving = saveAppearance(
    { action: '/api/appearance', body: { scheme: 'nord', mode: 'dark' } },
    deps,
  ).then((value) => (outcome = value));
  await flush();
  assert.deepEqual(
    calls,
    ['post /api/appearance {"scheme":"nord","mode":"dark"}'],
    'nothing loads before the route has saved',
  );
  pending.get('post')!.resolve();
  await flush();
  assert.deepEqual(calls.at(-1), `preload ${pack('nord')}`);
  assert.equal(
    outcome,
    undefined,
    "it isn't saved, so nothing refreshes, until the preload settles",
  );
  pending.get(`preload ${pack('nord')}`)!.resolve();
  await saving;
  assert.equal(outcome, 'saved');
});

test('it preloads only same-origin pack paths from the answer, each once', async () => {
  const { deps, calls, pending } = fakes([
    pack('nord'),
    pack('nord'),
    'https://evil.example/x.css',
    '//evil.example/x.css',
    '/_portfolio/pack/../../x.css',
    '/elsewhere.css',
    7 as never,
    // Each reaches one anchor of the pack path's pattern: the start, then the end.
    `https://evil.example${pack('nord')}`,
    `//evil.example${pack('nord')}`,
    `${pack('nord')}?x`,
    `${pack('nord')}/x`,
    'data:text/css,',
    // A line break before or after a pack path: a multiline pattern would take either.
    `https://evil.example\n${pack('nord')}`,
    `${pack('nord')}\n/x`,
  ]);
  const saving = saveAppearance({ action: '/a', body: { mode: 'dark' } }, deps);
  await flush();
  pending.get('post')!.resolve();
  await flush();
  assert.deepEqual(calls.slice(1), [`preload ${pack('nord')}`]);
  pending.get(`preload ${pack('nord')}`)!.resolve();
  assert.equal(await saving, 'saved');
  assert.deepEqual(packStylesheets('not a list'), []);
  // The cap counts kept paths, after the filter and the dedupe: one per pack axis.
  assert.equal(MAX_PRELOADS, PACK_AXES.length);
  assert.deepEqual(
    packStylesheets([pack('a'), pack('a'), 'junk', pack('b'), pack('c'), pack('d')]),
    [pack('a'), pack('b'), pack('c')],
  );
});

test("a save the route refuses fails, and one whose stylesheet doesn't load still counts as saved", async () => {
  const refused: SaveDeps = {
    ...fakes().deps,
    preload: async () => assert.fail('nothing loads for a refused save'),
    post: async () => ({ ok: false }),
  };
  assert.equal(await saveAppearance({ action: '/a', body: { reset: true } }, refused), 'failed');
  const broken: SaveDeps = {
    ...refused,
    post: async () => ({ ok: true, stylesheets: [pack('nord')] }),
    preload: async () => {
      throw new Error('404');
    },
  };
  assert.equal(await saveAppearance({ action: '/a', body: { mode: 'dark' } }, broken), 'saved');
  const thrown: SaveDeps = {
    ...refused,
    post: async () => {
      throw new Error('offline');
    },
  };
  assert.equal(await saveAppearance({ action: '/a', body: { mode: 'dark' } }, thrown), 'failed');
});

test('a post that takes more than ten seconds times out, and nothing loads after', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { deps, calls } = fakes([pack('nord')]);
    const saving = saveAppearance({ action: '/a', body: { mode: 'dark' } }, deps);
    await flush();
    mock.timers.tick(9_999);
    await flush();
    mock.timers.tick(1);
    assert.equal(await saving, 'timed-out');
    assert.deepEqual(calls, ['post /a {"mode":"dark"}']);
  } finally {
    mock.timers.reset();
  }
});

test('a preload still running at ten seconds stops, and the save, already made, counts as saved', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { deps, pending } = fakes([pack('nord')]);
    const saving = saveAppearance({ action: '/a', body: { mode: 'dark' } }, deps);
    await flush();
    pending.get('post')!.resolve();
    await flush();
    mock.timers.tick(10_000);
    assert.equal(await saving, 'saved');
  } finally {
    mock.timers.reset();
  }
});

test('a newer save supersedes an older one, before or after its post', async () => {
  const { deps } = fakes();
  const controller = new AbortController();
  const older = saveAppearance(
    { action: '/a', body: { mode: 'dark' }, signal: controller.signal },
    deps,
  );
  controller.abort();
  assert.equal(await older, 'superseded');
  assert.equal(
    await saveAppearance({ action: '/a', body: { mode: 'dark' }, signal: controller.signal }, deps),
    'superseded',
  );
  const later = fakes([pack('nord')]);
  const preloading = new AbortController();
  const saving = saveAppearance(
    { action: '/a', body: { mode: 'dark' }, signal: preloading.signal },
    later.deps,
  );
  await flush();
  later.pending.get('post')!.resolve();
  await flush();
  preloading.abort();
  assert.equal(await saving, 'superseded');
});

/** A minimal document: its head, the links it holds, and a nonce'd element when `nonce` is given. */
function fakeDocument({ nonce, linked = [] }: { nonce?: string; linked?: readonly string[] } = {}) {
  type Listener = () => void;
  const head: FakeLink[] = linked.map((href) => link({ rel: 'stylesheet', href }));
  function link(attributes: Record<string, string> = {}) {
    const listeners = new Map<string, Listener>();
    const element = {
      rel: attributes.rel ?? '',
      as: '',
      href: attributes.href ?? '',
      nonce: '',
      getAttribute: (name: string) => (name === 'href' ? element.href : null),
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      remove: () => head.splice(head.indexOf(element), 1),
      fire: (type: string) => listeners.get(type)?.(),
    };
    return element;
  }
  type FakeLink = ReturnType<typeof link>;
  const carrier = nonce ? { nonce } : null;
  return {
    head: { append: (element: FakeLink) => head.push(element) },
    createElement: () => link(),
    // Only the page's own nonce'd elements carry the nonce a preload takes.
    querySelector: (selector: string) =>
      selector === 'link[nonce], style[nonce], script[nonce]' ? carrier : null,
    querySelectorAll: (selector: string) =>
      selector.startsWith('link[rel~="stylesheet"]')
        ? head.filter(({ rel }) => rel === 'stylesheet')
        : [],
    links: head,
  };
}

/** Runs `run` with `fake` as the global document. */
async function withDocument<T>(fake: unknown, run: () => Promise<T>): Promise<T> {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: fake,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (before) Object.defineProperty(globalThis, 'document', before);
    else delete (globalThis as { document?: unknown }).document;
  }
}

test("a preload link takes the page's CSP nonce, where the page has one, and only that link does", async () => {
  for (const nonce of ['abc123', undefined]) {
    const fake = fakeDocument(nonce ? { nonce } : {});
    await withDocument(fake, async () => {
      const loading = preloadStylesheet(pack('nord'), new AbortController().signal);
      const [added] = fake.links;
      assert.equal(added?.rel, 'preload');
      assert.equal(added?.as, 'style');
      assert.equal(added?.href, pack('nord'));
      assert.equal(added?.nonce, nonce ?? '', 'the nonce the page carries, or none');
      added!.fire('load');
      await loading;
    });
  }
});

test('a stylesheet the page already links preloads nothing, so a mode alone adds no link', async () => {
  const fake = fakeDocument({ linked: [pack('warm-parchment')] });
  await withDocument(fake, async () => {
    const linked = preloadStylesheet(pack('warm-parchment'), new AbortController().signal);
    assert.equal(fake.links.length, 1, "only the page's own link");
    await linked;
    const loading = preloadStylesheet(pack('nord'), new AbortController().signal);
    assert.equal(fake.links.length, 2);
    fake.links[1]!.fire('load');
    await loading;
  });
  // The match is the whole href: the same pack under another build's hash still preloads.
  const deployed = fakeDocument({ linked: ['/_portfolio/pack/nord.ba9876543210.css'] });
  await withDocument(deployed, async () => {
    const loading = preloadStylesheet(pack('nord'), new AbortController().signal);
    assert.equal(deployed.links.length, 2, 'a new link for the new hash');
    deployed.links[1]!.fire('load');
    await loading;
  });
});

test("postJson reads the answer's pack paths alone, at most one per pack axis, whatever else it holds", async () => {
  const before = globalThis.fetch;
  const answer = (body: string, ok = true) => {
    globalThis.fetch = (async () => new Response(body, { status: ok ? 200 : 400 })) as typeof fetch;
  };
  try {
    const signal = new AbortController().signal;
    answer(JSON.stringify({ stylesheets: [pack('nord')], extra: { stylesheets: ['/x.css'] } }));
    assert.deepEqual(await postJson('/a', '{}', signal), { ok: true, stylesheets: [pack('nord')] });
    answer(JSON.stringify({ stylesheets: pack('nord') }));
    assert.deepEqual(await postJson('/a', '{}', signal), { ok: true, stylesheets: [] });
    answer('not json');
    assert.deepEqual(await postJson('/a', '{}', signal), { ok: true, stylesheets: [] });
    answer('[1,2]');
    assert.deepEqual(await postJson('/a', '{}', signal), { ok: true, stylesheets: [] });
    const many = Array.from({ length: 1000 }, (_, index) => pack(`pack-${index}`));
    answer(JSON.stringify({ stylesheets: many }));
    const read = await postJson('/a', '{}', signal);
    assert.equal(read.stylesheets!.length, MAX_PRELOADS);
    assert.equal(MAX_PRELOADS, 3);
    answer('{}', false);
    assert.deepEqual(await postJson('/a', '{}', signal), { ok: false });
  } finally {
    globalThis.fetch = before;
  }
});
