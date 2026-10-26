import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  resolvePortfolioView,
  routedSlugs,
  type ParsedPair,
} from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import { registerHostModules, type NavigationMenuProps } from '@portfolio/kit/sections';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantManifest,
} from '@portfolio/variant-contract';
import FallbackComposition from '.';

// The fallback composition (#5, Slice 3): its manifest is what the contract
// pins for it, and it renders any portfolio as one main, one h1, one visitor
// control slot, and every visible section through the shared renderers. On
// a work's route (#10b) it renders that work's case study, at h1.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const { PortfolioSchema, SiteSchema } = composeSchemas();

test('its manifest validates with nothing to report, and pins the fallback values', () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'fallback');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['document', 'still', 'light'],
  );
  assert.deepEqual([manifest.renderedKinds, manifest.unsupportedKinds], [[], []]);
  assert.ok(manifest.contentSlots.every(({ level }) => level === 'optional'));
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'missing-variant',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  },
  motionPolicy: 'respect-os',
  features: { feed: true },
});

function render(portfolio: unknown, idPrefix = '') {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
  return markup(pair, idPrefix);
}

function markup(
  pair: ParsedPair,
  idPrefix = '',
  route: RouteTarget = { route: 'home' },
  basePath: '' | '/sample' = '',
) {
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route,
    basePath,
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix,
  });
  return renderToStaticMarkup(<FallbackComposition input={input} />);
}

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

const PORTFOLIO = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Fallback', tagline: 'Builds calm software.' },
  links: [{ url: 'https://rowan.test', label: 'Site' }],
  contact: { message: 'Write any time.' },
  sections: [
    { kind: 'hero', id: 'top' },
    { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
    {
      kind: 'cta',
      id: 'hire',
      title: 'Hire me',
      primaryAction: { url: '#contact', label: 'Write' },
    },
    { kind: 'contact', id: 'contact', title: 'Contact' },
  ],
};

test('one main, one h1 from the hero, one visitor control slot, every section shared in order, then the one closing block', () => {
  const html = render(PORTFOLIO);
  assert.equal(count(html, /<main\b/g), 1);
  assert.match(html, /<main id="main" class="fc-main pf-stack pf-stats--leaders" tabindex="-1">/);
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="pf-hero__name">Rowan Fallback<\/h1>/);
  assert.equal(count(html, /data-visitor-control-slot/g), 1);
  const frames = [
    ...html.matchAll(/<(section|article) id="([^"]+)"[^>]* data-renderer="([^"]+)"/g),
  ];
  // The contact section and the call to action beside it are the closing
  // block after the main, still the shared renderers', the call to action
  // inside the contact's frame, so both anchors land.
  assert.deepEqual(
    frames.map(([, tag, id, renderer]) => [tag, id, renderer]),
    [
      ['section', 'top', 'shared'],
      ['section', 'about', 'shared'],
      ['section', 'contact', 'shared'],
      ['section', 'hire', 'shared'],
    ],
  );
  assert.ok(html.indexOf('</main>') < html.indexOf('<section id="contact"'));
});

test('the main is the kit’s stack, and each section after the first carries its rhythm, a skipped one not counted', () => {
  const html = render({
    ...PORTFOLIO,
    works: [{ id: 'draft', title: 'Draft', medium: 'writing', visibility: 'private' }],
    sections: [
      PORTFOLIO.sections[0],
      // Renders nothing, so the lede after it still follows the hero.
      { kind: 'works', id: 'drafts', title: 'Drafts', items: ['draft'] },
      ...PORTFOLIO.sections.slice(1),
    ],
  });
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const rhythms = [
    ...main.matchAll(/<section id="([^"]+)"[^>]*?(?: data-rhythm="([^"]+)")?>/g),
  ].map(([, id, rhythm]) => [id, rhythm ?? null]);
  // What follows the hero is a group apart: the space above its heading
  // stays more than twice the head below it, never a chapter's. The
  // closing block's sections are the footer's, outside the stack.
  assert.deepEqual(rhythms, [
    ['top', null],
    ['about', 'group'],
  ]);
  // With no hero, the name's h1 opens the page and the first section follows it a group apart.
  const nameFirst = render({ ...PORTFOLIO, sections: PORTFOLIO.sections.slice(1) });
  assert.match(
    nameFirst,
    /<h1 class="fc-name">Rowan Fallback<\/h1><section id="about"[^>]* data-rhythm="group">/,
  );
});

