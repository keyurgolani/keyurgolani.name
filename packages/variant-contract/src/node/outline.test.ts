import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOutline, parseMarkup, type OutlineCode } from './outline';

// The outline check (stream E). Each rule has a page that keeps it and one
// that breaks it, and the finding names the rule and the element.

const IDS = { main: 'main', prefix: '' };

/** A page that keeps every rule; `parts` replace its pieces. */
function page(parts: { header?: string; main?: string; mainAttrs?: string } = {}): string {
  const header =
    parts.header ??
    '<header><nav aria-labelledby="nav-label"><span id="nav-label" hidden>Sections</span><ul><li><a href="#main">Skip ahead</a></li></ul></nav></header>';
  const main =
    parts.main ??
    '<h1>Rowan Vale</h1><section id="about" data-section-id="about" data-kind="lede" data-renderer="shared"><h2>About</h2><p>Hi.</p></section>';
  return `${header}<main ${parts.mainAttrs ?? 'id="main" tabindex="-1"'}>${main}</main>`;
}

const codes = (html: string, ids = IDS): OutlineCode[] =>
  checkOutline(html, ids).map(({ code }) => code);

test('a page that keeps every rule has no finding', () => {
  assert.deepEqual(checkOutline(page(), IDS), []);
});

test('outline.h1: exactly one h1, not counting one out of the accessibility tree', () => {
  assert.deepEqual(codes(page({ main: '<h2>No title</h2>' })), ['outline.h1']);
  const two = checkOutline(page({ main: '<h1>One</h1><h1>Two</h1>' }), IDS);
  assert.deepEqual(
    two.map(({ code, at }) => [code, at]),
    [['outline.h1', 'main#main > h1']],
  );
  assert.deepEqual(codes(page({ main: '<h1>One</h1><div hidden><h1>Two</h1></div>' })), []);
});

test('outline.main: one main, the skip link target, focusable', () => {
  assert.deepEqual(
    codes(page({ header: '<header></header>', mainAttrs: 'id="content" tabindex="-1"' })),
    ['outline.main'],
  );
  assert.deepEqual(codes(page({ mainAttrs: 'id="main"' })), ['outline.main']);
  assert.deepEqual(codes('<h1>Name</h1>'), ['outline.main']);
  assert.deepEqual(codes(`${page()}<main id="other" tabindex="-1"></main>`), ['outline.main']);
  assert.deepEqual(
    codes(page({ mainAttrs: 'id="pv-main" tabindex="-1"' }), {
      main: 'pv-main',
      prefix: 'pv-',
    }).filter((code) => code === 'outline.main'),
    [],
  );
});

test('outline.heading-skip: a heading is at most one level deeper than the one before it', () => {
  const skipped = checkOutline(
    page({
      main: '<h1>Name</h1><section id="about" data-section-id="about" data-kind="lede" data-renderer="shared"><h3>About</h3></section>',
    }),
    IDS,
  );
  assert.deepEqual(
    skipped.map(({ code, at }) => [code, at]),
    [['outline.heading-skip', 'main#main > section#about > h3']],
  );
  // Going back up any number of levels is fine, and so is a heading before the h1.
  assert.deepEqual(
    codes(
      page({
        header: '<header><h2>Menu</h2></header>',
        main: '<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>',
      }),
    ),
    [],
  );
  // A dialog that isn't open, and hidden markup, aren't in the page's outline.
  assert.deepEqual(codes(page({ main: '<h1>A</h1><dialog><h4>Menu</h4></dialog><h2>B</h2>' })), []);
  assert.deepEqual(codes(page({ main: '<h1>A</h1><dialog open><h4>Menu</h4></dialog>' })), [
    'outline.heading-skip',
  ]);
});

test('outline.frame: every section frame is a section or article with the attributes renderSection() gives it', () => {
  const frame = (attrs: string, tag = 'section') =>
    page({ main: `<h1>Name</h1><${tag} ${attrs}><h2>About</h2></${tag}>` });
  const good = 'id="about" data-section-id="about" data-kind="lede" data-renderer="shared"';
  assert.deepEqual(codes(frame(good, 'article')), []);
  assert.deepEqual(codes(frame(`${good} lang="en" dir="ltr"`)), []);
  assert.deepEqual(codes(frame(good, 'div')), ['outline.frame']);
  assert.deepEqual(
    codes(frame('id="other" data-section-id="about" data-kind="lede" data-renderer="shared"')),
    ['outline.frame'],
  );
  assert.deepEqual(codes(frame('id="about" data-section-id="about" data-renderer="shared"')), [
    'outline.frame',
  ]);
  assert.deepEqual(codes(frame('id="about" data-section-id="about" data-kind="lede"')), [
    'outline.frame',
  ]);
  assert.deepEqual(codes(frame(`${good.replace('shared', 'mine')}`)), ['outline.frame']);
  assert.deepEqual(codes(frame(`${good} dir="auto"`)), ['outline.frame']);
  // The id carries the render's prefix.
  const prefixed = page({
    mainAttrs: 'id="pv-main" tabindex="-1"',
    header: '<header></header>',
    main: '<h1>Name</h1><section id="about" data-section-id="about" data-kind="lede" data-renderer="shared"></section>',
  });
  assert.deepEqual(codes(prefixed, { main: 'pv-main', prefix: 'pv-' }), ['outline.frame']);
});

