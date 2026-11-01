import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { githubSnapshot, isRoutedWork } from '@portfolio/kit/sections';
import type { ViewGitHubData } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { relationsOf, repoKey, shownRepos } from '../model';
import {
  FIXTURE_NAMES,
  fixtureInput,
  inputFor,
  PACKAGE_DIR,
  pairOf,
  renderInput,
  sampleInput,
} from './harness.test';

// Targeted tests for the P2 code review's surviving mutants that the content
// sweep can't see: the full record sorts last on each board (u5), a role
// whose end is "present" is current (u22), the repository relation on the
// one pair that has it (u25), the related work on home when a case has no
// next (u28), the recent repositories the snapshot holds (u7), and a cited
// record's statement on the work's own page (u21).

const ALL = (): readonly (readonly [string, VariantRenderInput])[] => [
  ['sample', sampleInput()],
  ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
];

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** Words only, for comparing a source with its page. */
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

test('on every board the full record’s closed panels come after every open one (u5)', () => {
  let boards = 0;
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    for (const board of html.split('<section class="mc-board').slice(1)) {
      const panels = [...board.matchAll(/<section id="[^"]*"[^>]*class="mc-panel([^"]*)"/g)].map(
        ([, cls]) => (cls!.includes('mc-panel--fold') ? 'fold' : 'open'),
      );
      const firstFold = panels.indexOf('fold');
      if (firstFold < 0) continue;
      boards += 1;
      assert.ok(
        panels.slice(firstFold).every((kind) => kind === 'fold'),
        `${name}: an open panel after a fold (${panels.join(' ')})`,
      );
    }
  }
  assert.ok(boards > 0, 'some board folds its full record');
});

test('a role whose end is "present" is current: its lamp says Current, never Ended (u22)', () => {
  const html = renderInput(
    inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Ana Ruiz', tagline: 'Engineer' },
        chronology: [
          {
            id: 'now-role',
            kind: 'role',
            title: 'Staff engineer',
            organization: 'Solstice',
            period: { start: '2022-01', end: 'present' },
          },
        ],
        sections: [
          { kind: 'chronology', id: 'experience', title: 'Experience', items: ['now-role'] },
        ],
      }),
    ),
  );
  const row = html.slice(html.indexOf('id="now-role"'));
  const lamps = [
    ...row.slice(0, row.indexOf('</li>')).matchAll(/class="mc-lamp"[^>]*>([^<]*)/g),
  ].map(([, words]) => words!.trim());
  assert.ok(lamps.includes('Current'), `lamps: ${lamps.join(', ')}`);
  assert.ok(!lamps.includes('Ended'));
});

test('the sample’s repositories are named by the works whose links are their addresses (u25)', () => {
  const input = sampleInput();
  const relations = relationsOf(input, ['works', 'evidence', 'chronology', 'github']);
  const repos = [...relations.names.keys()].filter((id) => id.startsWith(repoKey('')));
  assert.ok(repos.length > 0, 'the sample names some repository');
  for (const repo of repos) {
    const works = [...relations.names.get(repo)!];
    assert.ok(works.length > 0, repo);
    for (const work of works)
      assert.ok(
        input.portfolio.works.some(({ id }) => id === work),
        `${repo} names ${work}`,
      );
    assert.equal(relations.labels.get(repo)?.kind, 'Repository');
  }
});

test('a case with no next and no related case points to a related work on home (u28)', () => {
  const input = inputFor(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Ana Ruiz', tagline: 'Engineer' },
      works: [
        {
          id: 'kit',
          slug: 'kit',
          title: 'Template kit',
          medium: 'software',
          summary: 'A kit.',
          tools: ['Rust'],
          caseStudy: { challenge: 'Reviews ran long.' },
        },
        { id: 'sync', title: 'Folder sync', medium: 'software', tools: ['Rust'] },
      ],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['kit', 'sync'] }],
    }),
  );
  const routed = input.portfolio.works.filter(isRoutedWork);
  assert.equal(routed.length, 1);
  const html = renderInput({ ...input, route: { route: 'work', slug: 'kit' } });
  assert.match(html, /data-on="all"/);
  assert.match(html, /href="[^"]*#sync"/, 'the related work on home');
  assert.match(textOf(html), /Folder sync/);
});

