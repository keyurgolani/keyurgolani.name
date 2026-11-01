// The outline check (stream E, compositions own their components): what a
// composition's server markup must hold however it designs its pages, now
// that each one owns its navigation, frames, and pages. It's semantic, not
// stylistic: one h1; one main, the host's skip link's target, focusable;
// headings that never skip a level on the way down; every section's frame
// carrying the attributes renderSection() gives it; every navigation
// landmark labelled; and every link a real one, which works with no
// JavaScript and lands when it names a place on the page. It reads the
// markup react-dom/server writes, so `pnpm test` runs it with no browser.

/** What checkOutline() finds. */
export type OutlineCode =
  | 'outline.h1'
  | 'outline.main'
  | 'outline.heading-skip'
  | 'outline.frame'
  | 'outline.nav-label'
  | 'outline.link';

export interface OutlineFinding {
  readonly code: OutlineCode;
  /** The element, as a CSS-like path such as `main#main > section#about > h4`. */
  readonly at: string;
  readonly message: string;
  /** The content id of the section a frame finding is about. */
  readonly section?: string;
}

/**
 * A section the page must frame, as pageOutline() lists it: its content id,
 * and the DOM id its frame carries, none when the composition gives it no
 * anchor.
 */
export interface ExpectedSection {
  readonly id: string;
  readonly anchor?: string;
}

export interface OutlineOptions {
  /**
   * Every section the page renders, from pageOutline(input, composition).
   * With it, a section with no frame on the page is a finding, and so is a
   * frame whose id isn't its anchor. Without it, only the frames on the page
   * are checked, each against the prefix and its own section id.
   */
  readonly sections?: readonly ExpectedSection[];
}

/** The render's ids, from its VariantRenderInput. */
export interface OutlineIds {
  /** The id of the composition's one main, which the host's skip link targets. */
  readonly main: string;
  /** What every id the composition renders starts with. */
  readonly prefix: string;
}

interface Element {
  readonly tag: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: (Element | string)[];
  readonly parent: Element | undefined;
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Parses markup as react-dom/server writes it: every element closed or void,
 * every attribute quoted. It reads a fragment or a whole document.
 */
export function parseMarkup(html: string): Element {
  const root: Element = { tag: '#root', attrs: new Map(), children: [], parent: undefined };
  let current = root;
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt === -1) {
      current.children.push(decode(html.slice(at)));
      break;
    }
    if (lt > at) current.children.push(decode(html.slice(at, lt)));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      at = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html
        .slice(lt + 2, end === -1 ? html.length : end)
        .trim()
        .toLowerCase();
      // Close the nearest open element of that name, and anything left open inside it.
      for (let open: Element | undefined = current; open && open !== root; open = open.parent) {
        if (open.tag === name) {
          current = open.parent!;
          break;
        }
      }
      at = end === -1 ? html.length : end + 1;
      continue;
    }
    const match = /^<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!match) {
      current.children.push('<');
      at = lt + 1;
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const body = match[2]!;
    const selfClosing = body.trimEnd().endsWith('/');
    const attrs = new Map<string, string>();
    for (const [, name, double, single, bare] of body.replace(/\/\s*$/, '').matchAll(ATTRIBUTE)) {
      attrs.set(name!.toLowerCase(), decode(double ?? single ?? bare ?? ''));
    }
    const element: Element = { tag, attrs, children: [], parent: current };
    current.children.push(element);
    at = lt + match[0].length;
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, at);
      element.children.push(html.slice(at, end === -1 ? html.length : end));
      const close = end === -1 ? -1 : html.indexOf('>', end);
      at = close === -1 ? html.length : close + 1;
      continue;
    }
    current = element;
  }
  return root;
}

function* walk(element: Element): Generator<Element> {
  for (const child of element.children) {
    if (typeof child === 'string') continue;
    yield child;
    yield* walk(child);
  }
}

function textOf(element: Element): string {
  return element.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}

/**
 * Whether the element is out of the accessibility tree: inside a `hidden`
 * or `aria-hidden="true"` element, a template, or a dialog that isn't open,
 * which a modal shows on top of the page when it opens.
 */
function unrendered(element: Element): boolean {
  for (let at: Element | undefined = element; at && at.tag !== '#root'; at = at.parent) {
    if (at.attrs.has('hidden') || at.attrs.get('aria-hidden') === 'true') return true;
    if (at.tag === 'template') return true;
    if (at.tag === 'dialog' && !at.attrs.has('open')) return true;
  }
  return false;
}

function pathOf(element: Element): string {
  const parts: string[] = [];
  for (let at: Element | undefined = element; at && at.tag !== '#root'; at = at.parent) {
    const id = at.attrs.get('id');
    parts.unshift(id ? `${at.tag}#${id}` : at.tag);
  }
  return parts.slice(-4).join(' > ');
}

const HEADING = /^h([1-6])$/;

/**
 * Every outline rule the markup breaks, in document order; none when it
 * holds. `html` is a composition's render, or a whole page holding one.
 */