test('the closing block merges the contact and its call to action: one primary action, and every other way in once, quieter', () => {
  const html = render({
    ...PORTFOLIO,
    identity: { ...PORTFOLIO.identity, email: 'rowan@rowan.test' },
    links: [
      { url: 'https://rowan.test', label: 'Site' },
      { url: 'https://rowan.test/cv.pdf', label: 'Resume' },
    ],
    sections: [
      ...PORTFOLIO.sections.filter(({ kind }) => kind !== 'cta'),
      {
        kind: 'cta',
        id: 'hire',
        title: 'Hire me',
        description: 'Two engagements a quarter.',
        primaryAction: { url: 'mailto:rowan@rowan.test', label: 'Email me' },
        secondaryAction: { url: 'https://rowan.test/cv.pdf', label: 'Download CV' },
      },
    ],
  });
  // One block, in the contact's frame: one heading, the contact's title;
  // one message, opening on the call to action's title as its first line,
  // then its description with the contact's message folded in; the
  // actions, the address beside them as text since "Email me" mails it; and
  // the other ways in last. The CV is linked once, under the action's label,
  // and the email isn't listed again: no CSS hides either.
  const closing = html.slice(html.indexOf('<section id="contact"'));
  assert.equal(
    closing,
    '<section id="contact" data-section-id="contact" data-kind="contact" data-renderer="shared" class="fc-closing"><section id="hire" data-section-id="hire" data-kind="cta" data-renderer="shared" class="fc-closing__ask"><header class="pf-section__header"><h2 class="pf-section__title">Contact</h2></header><p class="pf-message">Hire me\nTwo engagements a quarter. Write any time.</p><ul class="pf-actions" role="list"><li><a class="pf-action" href="mailto:rowan@rowan.test">Email me</a></li><li><a class="pf-action pf-action--quiet" href="https://rowan.test/cv.pdf">Download CV</a></li></ul><p class="fc-closing__address">rowan@rowan.test</p></section><ul class="pf-links" role="list"><li><a href="https://rowan.test">Site</a></li></ul></section></footer>',
  );
  // One heading, and every title the owner wrote shows: none is a second heading or a label.
  assert.equal(count(closing, /<h[1-6]\b/g), 1);
  assert.doesNotMatch(closing, /fc-closing__label/);
  // Without a contact title, the call to action's is the heading, and nothing opens the message.
  const untitled = render({
    ...PORTFOLIO,
    identity: { ...PORTFOLIO.identity, email: 'rowan@rowan.test' },
    sections: PORTFOLIO.sections.map((section) =>
      section.kind === 'contact' ? { kind: 'contact', id: 'contact' } : section,
    ),
  });
  assert.match(
    untitled,
    /<h2 class="pf-section__title">Hire me<\/h2><\/header><p class="pf-message">Write any time.<\/p>/,
  );
  // A mail button that presets a subject still mails the address: the address shows as text, and isn't a second link.
  const subject = render({
    ...PORTFOLIO,
    identity: { ...PORTFOLIO.identity, email: 'rowan@rowan.test' },
    sections: PORTFOLIO.sections.map((section) =>
      section.kind === 'cta'
        ? {
            ...section,
            primaryAction: { url: 'mailto:rowan@rowan.test?subject=Hi', label: 'Email me' },
          }
        : section,
    ),
  });
  const subjectClosing = subject.slice(subject.indexOf('<section id="contact"'));
  assert.equal(count(subjectClosing, /href="mailto:/g), 1);
  assert.match(subjectClosing, /<p class="fc-closing__address">rowan@rowan.test<\/p>/);
  // The message shows one line break, after the opening title: the owner's
  // own wrapped lines, as a YAML block scalar gives them, read as one.
  const wrapped = render({
    ...PORTFOLIO,
    contact: { message: 'Write\nany time.\n' },
    sections: PORTFOLIO.sections.map((section) =>
      section.kind === 'cta'
        ? { ...section, description: 'Two engagements\na quarter.\n' }
        : section,
    ),
  });
  assert.match(
    wrapped,
    /<p class="pf-message">Hire me\nTwo engagements a quarter. Write any time.<\/p>/,
  );
  // The call to action renders once: in the closing block, not again in the reading order.
  assert.equal(count(html, /data-section-id="hire"/g), 1);
  // With no call to action that mails, the address is the first way in, a link.
  const unmailed = render({
    ...PORTFOLIO,
    identity: { ...PORTFOLIO.identity, email: 'rowan@rowan.test' },
  });
  assert.match(
    unmailed,
    /<h2 class="pf-section__title">Contact<\/h2><\/header><p class="pf-message">Hire me\nWrite any time.<\/p><ul class="pf-actions" role="list"><li><a class="pf-action" href="#contact">Write<\/a><\/li><\/ul><\/section><ul class="pf-links" role="list"><li><a href="mailto:rowan@rowan.test" data-platform="email">rowan@rowan.test<\/a><\/li><li><a href="https:\/\/rowan.test">Site<\/a><\/li><\/ul><\/section><\/footer>$/,
  );
  assert.doesNotMatch(unmailed, /fc-closing__address/);
  // A call to action in another language keeps its own heading and message, a level down, after the contact's.
  const apartLang = render({
    ...PORTFOLIO,
    sections: PORTFOLIO.sections.map((section) =>
      section.kind === 'cta' ? { ...section, lang: 'fr' } : section,
    ),
  });
  assert.match(
    apartLang,
    /<section id="contact"[^>]*class="fc-closing"><header class="pf-section__header"><h2 class="pf-section__title">Contact<\/h2><\/header><p class="pf-message">Write any time.<\/p><ul class="pf-links"[\s\S]*?<\/ul><section id="hire" [^>]*lang="fr"[^>]*><header class="pf-section__header"><h3 class="pf-section__title">Hire me<\/h3>/,
  );
  // A call to action away from the contact section stays where the owner put it.
  const apart = render({
    ...PORTFOLIO,
    sections: [PORTFOLIO.sections[2], ...PORTFOLIO.sections.filter(({ kind }) => kind !== 'cta')],
  });
  assert.match(
    apart,
    /<section id="hire" data-section-id="hire" data-kind="cta" data-renderer="shared"/,
  );
  assert.ok(apart.indexOf('id="hire"') < apart.indexOf('</main>'));
  assert.match(
    apart,
    /<section id="contact"[^>]* class="fc-closing">(?:(?!id="hire")[\s\S])*<\/section><\/footer>$/,
  );
});

/** The chrome's navigation: the name, then the destinations, and the Menu. */
const chromeOf = (html: string) =>
  /<nav class="fc-nav" data-ui-slot="navigation" data-orientation="horizontal" aria-labelledby="(?:pv-)?fc--site">([\s\S]*?)<\/nav>/.exec(
    html,
  )?.[1] ?? '';
/** The index at the page's end. */
const indexOf = (html: string) =>
  /<nav id="(?:pv-)?fc--index" class="fc-index" aria-labelledby="(?:pv-)?fc--index-title">([\s\S]*?)<\/nav>/.exec(
    html,
  )?.[1] ?? '';
const destinations = (html: string) =>
  [
    ...chromeOf(html).matchAll(
      /<a data-ui-slot="navigation.link" href="([^"]+)"[^>]*>([^<]+)<\/a>/g,
    ),
  ].map(([, href, text]) => [href, text]);