test('the GitHub panel lists the snapshot’s recently active repositories as well as its pinned ones (u7)', () => {
  let checked = 0;
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    for (const section of input.portfolio.sections) {
      if (section.kind !== 'github') continue;
      const snapshot = githubSnapshot(section, input);
      if (snapshot?.state !== 'ready') continue;
      const { pinned, recent } = shownRepos(section, snapshot.value as ViewGitHubData);
      const names = new Set(pinned.map((repo) => repo.name));
      // The panel's own list after its "Recently pushed" line, not the page's other mentions.
      const at = html.indexOf(`<section id="${section.id}"`);
      const panel = html.slice(at, html.indexOf('</section>', at));
      const listed = textOf(panel.slice(panel.indexOf('mc-gh__sub')));
      for (const repo of recent) {
        if (names.has(repo.name)) continue;
        checked += 1;
        assert.ok(listed.includes(repo.name), `${name}: recent ${repo.name}`);
      }
    }
  }
  assert.ok(checked > 0, 'some snapshot has recently active repositories');
});

test('a work’s own page says each record it cites, in the record’s own words (u21)', () => {
  let checked = 0;
  for (const [name, input] of ALL()) {
    for (const work of input.portfolio.works.filter(isRoutedWork)) {
      const page = textOf(renderInput({ ...input, route: { route: 'work', slug: work.slug } }));
      for (const id of work.evidence ?? []) {
        const record = input.portfolio.evidence.find((each) => each.id === id);
        const said = record?.statement ?? record?.title;
        if (!said || record?.type === 'metric') continue;
        checked += 1;
        const plain = words(said.replace(/\]\([^)]*\)/g, '')).slice(0, 40);
        assert.ok(words(page).includes(plain), `${name} /work/${work.slug}: ${id}`);
      }
    }
  }
  assert.ok(checked > 0, 'some case cites records');
});

test('a second hero past the anchor says its name, subtitle, tagline, subtagline and every action (u19)', () => {
  const html = renderInput(
    inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Ana Ruiz', tagline: 'Engineer' },
        sections: [
          { kind: 'hero', id: 'top', tagline: 'I build calm tools.' },
          {
            kind: 'hero',
            id: 'again',
            title: 'Hire me',
            name: 'Ana Ruiz, consulting',
            subtitle: 'Two engagements a quarter',
            tagline: 'Reliability reviews for small teams.',
            subtagline: 'Booking for spring.',
            ctas: [
              { label: 'Write to me', url: 'mailto:ana@ruiz.test' },
              { label: 'See the terms', url: 'https://ruiz.test/terms' },
            ],
          },
        ],
      }),
    ),
  );
  const at = html.indexOf('<section id="again"');
  const panel = textOf(html.slice(at, html.indexOf('</section>', at)));
  for (const words of [
    'Ana Ruiz, consulting',
    'Two engagements a quarter',
    'Reliability reviews for small teams.',
    'Booking for spring.',
    'Write to me',
    'See the terms',
  ])
    assert.ok(panel.includes(words), words);
});

test('a panel’s subtitle sits on its own padded line, never on the panel’s border (the design review’s MF3, G1)', () => {
  let subs = 0;
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    for (const match of html.matchAll(/<p class="mc-panel__sub">/g)) {
      subs += 1;
      assert.ok(
        html.slice(0, match.index).endsWith('<div class="mc-panel__intro">'),
        `${name}: a subtitle outside its intro line`,
      );
    }
  }
  assert.ok(subs > 0, 'some panel has a subtitle');
});

test('a lede at 10 takes its short partners as one stack beside it, and the stack is one unit of its row (the design review’s MF2)', () => {
  const html = renderInput(sampleInput());
  const at = html.indexOf('class="mc-stack"');
  assert.ok(at >= 0, 'the sample stacks About’s partners');
  const before = html.slice(0, at);
  assert.match(before.slice(before.lastIndexOf('<section id="')), /data-kind="lede"/);
  assert.match(
    html.slice(at),
    /^class="mc-stack" data-span="6"><section id="[^"]+"[^>]*data-stacked=""/,
  );
  const stacked = [
    ...html.matchAll(/<section id="([^"]+)"[^>]*class="([^"]*)"[^>]*data-stacked=""/g),
  ];
  assert.ok(stacked.length >= 2, `stacked: ${stacked.map(([, id]) => id).join(', ')}`);
  for (const [, id, cls] of stacked) assert.ok(!cls!.includes('mc-panel--fold'), `${id} is open`);
});

