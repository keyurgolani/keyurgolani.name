import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The stylesheet's no-script and print paths, which no Chromium e2e can tell
// apart from the engine's own behaviour: Chromium opens a fold for its
// fragment, and its print preview runs beforeprint. These rules carry the
// other engines.

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The body of the first `@supports selector(::details-content)` block after `from`. */
function supportsBlock(from = 0): string {
  const at = CSS.indexOf('@supports selector(::details-content)', from);
  assert.ok(at >= 0, 'an @supports selector(::details-content) block');
  let depth = 0;
  for (let i = CSS.indexOf('{', at); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(at, i + 1);
  }
  return CSS.slice(at);
}

/** The body of the stylesheet's print block. */
function printBlock(): string {
  const at = CSS.indexOf('@media print');
  assert.ok(at >= 0);
  return CSS.slice(at);
}

test('print opens every disclosure through ::details-content: the folds, the archive, the abstracts', () => {
  const block = supportsBlock(CSS.indexOf('@media print'));
  assert.match(
    block,
    /:is\(\.ss-fold, \.ss-archive, \.ss-more\)::details-content\s*\{[^}]*content-visibility:\s*visible/,
  );
});

test('print: press links print their address, the way back to the top is gone, no doubled rule', () => {
  const print = printBlock();
  assert.match(
    print,
    /:is\([^)]*\.ss-press[^)]*\)\s*a\[href\^='http'\]:not\(\[data-address\]\)\s*\.ss-addr\s*\{\s*display:\s*inline/,
  );
  assert.match(print, /:is\(\.ss-top, \.ss-colophon__page\)\s*\{\s*display:\s*none/);
  // An address never breaks inside a word on paper; in a table it takes its own line.
  assert.doesNotMatch(print, /attr\(href\)[^}]*overflow-wrap:\s*anywhere/);
  assert.match(print, /\.ss-table \.ss-addr\s*\{\s*display:\s*block/);
  assert.match(print, /\.ss-fold:last-child\s*\{\s*border-block-end:\s*0/);
});

test('a closed disclosure shows closed on screen: only print shows its content', () => {
  // Every rule outside print that would show a ::details-content: none. One for
  // :has(:target) held a fold open after the reader closed it (code review, finding 2).
  const screen = CSS.slice(0, CSS.indexOf('@media print')).replace(/\/\*[\s\S]*?\*\//g, '');
  const shown = [...screen.matchAll(/([^{}]*::details-content[^{}]*)\{([^{}]*)\}/g)].filter(
    ([, , body]) => /content-visibility:\s*visible|display:\s*block/.test(body!),
  );
  assert.deepEqual(
    shown.map(([, selector]) => selector!.trim()),
    [],
  );
});

test('container-type never lands on a subgrid: containment would turn its columns into none', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.trim(),
    body: body!,
  }));
  const subgrids = new Set(
    rules
      .filter((rule) => /grid-template-columns:\s*subgrid/.test(rule.body))
      .flatMap((rule) =>
        [...rule.selector.matchAll(/\.(ss-[\w-]+)\s*$/gm)].map(([, name]) => name!),
      ),
  );
  assert.ok(subgrids.has('ss-next'), 'the Next block is a subgrid');
  for (const rule of rules.filter((each) => /container-type:/.test(each.body))) {
    for (const [, name] of rule.selector.matchAll(/\.(ss-[\w-]+)/g)) {
      assert.ok(!subgrids.has(name!), `${name} is a subgrid and a container: ${rule.selector}`);
    }
  }
});