test('outline.nav-label: every navigation landmark has a name', () => {
  const nav = (attrs: string, extra = '') =>
    page({ header: `<header>${extra}<nav ${attrs}><a href="#about">About</a></nav></header>` });
  assert.deepEqual(codes(nav('aria-label="Sections"')), []);
  assert.deepEqual(codes(nav('aria-labelledby="l"', '<span id="l">Sections</span>')), []);
  assert.deepEqual(codes(nav('')), ['outline.nav-label']);
  assert.deepEqual(codes(nav('aria-label="  "')), ['outline.nav-label']);
  assert.deepEqual(codes(nav('aria-labelledby="missing"')), ['outline.nav-label']);
  assert.deepEqual(codes(nav('aria-labelledby="l"', '<span id="l"></span>')), [
    'outline.nav-label',
  ]);
  // Every id it names must be on the page, not only one of them.
  assert.deepEqual(codes(nav('aria-labelledby="l missing"', '<span id="l">Sections</span>')), [
    'outline.nav-label',
  ]);
  // A nav out of the accessibility tree is no landmark, so it needs no name.
  assert.deepEqual(codes(nav('hidden')), []);
  assert.deepEqual(codes(nav('aria-hidden="true"')), []);
  assert.deepEqual(
    codes(
      page({ header: '<header><template><nav><a href="#main">Main</a></nav></template></header>' }),
    ),
    [],
  );
});

test('outline.h1 and outline.heading-skip pass over markup out of the accessibility tree', () => {
  const extra = (markup: string) => page({ main: `<h1>Name</h1>${markup}<h2>About</h2>` });
  assert.deepEqual(codes(extra('<div aria-hidden="true"><h1>Logo</h1><h4>Mark</h4></div>')), []);
  assert.deepEqual(codes(extra('<template><h1>Later</h1><h5>Deep</h5></template>')), []);
  assert.deepEqual(codes(extra('<div aria-hidden="false"><h1>Again</h1></div>')), ['outline.h1']);
});

test('outline.frame with the sections the page renders: each has a frame, carrying its anchor or none', () => {
  const frame = (attrs: string) =>
    `<section ${attrs} data-section-id="about" data-kind="lede" data-renderer="shared"><h2>About</h2></section>`;
  const html = (main: string) =>
    page({ header: '<header></header>', main: `<h1>Name</h1>${main}` });
  const about = { id: 'about', anchor: 'about' };
  const check = (main: string, sections: { id: string; anchor?: string }[]) =>
    checkOutline(html(main), IDS, { sections }).map(({ code, section }) => [code, section]);
  assert.deepEqual(check(frame('id="about"'), [about]), []);
  // A section the page renders with no frame: on its own, or as a bare anchor.
  assert.deepEqual(check('', [about]), [['outline.frame', 'about']]);
  const bare = checkOutline(html('<span id="about"></span><p>About, folded.</p>'), IDS, {
    sections: [about],
  });
  assert.deepEqual(
    bare.map(({ code, at, section }) => [code, at, section]),
    [['outline.frame', 'main#main > span#about', 'about']],
  );
  assert.match(bare[0]!.message, /its anchor is on a span, not on a frame/);
  // A frame that keeps its attributes but loses its id, or takes another.
  assert.deepEqual(check(frame(''), [about]), [['outline.frame', 'about']]);
  assert.deepEqual(check(frame('id="other"'), [about]), [['outline.frame', 'about']]);
  // An anchor the composition moved, or took away.
  assert.deepEqual(check(frame('id="intro"'), [{ id: 'about', anchor: 'intro' }]), []);
  assert.deepEqual(check(frame(''), [{ id: 'about' }]), []);
  assert.deepEqual(check(frame('id="about"'), [{ id: 'about' }]), [['outline.frame', 'about']]);
});

test('outline.link: every link goes somewhere without a script, and a link to the page lands', () => {
  const link = (anchor: string) => page({ header: `<header><p>${anchor}</p></header>` });
  assert.deepEqual(codes(link('<a href="/work/tide">Tide</a>')), []);
  assert.deepEqual(codes(link('<a href="https://rowan.test">Site</a>')), []);
  assert.deepEqual(codes(link('<a href="#about">About</a>')), []);
  assert.deepEqual(codes(link('<a href="#main">Main</a>')), []);
  assert.deepEqual(codes(link('<a>Nowhere</a>')), ['outline.link']);
  assert.deepEqual(codes(link('<a href="">Nowhere</a>')), ['outline.link']);
  assert.deepEqual(codes(link('<a href="#">Top</a>')), ['outline.link']);
  assert.deepEqual(codes(link('<a href="javascript:void(0)">Run</a>')), ['outline.link']);
  assert.deepEqual(codes(link('<a href="#missing">Missing</a>')), ['outline.link']);
  // A fragment is matched decoded.
  assert.deepEqual(
    codes(
      page({
        header: '<header><a href="#caf%C3%A9">Café</a></header>',
        main: '<h1 id="café">Name</h1>',
      }),
    ),
    [],
  );
});

test('the parser reads react-dom/server markup: void elements, entities, raw text, and comments', () => {
  const root = parseMarkup(
    '<!DOCTYPE html><p class="a" data-x=\'1\' hidden="">A &amp; B&#x27;s<br/><img src="x.png" alt="&quot;q&quot;"><!-- c --></p><script>if (a < b) {}</script><span>after</span>',
  );
  const [p, script, span] = root.children as unknown as {
    tag: string;
    attrs: Map<string, string>;
    children: unknown[];
  }[];
  assert.equal(p!.tag, 'p');
  assert.equal(p!.attrs.get('hidden'), '');
  assert.equal(p!.attrs.get('data-x'), '1');
  assert.equal(p!.children[0], "A & B's");
  assert.deepEqual(
    (p!.children as { tag?: string; attrs?: Map<string, string> }[])
      .slice(1)
      .map((child) => [child.tag, child.attrs?.get('alt')]),
    [
      ['br', undefined],
      ['img', '"q"'],
    ],
  );
  assert.equal(script!.tag, 'script');
  assert.deepEqual(script!.children, ['if (a < b) {}']);
  assert.equal(span!.tag, 'span');
});