test('on a phone the docked rail is the page’s bottom inset: targets scroll above it, the page ends clear of it, and keyboard focus past it steps it below the window (the quality occlusion check)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const phone = css.slice(css.lastIndexOf('@media (width < 47.5rem) {'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /--layout-dock: 3\.5rem;/);
  // Every focus and fragment target keeps a margin above the dock.
  assert.match(
    block,
    /:is\(\[id\], a\[href\], button, summary, input, select, textarea, \[tabindex\]\) \{\s*scroll-margin-block-end: calc\(var\(--layout-dock\) \+ var\(--space-2xs\)\);/,
  );
  // The page's own end clears it, and the dock is that tall.
  assert.match(block, /padding-block-end: calc\(var\(--layout-dock\) \+ var\(--space-2xs\)\);/);
  assert.match(block, /\.mc-rail \{[^}]*position: fixed;[^}]*block-size: var\(--layout-dock\);/);
  // Keyboard focus on the page past the dock moves it below the window, and only moves it: its
  // links stay focusable, so Shift+Tab reaches it.
  const step =
    /\.mc-root:has\(> :is\(\.mc-status, \.mc-main, \.mc-colophon\) :focus-visible\)\s*> \.mc-rail \{([^}]*)\}/.exec(
      block,
    );
  assert.ok(step, 'the dock steps aside under keyboard focus on the page');
  assert.match(step[1]!, /translate: 0 100%;/);
  assert.doesNotMatch(step[1]!, /visibility|display|inert/);
});

test('a work cell’s fold says only what it holds: "frames" over a frame or a caption, never over an audio placement alone (the code review of 117675ca4)', () => {
  let folds = 0;
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    for (const [fold] of html.matchAll(
      /<details class="mc-fold mc-fold--inner mc-more"[\s\S]*?<\/details>/g,
    )) {
      folds += 1;
      const label = textOf(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(fold)![1]!).trim();
      const body = fold.replace(/<summary[\s\S]*?<\/summary>/, '');
      if (/frames/i.test(label))
        assert.match(body, /mc-frames|mc-more__caption/, `${name}: "${label}" holds no frame`);
      assert.ok(textOf(body).trim() !== '' || /<img/.test(body), `${name}: "${label}" is empty`);
    }
  }
  assert.ok(folds > 10, `folds: ${folds}`);
  // The complete fixture's episode: its one placement is audio, so its fold is its credits and notes.
  const complete = renderInput(fixtureInput('complete'));
  assert.match(complete, /<summary[^>]*>(?:<[^>]+>)*Credits and notes(?:<\/[^>]+>)*<\/summary>/);
});

test('on 8 columns the other quotes stand only where ::details-content can show them: elsewhere their fold keeps its bar (the code review of 117675ca4)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const bar = css.indexOf('.mc-quoteset__more > .mc-fold__bar {\n      display: none;');
  assert.ok(bar > 0, 'the quote fold’s bar goes on 8 columns');
  const guard = css.lastIndexOf('@supports selector(::details-content) {', bar);
  assert.ok(guard > 0 && !css.slice(guard, bar).includes('\n  }\n'), 'inside the @supports guard');
});

test('the archived strip’s summary has a floor beside its name and foot at every width: the foot wraps in its own track, or goes under the summary (the design review’s B1)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const grids = [...css.matchAll(/\.mc-strip \{[^}]*?grid-template-columns: ([^;]+);/g)].map(
    ([, value]) => value!.replace(/\s+/g, ' ').trim(),
  );
  assert.ok(grids.length >= 3, `the strip's grids: ${grids.join(' | ')}`);
  for (const grid of grids) {
    // One track is the phone's stack; with more, the summary's track is the second.
    const tracks = grid.match(/minmax\((?:[^()]|\([^()]*\))*\)|\S+/g)!;
    if (tracks.length === 1) continue;
    assert.match(tracks[1]!, /^minmax\(min\(100%, \d+(?:\.\d+)?rem\), 1fr\)$/, grid);
    // A foot beside it never sizes to its whole line, which is what took the summary's width.
    if (tracks[2]) assert.notEqual(tracks[2], 'auto', grid);
  }
  // Under a desk's panel the foot goes under the summary, in its column.
  assert.match(
    css,
    /@container \(36rem <= width < 72rem\) \{[^@]*\.mc-strip > \.mc-cell__foot \{\s*grid-row: auto;\s*grid-column: 2;/,
  );
});