test("an open fold drops its frame's own heading, titled or not (the summary's h3 is the section's)", () => {
  // By element, not class: an untitled section's heading is .ss-hidden, not .ss-head__title.
  assert.match(
    CSS,
    /\.ss-fold\s*>\s*\.ss-section\s*>\s*\.ss-grid\s*>\s*\.ss-head\s*>\s*:is\(h2, h3, h4, h5, h6\)\s*\{\s*display:\s*none/,
  );
});

test('on paper an address breaks at its separators, never inside a word, and shows on paper alone', () => {
  const print = printBlock();
  const screen = CSS.slice(0, CSS.indexOf('@media print'));
  assert.match(screen, /\.ss-addr\s*\{\s*display:\s*none/);
  // No nowrap on a printed address: it set the column's minimum past the paper.
  assert.doesNotMatch(print, /(?:\.ss-addr|attr\(href\))[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(print, /::after\s*\{\s*white-space:\s*nowrap/);
  assert.doesNotMatch(print, /attr\(href\)[^}]*overflow-wrap:\s*anywhere/);
});

test("the case title's poster line balances its wrap: the h1 inside it is inline", () => {
  assert.match(CSS, /\.ss-case__poster \.ss-poster__line\s*\{[^}]*text-wrap:\s*balance/);
});

test('print holds one rule setting a table address on its own line', () => {
  const print = printBlock();
  assert.equal(print.match(/\.ss-table \.ss-addr\s*[,{]/g)?.length, 1);
});

test("a part opener's contents keep room between their lines for a link's 2px focus ring and its offset", () => {
  const rule = /\.ss-part__toc\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  const leading = Number(/line-height:\s*([\d.]+)/.exec(rule)?.[1]);
  // At step 2 the content area is about 1.2em: 1.6 leaves 0.4em, over 4px of ring and offset each side.
  assert.ok(leading >= 1.5, `line-height ${leading}`);
});

test("the About spread's side column sets its sections in one column, so text at 200% can't push it past the page", () => {
  assert.match(
    CSS,
    /\.ss-spread__side \.ss-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);?\s*\}/,
  );
  assert.match(CSS, /\.ss-spread__side \.ss-head__sub\s*\{\s*grid-column:\s*1 \/ -1;?\s*\}/);
});

test('the call to action keeps its text off the accent band at every moment: the band in its padding, an ink ground on hover and focus, no transition', () => {
  const rules = [...CSS.matchAll(/([^{}]*\.ss-cta(?::[a-z-]+)?)\s*\{([^}]*)\}/g)]
    .filter(([, selector]) => /\.ss-cta(?::(?:hover|focus-visible))?\s*$/.test(selector!.trim()))
    .map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }));
  const rest = rules.find(({ selector }) => /\.ss-cta$/.test(selector))!;
  assert.ok(rest, 'the resting rule');
  // The band's 3px sit in the padding, under the content box the text's contrast is read in.
  const padding = Number(/padding-block-end:\s*([\d.]+)em/.exec(rest.body)?.[1]);
  assert.ok(padding >= 0.25, `padding-block-end ${padding}em`);
  // The ink ground reaches past the words, while the text and its band keep the flush-left line.
  assert.match(rest.body, /padding-inline:\s*0\.2em/);
  assert.match(rest.body, /margin-inline:\s*-0\.2em/);
  assert.match(rest.body, /no-repeat 0\.2em 100% \/\s*calc\(100% - 0\.4em\)/);
  for (const { selector, body } of rules) {
    assert.doesNotMatch(body, /transition/, `${selector}: no frame between the states`);
    // Never the accent behind the text, nor on-accent text: white on this accent is 4.42:1.
    assert.doesNotMatch(body, /background-size:\s*100% 100%|--color-on-accent/, selector);
  }
  const active = rules.filter(({ selector }) => /:(hover|focus-visible)$/.test(selector));
  assert.equal(active.length, 2);
  for (const { body } of active) {
    assert.match(body, /background-color:\s*var\(--color-text-primary\)/);
    assert.match(body, /color:\s*var\(--color-canvas\)/);
  }
});

test('the display-size address on its band changes state at once: no transition between its two states', () => {
  const rest = /\.ss-email a\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(rest, /background:/);
  assert.doesNotMatch(rest, /transition/);
});

test("a figure's number never wraps, and the figure steps down to its cell by its run's length", () => {
  assert.match(CSS, /\.ss-fig__run\s*\{\s*white-space:\s*nowrap;?\s*\}/);
  assert.match(
    CSS,
    /\.ss-fig__value\s*\{[^}]*font-size:\s*min\(var\(--type-step-4\), calc\(100cqi \/ \(var\(--layout-ss-fig, 4\) \* 0\.62\)\)\)/,
  );
  assert.match(CSS, /\.ss-fig\s*\{\s*container-type:\s*inline-size;?\s*\}/);
});

test("a secondary line after the owner's paragraph, in a cell or a fact sheet, takes the block gap on one shared rule", () => {
  const rules = [...CSS.matchAll(/([^{}]*\.pf-rich-text\s*\+\s*p\s*)\{([^}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: selector!.trim(), body: body! }),
  );
  assert.equal(rules.length, 1, 'one rule');
  assert.match(rules[0]!.selector, /:is\(td, \.ss-sheet-fact__main\) \.pf-rich-text \+ p$/);
  assert.match(rules[0]!.body, /margin-block-start:\s*var\(--space-xs\)/);
});
