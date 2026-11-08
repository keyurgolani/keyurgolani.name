import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Horizontal Cinema's stylesheet, read as rules: the phone's spacing, where a review measured
// it short (HOR-4, HOR-5).

/** Every rule of the stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Each `@media <query> {` block's text, to its closing brace at column 0. */
const blocks = (query: string): string[] => {
  const found: string[] = [];
  for (let at = CSS.indexOf(`@media ${query} {`); at >= 0;) {
    const end = CSS.indexOf('\n}\n', at);
    found.push(CSS.slice(at, end));
    at = CSS.indexOf(`@media ${query} {`, end);
  }
  return found;
};

/** The declarations of every rule whose selector is exactly `selector`, in `within`, joined. */
const declared = (selector: string, within: string): string =>
  [...within.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head!.trim().replace(/\s+/g, ' ') === selector)
    .map(([, , body]) => body)
    .join('');

const PHONE = '(max-width: 47.99rem)';
const at = (selector: string) => `[data-variant='horizontal-cinema'] ${selector}`;

test('on a phone the title card’s tagline band keeps space under it, with no bottom bar to give it (HOR-4)', () => {
  const phone = blocks(PHONE).join('\n');
  assert.match(declared(at('.hc-shell .hc-bar--bottom'), phone), /display: none;/);
  assert.match(declared(at('.hc-card__subtitles'), phone), /padding-block-end: var\(--space-l\);/);
});

test('on a phone the full record’s rows have room around and between their lines, on the scenes’ inset (HOR-5)', () => {
  const phone = blocks(PHONE).join('\n');
  const row = declared(at('.hc-record__summary'), phone);
  assert.match(row, /padding-block: var\(--space-xs\);/);
  assert.match(row, /gap: var\(--space-3xs\) var\(--space-s\);/);
  assert.doesNotMatch(row, /padding-block: 0;|row-gap: 0;/);
  assert.match(
    declared(at('.hc-record'), phone),
    /padding-inline: calc\(var\(--layout-inset\) \+ var\(--layout-pad\)\);/,
  );
});