export function checkOutline(
  html: string,
  ids: OutlineIds,
  options: OutlineOptions = {},
): OutlineFinding[] {
  const root = parseMarkup(html);
  const elements = [...walk(root)];
  const found: OutlineFinding[] = [];
  const add = (
    code: OutlineCode,
    element: Element | undefined,
    message: string,
    section?: string,
  ) =>
    found.push({
      code,
      at: element ? pathOf(element) : '(page)',
      message,
      ...(section !== undefined ? { section } : {}),
    });
  const expected = new Map((options.sections ?? []).map((entry) => [entry.id, entry]));
  const byId = new Map<string, Element>();
  for (const element of elements) {
    const id = element.attrs.get('id');
    if (id !== undefined && !byId.has(id)) byId.set(id, element);
  }

  // One h1, the page's own title.
  const h1s = elements.filter((element) => element.tag === 'h1' && !unrendered(element));
  if (h1s.length !== 1) {
    add('outline.h1', h1s[1], `The page has ${h1s.length} h1 elements, and needs exactly one.`);
  }

  // One main: the skip link's target, which takes focus when the link moves it there.
  const mains = elements.filter((element) => element.tag === 'main');
  if (mains.length !== 1) {
    add('outline.main', mains[1], `The page has ${mains.length} main elements, and needs one.`);
  }
  const main = mains[0];
  if (main && main.attrs.get('id') !== ids.main) {
    add(
      'outline.main',
      main,
      `The main's id is ${main.attrs.get('id') ?? 'missing'}, and the skip link targets ${ids.main}.`,
    );
  }
  if (main && main.attrs.get('tabindex') !== '-1') {
    add('outline.main', main, 'The main needs tabindex="-1", so the skip link moves focus to it.');
  }

  // Headings never skip a level on the way down.
  let previous: number | undefined;
  for (const element of elements) {
    const level = HEADING.exec(element.tag)?.[1];
    if (level === undefined || unrendered(element)) continue;
    const n = Number(level);
    if (previous !== undefined && n > previous + 1) {
      add('outline.heading-skip', element, `An h${n} follows an h${previous}, skipping a level.`);
    }
    previous = n;
  }

  // Every section the page renders has a frame, and every frame carries
  // what renderSection() gives it.
  const framed = new Set<string>();
  for (const element of elements) {
    const section = element.attrs.get('data-section-id');
    if (section === undefined) continue;
    framed.add(section);
    const problems: string[] = [];
    if (element.tag !== 'section' && element.tag !== 'article') {
      problems.push(`is a ${element.tag}, not a section or an article`);
    }
    const listed = expected.get(section);
    const anchor = listed ? listed.anchor : `${ids.prefix}${section}`;
    const id = element.attrs.get('id');
    if (id !== anchor) {
      problems.push(
        anchor === undefined
          ? `has the id ${id}, and the composition gives it no anchor`
          : `has the id ${id ?? '(none)'}, not ${anchor}`,
      );
    }
    if (!element.attrs.get('data-kind')) problems.push('has no data-kind');
    const renderer = element.attrs.get('data-renderer');
    if (renderer !== 'bespoke' && renderer !== 'shared') {
      problems.push(`has data-renderer ${renderer ?? '(none)'}, not bespoke or shared`);
    }
    const dir = element.attrs.get('dir');
    if (dir !== undefined && dir !== 'ltr' && dir !== 'rtl') problems.push(`has dir ${dir}`);
    if (problems.length > 0) {
      add(
        'outline.frame',
        element,
        `The frame of section ${section} ${problems.join(', ')}.`,
        section,
      );
    }
  }
  for (const section of expected.values()) {
    if (framed.has(section.id)) continue;
    const stand = section.anchor === undefined ? undefined : byId.get(section.anchor);
    add(
      'outline.frame',
      stand,
      stand
        ? `Section ${section.id} renders, and its anchor is on a ${stand.tag}, not on a frame with data-section-id.`
        : `Section ${section.id} renders, and the page has no frame for it.`,
      section.id,
    );
  }

  // Every navigation landmark has a name.
  for (const element of elements) {
    if (element.tag !== 'nav' || unrendered(element)) continue;
    const label = element.attrs.get('aria-label')?.trim();
    const labelledBy = element.attrs.get('aria-labelledby')?.trim();
    const named =
      (label !== undefined && label !== '') ||
      (labelledBy !== undefined &&
        labelledBy !== '' &&
        labelledBy.split(/\s+/).every((id) => byId.has(id)) &&
        labelledBy
          .split(/\s+/)
          .map((id) => textOf(byId.get(id)!))
          .join(' ')
          .trim() !== '');
    if (!named) {
      add(
        'outline.nav-label',
        element,
        'The navigation has no name: give it aria-label, or aria-labelledby naming text on the page.',
      );
    }
  }

  // Every link is a real one, and a link to a place on the page lands.
  for (const element of elements) {
    if (element.tag !== 'a') continue;
    const href = element.attrs.get('href');
    if (href === undefined || href.trim() === '' || href.trim() === '#') {
      add(
        'outline.link',
        element,
        'The link has no destination, so it does nothing without a script.',
      );
      continue;
    }
    if (/^\s*javascript:/i.test(href)) {
      add('outline.link', element, 'The link runs a script instead of going somewhere.');
      continue;
    }
    if (href.startsWith('#')) {
      let target: string;
      try {
        target = decodeURIComponent(href.slice(1));
      } catch {
        target = href.slice(1);
      }
      if (!byId.has(target)) {
        add(
          'outline.link',
          element,
          `The link goes to ${href}, and nothing on the page has that id.`,
        );
      }
    }
  }
  return found;
}