const indexLinks = (html: string) =>
  [...indexOf(html).matchAll(/<a [^>]*?href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    ([, href, text]) => [href, text],
  );
/** The index's heads, each a link where its destination goes. */
const indexHeads = (html: string) =>
  [...indexOf(html).matchAll(/<a class="fc-index__head" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
    ([, href, text]) => [href, text],
  );

test('the chrome is the name and the destinations, each linking its section of that title or else its first, and the index lists every titled section', () => {
  const html = render(PORTFOLIO);
  assert.match(
    chromeOf(html),
    /^<span id="fc--site" hidden="">Site<\/span><a class="fc-home" href="\/">Rowan Fallback<\/a>/,
  );
  // About is the titled lede; Contact lands on the section titled Contact,
  // after the call to action, the first of its sections.
  assert.deepEqual(destinations(html), [
    ['#about', 'About'],
    ['#contact', 'Contact'],
  ]);
  // The index comes before the closing block, a named navigation of real
  // links. About, with one section, is its head alone, and the closing
  // block's sections aren't listed again, so Contact has no group.
  assert.match(indexOf(html), /^<h2 id="fc--index-title" class="fc-index__title">Index<\/h2>/);
  assert.deepEqual(indexLinks(html), [['#about', 'About']]);
  assert.ok(html.indexOf('id="fc--index"') < html.indexOf('<section id="contact"'));
  // The Menu is the kit's slot. With no host Menu registered, as here, it's a
  // plain link to the index; the host's gets the Menu's content to show.
  assert.match(
    chromeOf(html),
    /<div class="fc-menu"><a href="#fc--index" data-navigation-menu-link="">Menu<\/a><\/div>$/,
  );
  const given: NavigationMenuProps[] = [];
  registerHostModules({
    navigationMenu: (props) => {
      given.push(props);
      return <div data-test-menu={props.id}>{props.children}</div>;
    },
  });
  try {
    const hosted = render(PORTFOLIO);
    assert.deepEqual(
      given.map(({ id, label, lang, href, visitorControl }) => ({
        id,
        label,
        lang,
        href,
        visitorControl,
      })),
      [
        {
          id: 'fc-menu',
          label: 'Menu',
          lang: undefined,
          href: '#fc--index',
          visitorControl: { media: '(width < 48rem)' },
        },
      ],
    );
    // It leads with the destinations, as large links. Here the index holds
    // nothing they don't reach, so there's no "All sections" to repeat them.
    const menuOf = (html: string) =>
      /<div data-test-menu="fc-menu">([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] ?? '';
    assert.equal(
      menuOf(hosted),
      '<ul class="fc-menu__destinations"><li><a href="#about" data-type-role="title">About</a></li><li><a href="#contact" data-type-role="title">Contact</a></li></ul>',
    );
    // With sections the destinations don't reach, they're behind one disclosure: a lone
    // one under its own title, never as "More".
    const custom = (count: number) =>
      render({
        ...PORTFOLIO,
        sections: [
          ...PORTFOLIO.sections,
          ...['Workshop', 'Garden'].slice(0, count).map((title) => ({
            kind: 'custom',
            id: title.toLowerCase(),
            title,
            body: 'Hi.',
          })),
        ],
      });
    assert.match(
      menuOf(custom(1)),
      /<\/ul><details class="fc-menu__all" data-ui-slot="disclosure" data-marker="chevron"><summary data-ui-slot="disclosure.summary">All sections<\/summary><div data-ui-slot="disclosure.content"><ul class="fc-index__groups fc-index__groups--flat"><li><a class="fc-index__head" href="#workshop">Workshop<\/a><\/li><\/ul><\/div><\/details>$/,
    );
    assert.deepEqual(indexHeads(custom(1)).at(-1), ['#workshop', 'Workshop']);
    // Two make a More on the page, which the Menu, holding nothing else, lists by title.
    assert.match(indexOf(custom(2)), />More<\/a>/);
    assert.match(
      menuOf(custom(2)),
      /<ul class="fc-index__groups fc-index__groups--flat"><li><a class="fc-index__head" href="#workshop">Workshop<\/a><\/li><li><a class="fc-index__head" href="#garden">Garden<\/a><\/li><\/ul>/,
    );
    // A content id named fc-menu moves the Menu's own id along.
    given.length = 0;
    render({
      ...PORTFOLIO,
      sections: [...PORTFOLIO.sections, { kind: 'lede', id: 'fc-menu', body: 'Hi.' }],
    });
    assert.equal(given[0]?.id, 'fc-menu-2');
  } finally {
    registerHostModules({});
  }
  // The render's id prefix reaches the main, the sections, the chrome, and every link.
  const prefixed = render(PORTFOLIO, 'pv-');
  assert.match(prefixed, /<main id="pv-main"/);
  assert.deepEqual(destinations(prefixed), [
    ['#pv-about', 'About'],
    ['#pv-contact', 'Contact'],
  ]);
  assert.match(prefixed, /<section id="pv-contact"/);
  // The host's Menu adds the prefix to its own local id, from the presentation boundary.
  assert.match(prefixed, /<a href="#pv-fc--index" data-navigation-menu-link="">Menu<\/a>/);
  assert.match(prefixed, /<nav id="pv-fc--index"/);
});

test("the sample's 28 sections take the five destinations in their fixed order, and its index every titled section but the closing block, each landing on the page", () => {
  const html = markup(
    (() => {
      const result = readPair({
        portfolio: fileURLToPath(new URL('../../../portfolio.example.yml', import.meta.url)),
        site: fileURLToPath(new URL('../../../site.example.yml', import.meta.url)),
      });
      assert.ok(result.ok);
      return result.pair;
    })(),
  );
  // About lands on the section titled About, not Practice, the first of its sections.
  assert.deepEqual(destinations(html), [
    ['#work-showcase', 'Work'],
    ['#essays', 'Writing'],
    ['#at-a-glance', 'Record'],
    ['#about', 'About'],
    ['#contact', 'Contact'],
  ]);
  // Four heads, Writing's alone with its one section, then the other titled
  // sections, none the head's own: the hero, the untitled quote, and the
  // closing block aren't listed.
  assert.deepEqual(indexHeads(html), [
    ['#work-showcase', 'Work'],
    ['#essays', 'Writing'],
    ['#at-a-glance', 'Record'],
    ['#about', 'About'],
  ]);
  const links = indexLinks(html);
  assert.equal(links.length, 4 + 3 + 10 + 7);
  assert.equal(new Set(links.map(([href]) => href)).size, links.length);
  assert.ok(!links.some(([href]) => href === '#contact' || href === '#want-to-work-together'));
  for (const [href] of [...links, ...destinations(html)]) {
    assert.match(html, new RegExp(`<section id="${href!.slice(1)}"`), href);
  }
  // The page ends on one closing block, after the index: the contact
  // section with the call to action inside it, the only frame of either.
  assert.ok(html.indexOf('id="fc--index"') < html.indexOf('<section id="contact"'));
  assert.ok(html.lastIndexOf('<section id="contact"') === html.indexOf('<section id="contact"'));
  const closing = html.slice(html.indexOf('<section id="contact"'));
  assert.match(
    closing,
    /^<section id="contact" data-section-id="contact" data-kind="contact"[^>]*><section id="want-to-work-together" data-section-id="want-to-work-together"[^>]*><header class="pf-section__header"><h2 class="pf-section__title">Get in touch<\/h2><\/header><p class="pf-message">Want to work together\?\nI take on [^<]*single email\. Best route is email[^<]*<\/p><ul class="pf-actions" role="list"><li><a class="pf-action" href="mailto:anamika@example.com">Email me<\/a><\/li><li><a class="pf-action pf-action--quiet" href="https:\/\/anamika.example.com\/cv.pdf">Download CV<\/a><\/li><\/ul><p class="fc-closing__address">anamika@example.com<\/p><\/section><ul class="pf-links" role="list">(?:<li><a [^>]*>(?:GitHub|LinkedIn|Mastodon|anamika.example.com)<\/a><\/li>){4}<\/ul><\/section><\/footer>$/,
  );
  // Each place once: the CV under the action's label, the address as text.
  assert.equal(count(closing, /cv\.pdf/g), 1);
  assert.equal(count(closing, /mailto:/g), 1);
  assert.equal(count(html, /data-section-id="want-to-work-together"/g), 1);
});

test('a section with nothing public leaves the page and the navigation (#10)', () => {
  const html = render({
    ...PORTFOLIO,
    works: [
      { id: 'tide', title: 'Tide', medium: 'writing' },
      { id: 'draft', title: 'Draft', medium: 'writing', visibility: 'private' },
    ],
    archive: ['tide'],
    sections: [
      ...PORTFOLIO.sections,
      { kind: 'works', id: 'selected-work', title: 'Selected work', items: ['tide'] },
      { kind: 'works', id: 'drafts', title: 'Drafts', items: ['draft'] },
    ],
  });
  assert.deepEqual(destinations(html), [
    ['#selected-work', 'Writing'],
    ['#about', 'About'],
    ['#contact', 'Contact'],
  ]);
  assert.ok(indexLinks(html).some(([href]) => href === '#selected-work'));
  assert.doesNotMatch(html, /drafts|Drafts|Draft/);
  // Works in the archive say so, in the order the section lists them.
  assert.match(html, /<span class="pf-label" data-label="archive">Archive<\/span>/);
});

test('titled sections no destination takes are under More, which links the first, listed once', () => {
  const html = render({
    ...PORTFOLIO,
    sections: [
      ...PORTFOLIO.sections,
      { kind: 'custom', id: 'workshop', title: 'Workshop', body: 'Monthly.' },
      { kind: 'custom', id: 'garden', title: 'Garden', body: 'Weekly.' },
    ],
  });
  assert.deepEqual(indexHeads(html), [
    ['#about', 'About'],
    ['#workshop', 'More'],
  ]);
  // More links Workshop, so only Garden is listed under it, and every link in the index is its own place.
  const links = indexLinks(html);
  assert.deepEqual(links, [
    ['#about', 'About'],
    ['#workshop', 'More'],
    ['#garden', 'Garden'],
  ]);
  assert.equal(new Set(links.map(([href]) => href)).size, links.length);
});

test("the navigation's English words are marked so in a portfolio in another language", () => {
  // The labels are the host's words, so their language is English, whatever the content's.
  const english = render(PORTFOLIO);
  assert.match(english, /<span id="fc--site" hidden="">Site<\/span>/);
  assert.match(english, /<a data-ui-slot="navigation.link" href="#about">About<\/a>/);
  const french = render({ ...PORTFOLIO, locale: 'fr' });
  assert.match(french, /<span id="fc--site" lang="en" hidden="">Site<\/span>/);
  assert.match(french, /<a data-ui-slot="navigation.link" href="#about" lang="en">About<\/a>/);
  assert.match(french, /<a href="#fc--index" lang="en" data-navigation-menu-link="">Menu<\/a>/);
  assert.match(french, /<h2 id="fc--index-title" class="fc-index__title" lang="en">Index<\/h2>/);
  assert.match(french, /<a class="fc-index__head" href="#about" lang="en">About<\/a>/);
  // The owner's own titles keep the content's language.
  assert.match(french, /<h2 class="pf-section__title">Contact<\/h2>/);
  assert.match(french, /<p class="pf-message">Hire me\n/);
  assert.match(render(PORTFOLIO, 'pv-'), /aria-labelledby="pv-fc--site"/);
});

test('the one h1 comes before any h2, whatever order the content puts the hero in', () => {
  const [hero, about, ...rest] = PORTFOLIO.sections;
  const html = render({ ...PORTFOLIO, sections: [about, hero, ...rest] });
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<main id="main" class="fc-main pf-stack pf-stats--leaders" tabindex="-1"><h1 class="fc-name">Rowan Fallback<\/h1>/,
  );
  // The hero, no longer first, takes h2 like every other section.
  assert.match(html, /<h2 class="pf-hero__name">Rowan Fallback<\/h2>/);
  assert.ok(html.indexOf('<h1') < html.indexOf('<h2'));
});

test("without a hero, the identity's name is the page's one h1", () => {
  const html = render({ ...PORTFOLIO, sections: PORTFOLIO.sections.slice(1) });
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<main id="main" class="fc-main pf-stack pf-stats--leaders" tabindex="-1"><h1 class="fc-name">Rowan Fallback<\/h1>/,
  );
  // A second hero takes h2, so there's still one h1.
  const twice = render({
    ...PORTFOLIO,
    sections: [...PORTFOLIO.sections, { kind: 'hero', id: 'again', name: 'Again' }],
  });
  assert.equal(count(twice, /<h1\b/g), 1);
  assert.match(twice, /<h2 class="pf-hero__name">Again<\/h2>/);
});

test('every profession pair renders, both directions included, with the same structure', () => {
  const pairs = new URL('../../schema/src/__fixtures__/pairs/', import.meta.url);
  const practices = readdirSync(pairs).sort();
  assert.ok(practices.length >= 8);
  for (const practice of practices) {
    const dir = new URL(`${practice}/yaml/`, pairs);
    const result = readPair({
      portfolio: fileURLToPath(new URL('portfolio.yml', dir)),
      site: fileURLToPath(new URL('site.yml', dir)),
    });
    assert.ok(result.ok, practice);
    const html = markup(result.pair);
    assert.equal(count(html, /<main\b/g), 1, practice);
    assert.equal(count(html, /<h1\b/g), 1, practice);
    assert.equal(count(html, /data-visitor-control-slot/g), 1, practice);
    assert.doesNotMatch(html, /data-renderer="bespoke"/, practice);
  }
});

test("on a work's route, the work's case study is the page, at its one h1, with a link home (#10b)", () => {
  const dir = new URL('../../schema/src/__fixtures__/pairs/engineering/yaml/', import.meta.url);
  const result = readPair({
    portfolio: fileURLToPath(new URL('portfolio.yml', dir)),
    site: fileURLToPath(new URL('site.yml', dir)),
  });
  assert.ok(result.ok);
  const view = resolvePortfolioView(result.pair, {}, { mediaBase: '/media' });
  const [slug] = routedSlugs(view);
  assert.ok(slug, 'the engineering pair has a routed case study');
  const work = view.portfolio.works.find((each) => each.slug === slug)!;
  const html = markup(result.pair, '', { route: 'work', slug }, '/sample');
  assert.equal(count(html, /<main\b/g), 1);
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<p class="pf-case-study__label">Case study<\/p><h1 class="pf-case-study__title">/,
  );
  assert.ok(html.includes(`<article class="pf-case-study" data-work-id="${work.id}"`));
  assert.equal(count(html, /data-visitor-control-slot/g), 1);
  // No section renders on a work's page, and the way home keeps the link base.
  assert.equal(count(html, /data-renderer=/g), 0);
  // The way home is the chrome's name, and each destination is home's section.
  assert.match(
    chromeOf(html),
    /^<span id="fc--site" hidden="">Site<\/span><a class="fc-home" href="\/sample">/,
  );
  assert.ok(destinations(html).length > 0);
  for (const [href] of destinations(html)) assert.match(href!, /^\/sample#/);
  // Work is the current destination on a work's page.
  assert.match(
    chromeOf(html),
    /<a data-ui-slot="navigation.link" href="\/sample#[^"]+" aria-current="page">Work<\/a>/,
  );
  assert.equal(count(chromeOf(html), /aria-current/g), 1);
  // It ends on a short index: the destinations, then every other work with its own page.
  assert.deepEqual(
    indexHeads(html).map(([, text]) => text),
    [
      ...destinations(html).map(([, text]) => text),
      ...(indexLinks(html).length > destinations(html).length ? ['All work'] : []),
    ],
  );
  for (const [href] of indexLinks(html)) assert.match(href!, /^\/sample(?:#|\/work\/)/);
  assert.doesNotMatch(html, /fc-closing/);
  // A slug the view doesn't route is no work's page: the host never sends one here.
  const home = markup(result.pair, '', { route: 'work', slug: 'no-such-work' });
  assert.equal(count(home, /pf-case-study"/g), 0);
  assert.ok(count(home, /data-renderer="shared"/g) > 0);
});

/**
 * Each style rule in `css`, comments left out: its selector, its body, and
 * the at-rules it sits in, outermost first.
 */
function styleRules(css: string): { selector: string; body: string; within: string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: { selector: string; body: string; within: string[] }[] = [];
  const open: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '{') {
      open.push(text.slice(start, at).trim());
      start = at + 1;
    } else if (text[at] === '}') {
      const head = open.pop() ?? '';
      if (!head.startsWith('@')) {
        found.push({ selector: head, body: text.slice(start, at), within: [...open] });
      }
      start = at + 1;
    }
  }
  return found;
}

test('its stylesheet stays under [data-variant="fallback"] with logical properties, and its appearance is the shared tokens alone', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const found = styleRules(css);
  assert.ok(found.length > 0);
  for (const { selector: selectors, body, within } of found) {
    // Rules sit at the top level or in a media query, never in another at-rule.
    for (const at of within) assert.match(at, /^@media\b/, at);
    for (const selector of selectors.split(/,(?![^(]*\))/)) {
      assert.match(selector.trim(), /^\[data-variant='fallback'\]/, selector);
    }
    // No background, family, opacity, or motion of its own: a disclosure's
    // chevron is the primitive's (data-marker), not drawn here.
    assert.doesNotMatch(
      body,
      /\b(?:background|font-family|font|opacity|animation|transition)\s*:/,
      body,
    );
    assert.doesNotMatch(selectors, /::after/, selectors);
    // A text color, a size, or a weight it designs is a shared token: a
    // color role, a type step, or a role's weight, never a literal.
    for (const [, property, value] of body.matchAll(
      /\b(color|font-size|font-weight)\s*:\s*([^;]+)/g,
    )) {
      assert.match(
        value!.trim(),
        property === 'color'
          ? /^var\(--color-text-[a-z]+\)$/
          : property === 'font-size'
            ? /^var\(--type-step-[0-9-]+\)$/
            : /^var\(--type-[a-z]+-font-weight\)$/,
        `${property}: ${value}`,
      );
    }
    assert.doesNotMatch(body, /-(?:left|right)\b|text-align/, body);
  }
});