test('on a laptop’s short window the strip steps its spacing down and widens two-section scenes, never its type (HOR-1)', () => {
  const short = blocks(
    '(min-width: 64rem) and (min-height: 44rem) and (max-height: 56rem) and (hover: hover) and (pointer: fine)',
  );
  assert.equal(short.length, 1);
  const block = short[0]!;
  // Only where the strip shows, below the 900 px window the strip was laid out for: a shell that
  // falls back top to bottom keeps the full top line and bars, so their controls' rings aren't cut.
  assert.equal(declared(at(".hc[data-view='strip']"), block), '');
  assert.match(
    declared(at(".hc[data-view='strip']:not(:has(.hc-shell[data-fit='over']))"), block),
    /--layout-pad-block: var\(--space-2xs\);/,
  );
  assert.match(block, /\[data-w='8'\]:has\(\.hc-section \+ \.hc-section\) \{\s*--layout-cols: 10;/);
  assert.match(block, /grid-column: span 5;/);
  // Spacing alone: no size, line height, or face changes, so every scene keeps its words as set.
  assert.doesNotMatch(block, /font-size|line-height|font-family|--type-/);
});

test('a scene that still overflows in a wider face opens a width wider, never shrinking its type', () => {
  const strip = blocks(
    '(min-width: 64rem) and (min-height: 44rem) and (hover: hover) and (pointer: fine)',
  ).join('\n');
  const room = (scene: string) =>
    declared(
      at(`.hc[data-view='strip'] .hc-shell:not([data-fit='over']) .hc-scene[data-room]${scene}`),
      strip,
    );
  assert.match(room("[data-w='4']"), /--layout-cols: 6;/);
  assert.match(room("[data-w='6']"), /--layout-cols: 8;/);
  // Eight columns, or the laptop's ten for two sections, open to the full twelve, a half each.
  assert.ok(strip.includes(".hc-scene[data-room][data-w='8'],"));
  assert.match(
    strip,
    /\.hc-scene\[data-room\]\[data-kind='sections'\]\[data-w='8'\]:has\(\.hc-section \+ \.hc-section\) \{\s*--layout-cols: 12;/,
  );
  assert.match(
    strip,
    /\.hc-scene\[data-room\]\[data-kind='sections'\]\[data-w='8'\]\s*\.hc-pic\s*> :is\(\.hc-section \+ \.hc-section, \.hc-section:has\(\+ \.hc-section\)\) \{\s*grid-column: span 6;/,
  );
  // A full-width signature work gives its words a column of its still's.
  assert.match(
    room(' .hc-lead'),
    /'still still still still still still \. words words words words words'/,
  );
  // Room alone: no rule keyed to it sets a size, line height, or face.
  for (const [, head, body] of strip.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head!.includes('[data-room]'))
      assert.doesNotMatch(body!, /font-size|line-height|font-family|--type-|zoom|scale/);
  }
});

test('top to bottom the stage rings its edges over its scenes while it has focus, and only there', () => {
  const ring = declared(at(".hc-shell[data-fit='over'] .hc-stage:focus-visible::after"), CSS);
  assert.match(ring, /content: '';/);
  assert.match(ring, /position: absolute;/);
  assert.match(ring, /z-index: 1;/);
  assert.match(ring, /inset: 0;/);
  assert.match(ring, /border: var\(--ui-focus-width\) solid var\(--color-focus\);/);
  assert.match(ring, /pointer-events: none;/);
  // The pinned strip draws none of its own: the rule names the stacked shell alone.
  assert.equal(declared(at('.hc-stage:focus-visible::after'), CSS), '');
});

test('a scene’s words arrive by moving alone, never dimmed, so a frame off screen keeps its contrast', () => {
  const arrive = CSS.slice(CSS.indexOf('@keyframes horizontal-cinema-arrive'));
  const body = arrive.slice(0, arrive.indexOf('\n}\n'));
  assert.match(body, /transform: translateX\(var\(--layout-arrive\)\);/);
  assert.doesNotMatch(body, /opacity|filter/);
});

test('a touch screen in the strip’s room shows the strip’s bar in flow and Strip | List, by size and pointer both (row 43)', () => {
  const ROOM = '(min-width: 64rem) and (min-height: 44rem)';
  const TOUCH = `screen and ${ROOM} and (not ((hover: hover) and (pointer: fine)))`;
  const BAR = at(".hc[data-view='strip'] .hc-shell:not([data-fit='over']) .hc-scrub");
  const touch = blocks(TOUCH);
  assert.equal(touch.length, 1);
  const bar = declared(BAR, touch[0]!);
  for (const rule of [/display: flex;/, /flex-wrap: wrap;/]) assert.match(bar, rule);
  // In flow: the bar lies at the end of the scenes, so nothing it covers, on screen or on paper.
  assert.doesNotMatch(bar, /position:|inset-|z-index:/);
  assert.match(
    declared(at(".hc[data-view='strip'] .hc-chrome__views"), touch[0]!),
    /display: inline-flex;/,
  );
  // A screen's only: on paper the print rule's hidden bar stands, by touch as by mouse.
  assert.equal(blocks(TOUCH.replace('screen and ', '')).length, 0);
  assert.match(blocks('print').join('\n'), /\.hc-scrub,[^{]*\{\s*display: none;/);
  // Nothing else shows the bar or sticks it, so a phone, a short landscape window, the mouse strip,
  // and the fallback a face too wide sends top to bottom keep what they had.
  assert.doesNotMatch(CSS, /\.hc-scrub \{[^}]*position: sticky/);
  assert.equal(
    [...CSS.matchAll(/@media ([^{]+) \{/g)].filter(
      ([, query]) =>
        /not \(\(hover: hover\) and \(pointer: fine\)\)/.test(query!) && !query!.includes(ROOM),
    ).length,
    0,
  );
});

test('on paper the skip link stays in the page, off it by its own move as on screen, never removed', () => {
  const print = blocks('print').join('\n');
  assert.doesNotMatch(print, /\.hc-skip[,\s{]/);
  assert.match(
    declared(at('.hc-skip'), CSS),
    /position: absolute;[\s\S]*transform: translateY\(-200%\);/,
  );
});

test('the title card’s name rises into place at full strength, never from transparent, with or without a script', () => {
  const rise = CSS.slice(CSS.indexOf('@keyframes horizontal-cinema-rise'));
  const body = rise.slice(0, rise.indexOf('\n}\n'));
  assert.match(body, /transform: translateY\(0\.12em\);/);
  assert.doesNotMatch(body, /opacity|filter/);
  assert.match(CSS, /\.hc-card__name \{\n\s+animation: horizontal-cinema-rise /);
});

test('on the matte’s bands a focus ring is the band’s ink, through the focus color the platform’s ring reads', () => {
  // The platform draws every ring from --color-focus in a later layer than this stylesheet, so a
  // band sets the color it inherits, and no outline color of its own, which would lose to it.
  // The top line's own links take it from their own rule, below: the band itself keeps the page's.
  for (const band of ['.hc-bar', '.hc-scene[data-matte]'])
    assert.match(declared(at(band), CSS), /--color-focus: var\(--color-on-scrim\);/, band);
  assert.doesNotMatch(CSS, /outline-color/);
});

test('the end credits are a band of the matte, so their rings are the band’s ink too, under more contrast as at rest (row 46)', () => {
  // The roll's ground is the matte and its links the matte's ink, as on a bar; the page's focus
  // color is the canvas's, and under prefers-contrast: more it's the text color, dark on the matte.
  const credits = declared(at('.hc-credits'), CSS);
  assert.match(credits, /background-color: var\(--layout-matte\);/);
  assert.match(declared(at('.hc-credits a'), CSS), /color: var\(--color-on-scrim\);/);
  assert.match(credits, /--color-focus: var\(--color-on-scrim\);/);
});

test('a ring is shaped through the focus tokens alone: no outline of its own, and the stage and a scene ring inside their edges', () => {
  // An outline here loses to the platform's ring, a later layer, so the stylesheet sets none.
  assert.doesNotMatch(CSS, /(^|[\s;{])outline(-[a-z]+)?\s*:/m);
  for (const part of ['.hc-stage:focus-visible', '.hc-scene:focus-visible'])
    assert.match(
      declared(at(part), CSS),
      /--ui-focus-offset: calc\(var\(--ui-focus-width\) \* -1\);/,
      part,
    );
  for (const part of [
    '.hc-minimap__chapter a:focus-visible',
    '.hc-board__map a:focus-visible',
    '.hc-record__item:focus-within > .hc-record__summary:focus-visible',
  ])
    assert.match(declared(at(part), CSS), /--ui-focus-offset: var\(--space-3xs\);/, part);
});

test('on the title card a focus ring is the canvas’s ink, text-primary: the card’s panel is the canvas, not the matte', () => {
  // The matte scene's rule gives its rings the band's ink, on-scrim; the card inside it is drawn on
  // the canvas, so it sets the focus color its rings read there, and still no outline of its own.
  assert.match(
    declared(at('.hc-scene[data-matte] .hc-card'), CSS),
    /--color-focus: var\(--color-text-primary\);/,
  );
  assert.doesNotMatch(CSS, /(^|[\s;{])outline(-[a-z]+)?\s*:/m);
});

test('a bar’s Next rings inside its bar: an inset ring, and the box grown by the ring’s width each side so it clears the text', () => {
  // The bar is barely taller than the link's line, so a ring offset outward overhangs it onto the
  // scene's canvas, in the band's light ink. Inset, the ring keeps to the box; the padding gives it
  // the ring's width clear of the text, and the margin takes that back, so the text stays put.
  assert.match(
    declared(at('.hc-bar__next:focus-visible'), CSS),
    /--ui-focus-offset: calc\(var\(--ui-focus-width\) \* -1\);/,
  );
  const next = declared(at('.hc-bar__next'), CSS);
  assert.match(next, /padding-inline: var\(--ui-focus-width\);/);
  assert.match(next, /margin-inline: calc\(var\(--ui-focus-width\) \* -1\);/);
});

test('no other link in a bar sets its ring’s offset: the inset is the Next link’s alone, the one with the padding to clear its text', () => {
  const next = at('.hc-bar__next:focus-visible');
  const others = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, head, body]) => ({ head: head!.trim().replace(/\s+/g, ' '), body: body! }))
    .filter(({ head, body }) => head.includes('.hc-bar') && body.includes('--ui-focus-offset'))
    .map(({ head }) => head)
    .filter((head) => head !== next);
  assert.deepEqual(others, []);
});

/** The top line's own links: its name and its site nav, never the band as a whole. */
const TOP_LINE_LINKS = ':is(.hc-chrome__name, .hc-chrome__nav)';

test('on the top line only its own links ring in the band’s ink, so the visitor’s control keeps the page’s focus color', () => {
  // The visitor's control (the Appearance summary) draws on its own surface, so the band's ink
  // there was a regression (#213's cluster D); the name and the nav sit on the band itself.
  assert.doesNotMatch(declared(at('.hc-chrome'), CSS), /--color-focus/);
  assert.match(declared(at(TOP_LINE_LINKS), CSS), /--color-focus: var\(--color-on-scrim\);/);
});

test('every top-line link row 90 cleared takes the band’s ink from the name and nav rule: the name, Strip, List and Get in touch', () => {
  assert.match(declared(at(TOP_LINE_LINKS), CSS), /--color-focus: var\(--color-on-scrim\);/);
  const index = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const header = index.slice(
    index.indexOf('<header className="hc-chrome">'),
    index.indexOf('</header>'),
  );
  const nav = header.slice(
    header.indexOf('<nav className="hc-chrome__nav"'),
    header.indexOf('</nav>') + '</nav>'.length,
  );
  assert.match(header, /<a className="hc-chrome__name"/);
  assert.match(nav, /<span className="hc-chrome__views"/);
  assert.match(nav, />Strip</);
  assert.match(nav, />List</);
  assert.match(nav, /<a className="hc-chrome__contact"/);
  // Every link the top line draws is its name or one in the nav: the visitor's control is a slot.
  const links = (text: string) => (text.match(/<a\b/g) ?? []).length;
  assert.equal(links(header), 1 + links(nav));
});