test('the dock eases aside and back only under no-preference: under reduced motion it moves at once (the design review’s D1)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const phone = css.slice(css.lastIndexOf('@media (width < 47.5rem) {'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  const motion =
    /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-variant='mission-control'\] \.mc-rail \{\s*transition: translate var\(--motion-feedback\) var\(--motion-curve\);\s*\}\s*\}/;
  assert.match(block, motion);
  // No other transition on the rail in the phone's block.
  assert.doesNotMatch(block.replace(motion, ''), /\.mc-rail \{[^}]*transition/);
});

test('a panel’s lone work named as the panel leaves its name to the panel’s bar; one named otherwise keeps its own (the design review’s D3)', () => {
  const html = renderInput(sampleInput());
  const panel = (id: string) => {
    const at = html.indexOf(`<section id="${id}"`);
    assert.ok(at >= 0, id);
    return html.slice(at, html.indexOf('</section>', at));
  };
  const looking = panel('looking');
  assert.match(looking, /<h3 class="mc-bar__title"><span id="[^"]+">Looking<\/span><\/h3>/);
  assert.match(looking, /<article class="mc-cell"/);
  assert.doesNotMatch(looking, /class="mc-cell__title"/);
  const listening = panel('listening-a-small-experiment');
  assert.match(listening, /class="mc-cell__title">[^<]+</);
});

test('About’s stack takes complete’s Now and its other short panels, four of them (the code review’s d1 and d2)', () => {
  const html = renderInput(fixtureInput('complete'));
  assert.ok(html.includes('class="mc-stack"'), 'complete stacks About’s partners');
  const stacked = [
    ...html.matchAll(/<section id="([^"]+)"[^>]*data-kind="([^"]+)"[^>]*data-stacked=""/g),
  ];
  assert.deepEqual(
    stacked.map(([, id, kind]) => `${id}(${kind})`),
    ['now(now)', 'quote(quote)', 'custom(custom)', 'focus(focus)'],
  );
});

test('on a desk the status line clips only its name, with the focus ring’s reach inside the clip, and its readings go out whole by its width, never under a clip (the quality focus-contrast and root-text reflow checks)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const desk = css.slice(
    css.indexOf("@media (width >= 64rem) {\n  [data-variant='mission-control'] .mc-status {"),
  );
  const block = desk.slice(0, desk.indexOf('\n}\n'));
  assert.match(block, /\.mc-status \{\s*container: mc-status \/ inline-size;/);
  const where = /\.mc-status__where \{([^}]*)\}/.exec(block)![1]!.replace(/\s+/g, ' ');
  // The ring's reach (and a quarter em above and below) as padding, given back as margin.
  const reach = 'var(--ui-focus-width) + var(--ui-focus-offset)';
  assert.ok(
    where.includes(`padding: calc(${reach} + 0.25em) calc(${reach});`),
    `the name's padding: ${where}`,
  );
  assert.ok(
    where.includes(`margin: calc(-1 * (${reach} + 0.25em)) calc(-1 * (${reach}));`),
    `the name's margin: ${where}`,
  );
  assert.match(where, /overflow: hidden;/);
  // The readings: no clip and no height cap anywhere on the desk.
  for (const [, rules] of block.matchAll(/\.mc-status__signals[^{]*\{([^}]*)\}/g))
    assert.doesNotMatch(rules!, /overflow|max-block-size|text-overflow/);
  assert.match(
    block,
    /@container mc-status \(width < \d+em\) \{\s*\[data-variant='mission-control'\] \.mc-status__signals > li \+ li \{\s*display: none;/,
  );
  assert.match(
    block,
    /@container mc-status \(width < \d+em\) \{\s*\[data-variant='mission-control'\] \.mc-status__signals \{\s*display: none;/,
  );
});

test('no rule keys on a scripting media query: a targeted fold looks opened while the root lacks the record enhancement’s data-mc-folds mark, which the enhancement sets once attached (the quality runner’s media-emulation rule)', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /@media[^{]*scripting/);
  const keyed = css.match(
    /\.mc-root:not\(\[data-mc-folds\]\)\s*:is\(:target > details\.mc-fold, details\.mc-fold:has\(:target\)\)/g,
  );
  assert.equal(keyed?.length, 3, 'the content, the cue and the rule');
  const record = readFileSync(path.join(PACKAGE_DIR, 'src', 'enhancements', 'record.tsx'), 'utf8');
  assert.match(record, /root\.setAttribute\('data-mc-folds', ''\);/);
  assert.match(record, /root\.removeAttribute\('data-mc-folds'\);/);
});
