import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import type { AppearanceSelection } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  boundaryAttributes,
  boundaryId,
  DEFAULT_VISITOR_CONTROLS,
  lowerMotion,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  stylesheetHrefs,
  type AppearanceStylesheets,
  type ResolveInput,
} from '../index';
import { Field, Main, Navigation, Select, Tabs } from '../primitives';
import { elements, html, ids, one, slotted } from '../test-support/markup';
import { testRegistry } from '../test-support/packs';
import { AppearanceDiagnostics, PresentationBoundary, useBoundary } from '.';

// PresentationBoundary (#19, Slice 3, item 1), rendered with
// react-dom/server: its attributes, its stylesheet resources, the document
// and plate rules, the ids, and the refusals.

const registry = testRegistry();
const PUBLISHED: AppearanceSelection = { ...PLATFORM_DEFAULTS, variant: 'acme-gallery' };
const DOCUMENT_IDS = { prefix: '', main: 'main' } as const;
const PLATE_IDS = { prefix: 'pl-1-', main: 'pl-1-main' } as const;

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

/** Stylesheets by pack id, as a build would list them. */
const STYLESHEETS: AppearanceStylesheets = {
  platform: '/_portfolio/pack/_platform.000000000000.css',
  pack: (axis, id) =>
    axis === 'typography' && id === 'humanist-ui' ? null : `/_portfolio/pack/${id}.css`,
};

test('a boundary names what renders, the mode that renders, and its environment', () => {
  assert.deepEqual(boundaryAttributes(resolve(), 'document'), {
    'data-appearance-boundary': 'document',
    'data-variant': 'acme-gallery',
    'data-design-language': 'platform-neutral',
    'data-color-scheme': 'warm-parchment',
    'data-typography': 'humanist-ui',
    'data-display-mode': 'system',
    'data-mode-locked': 'false',
    'data-contrast': 'system',
    'data-motion': 'full',
    'data-enhancement': 'on',
  });
  const reduced = resolve({
    motionPolicy: 'reduce',
    environment: { contrast: 'more', enhancement: 'off' },
  });
  const attributes = boundaryAttributes(reduced, 'document');
  assert.equal(attributes['data-motion'], 'reduced');
  assert.equal(attributes['data-contrast'], 'more');
  assert.equal(attributes['data-enhancement'], 'off');
});

test('a plate is always still, with its enhancements off', () => {
  const attributes = boundaryAttributes(resolve(), 'plate');
  assert.equal(attributes['data-appearance-boundary'], 'plate');
  assert.equal(attributes['data-motion'], 'static');
  assert.equal(attributes['data-enhancement'], 'off');
});

test('a fallback says which axes fell back and what was asked for, and never claims the request renders', () => {
  const resolved = resolve({
    published: { ...PUBLISHED, designLanguage: 'missing-language', colorScheme: 'missing-scheme' },
  });
  const attributes = boundaryAttributes(resolved, 'document');
  assert.equal(attributes['data-design-language'], 'platform-neutral');
  assert.equal(attributes['data-color-scheme'], 'warm-parchment');
  assert.equal(attributes['data-appearance-fallback'], 'design-language color-scheme');
  assert.equal(attributes['data-requested-design-language'], 'missing-language');
  assert.equal(attributes['data-requested-color-scheme'], 'missing-scheme');
  assert.equal(attributes['data-requested-typography'], undefined);
  assert.equal(attributes['data-appearance-diagnostics'], 'appearance.unavailable');
});

test('a single-mode scheme locks system to its native mode, with no diagnostic', () => {
  const resolved = resolve({ published: { ...PUBLISHED, colorScheme: 'fixture-dark-only' } });
  const attributes = boundaryAttributes(resolved, 'document');
  assert.equal(attributes['data-display-mode'], 'dark');
  assert.equal(attributes['data-mode-locked'], 'true');
  assert.equal(attributes['data-appearance-diagnostics'], undefined);
});

test('an explicit mode the scheme lacks renders the native mode and shows appearance.mode-incompatible', () => {
  const resolved = resolve({
    published: { ...PUBLISHED, colorScheme: 'fixture-dark-only', displayMode: 'light' },
  });
  const attributes = boundaryAttributes(resolved, 'plate');
  assert.equal(attributes['data-display-mode'], 'dark', 'never the mode the scheme lacks');
  assert.equal(attributes['data-mode-locked'], 'true');
  assert.equal(attributes['data-appearance-diagnostics'], 'appearance.mode-incompatible');

  const markup = html(<AppearanceDiagnostics diagnostics={resolved.diagnostics} />);
  const item = elements(markup).find((element) => element.tag === 'li')!;
  assert.equal(item.attributes['data-code'], 'appearance.mode-incompatible');
  assert.match(markup, /fixture-dark-only has only a dark mode/);
  assert.match(markup, /Set the display mode to system, dark, or high-contrast/);
  assert.equal(html(<AppearanceDiagnostics diagnostics={[]} />), '');
});

test("a boundary links the platform's and its packs' stylesheets as resources, each once", () => {
  assert.deepEqual(stylesheetHrefs(PUBLISHED, STYLESHEETS), [
    '/_portfolio/pack/_platform.000000000000.css',
    '/_portfolio/pack/platform-neutral.css',
    '/_portfolio/pack/warm-parchment.css',
  ]);
  const markup = html(
    <>
      <PresentationBoundary
        kind="document"
        appearance={resolve()}
        ids={DOCUMENT_IDS}
        stylesheets={STYLESHEETS}
      >
        <p>Page</p>
      </PresentationBoundary>
      <PresentationBoundary
        kind="plate"
        appearance={resolve()}
        ids={PLATE_IDS}
        stylesheets={STYLESHEETS}
      >
        <p>Plate</p>
      </PresentationBoundary>
    </>,
  );
  const links = elements(markup).filter((element) => element.tag === 'link');
  assert.deepEqual(
    links.map((link) => [
      link.attributes.rel,
      link.attributes.href,
      link.attributes['data-precedence'],
    ]),
    [
      ['stylesheet', '/_portfolio/pack/_platform.000000000000.css', 'appearance'],
      ['stylesheet', '/_portfolio/pack/platform-neutral.css', 'appearance'],
      ['stylesheet', '/_portfolio/pack/warm-parchment.css', 'appearance'],
    ],
    'two boundaries with one selection link each file once',
  );
  assert.equal(
    elements(
      html(<PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS} />),
    ).filter((element) => element.tag === 'link').length,
    0,
  );
});

test('a document boundary renders its attributes and, first, the skip link to the main', () => {
  const markup = html(
    <PresentationBoundary
      kind="document"
      appearance={resolve()}
      ids={DOCUMENT_IDS}
      skipLink={{ label: 'Skip to content', lang: 'en' }}
    >
      <Main id={DOCUMENT_IDS.main}>Content</Main>
    </PresentationBoundary>,
  );
  const [root, first] = elements(markup);
  assert.equal(root!.tag, 'div');
  assert.equal(root!.attributes['data-appearance-boundary'], 'document');
  assert.equal(root!.attributes.inert, undefined);
  assert.equal(first!.attributes['data-ui-slot'], 'skip-link');
  assert.equal(first!.attributes.href, '#main');
  assert.equal(first!.attributes.lang, 'en');
  assert.equal(elements(markup).filter((element) => element.tag === 'main').length, 1);
});

test('a plate is inert, still, and has no skip link, and its landmarks are plain divs with no role', () => {
  const markup = html(
    <PresentationBoundary kind="plate" appearance={resolve()} ids={PLATE_IDS}>
      <Navigation label="Primary" items={[{ href: '#a', label: 'A' }]} />
      <Main id={PLATE_IDS.main}>Content</Main>
    </PresentationBoundary>,
  );
  const [root] = elements(markup);
  assert.equal(root!.attributes['data-appearance-boundary'], 'plate');
  assert.equal(root!.attributes.inert, '');
  assert.equal(root!.attributes['data-motion'], 'static');
  assert.equal(slotted(markup, 'skip-link').length, 0);
  const tags = elements(markup).map((element) => element.tag);
  assert.ok(!tags.includes('main') && !tags.includes('nav'), tags.join(' '));
  const navigation = one(markup, 'navigation');
  assert.equal(navigation.tag, 'div');
  assert.equal(navigation.attributes['aria-label'], undefined);
  assert.equal(navigation.attributes.role, undefined);
  assert.ok(elements(markup).some((element) => element.attributes.id === 'pl-1-main'));
});

test("plates in the page's own boundary keep one main and unique ids, every id in a plate carrying its prefix", () => {
  const plate = (prefix: string) => {
    const plateIds = { prefix, main: `${prefix}main` };
    return (
      <PresentationBoundary kind="plate" appearance={resolve()} ids={plateIds}>
        <Main id={plateIds.main}>
          <Field id={boundaryId(plateIds, 'note')} label="Note" description="Help" />
          <Select id="scheme" label="Scheme" groups={[{ choices: [{ value: 'a', label: 'A' }] }]} />
          <Tabs id="views" label="Views" items={[{ id: 'one', label: 'One', content: 'One' }]} />
        </Main>
      </PresentationBoundary>
    );
  };
  const markup = html(
    <PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS}>
      <Main id={DOCUMENT_IDS.main}>
        <Field id={boundaryId(DOCUMENT_IDS, 'note')} label="Note" description="Help" />
        <Select id="scheme" label="Scheme" groups={[{ choices: [{ value: 'a', label: 'A' }] }]} />
        <Tabs id="views" label="Views" items={[{ id: 'one', label: 'One', content: 'One' }]} />
        {plate('pl-1-')}
        {plate('pl-2-')}
      </Main>
    </PresentationBoundary>,
  );
  const all = ids(markup);
  assert.equal(new Set(all).size, all.length, `duplicate ids: ${all.join(' ')}`);
  assert.equal(elements(markup).filter((element) => element.tag === 'main').length, 1);
  for (const prefix of ['pl-1-', 'pl-2-']) {
    const start = markup.indexOf(`id="${prefix}main"`);
    const plateIds = ids(
      markup.slice(start, markup.indexOf('</div>', markup.lastIndexOf(`${prefix}views`))),
    );
    assert.ok(plateIds.length >= 5, plateIds.join(' '));
    assert.ok(
      plateIds.every((id) => id.startsWith(prefix)),
      plateIds.join(' '),
    );
  }
});

test('a plate in a plate throws, and so does a document boundary anywhere but outermost', () => {
  const plate = (prefix: string, children?: ReactNode) => (
    <PresentationBoundary
      kind="plate"
      appearance={resolve()}
      ids={{ prefix, main: `${prefix}main` }}
    >
      {children}
    </PresentationBoundary>
  );
  assert.throws(() => html(plate('pl-1-', plate('pl-2-'))), /plate renders inside another plate/);
  assert.throws(
    () =>
      html(
        plate(
          'pl-1-',
          <PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS} />,
        ),
      ),
    /document boundary renders outermost/,
  );
  assert.throws(
    () =>
      html(
        <PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS}>
          <PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS} />
        </PresentationBoundary>,
      ),
    /document boundary renders outermost/,
  );
  assert.doesNotThrow(() =>
    html(
      <PresentationBoundary kind="document" appearance={resolve()} ids={DOCUMENT_IDS}>
        {plate('pl-1-')}
        {plate('pl-2-')}
      </PresentationBoundary>,
    ),
  );
});

test("a document boundary's ids are unprefixed and a plate's are prefixed, else it throws", () => {
  assert.throws(
    () => html(<PresentationBoundary kind="document" appearance={resolve()} ids={PLATE_IDS} />),
    /unprefixed ids/,
  );
  assert.throws(
    () => html(<PresentationBoundary kind="plate" appearance={resolve()} ids={DOCUMENT_IDS} />),
    /own prefix/,
  );
});

test("boundaryId() takes the render input's ids, and a local id is lowercase words", () => {
  // The ids a variant renders with are the ones the boundary takes.
  const input: Pick<VariantRenderInput, 'ids'> = { ids: { prefix: 'pl-3-', main: 'pl-3-main' } };
  assert.equal(boundaryId(input.ids, 'contact'), 'pl-3-contact');
  assert.throws(() => boundaryId(input.ids, 'Contact Form'), /lowercase words/);
  assert.throws(() => boundaryId(input.ids, 'contact--form'), /single hyphens/);
});

test('useBoundary() outside every boundary reads as an unprefixed document, kind none', () => {
  let seen: ReturnType<typeof useBoundary> | undefined;
  function Probe() {
    seen = useBoundary();
    return null;
  }
  html(<Probe />);
  assert.deepEqual(
    { ...seen, setMotion: undefined },
    {
      kind: 'none',
      plate: false,
      prefix: '',
      main: 'main',
      motion: 'full',
      setMotion: undefined,
    },
  );
  html(
    <PresentationBoundary kind="plate" appearance={resolve()} ids={PLATE_IDS}>
      <Probe />
    </PresentationBoundary>,
  );
  assert.equal(seen!.kind, 'plate');
  assert.equal(seen!.plate, true);
  assert.equal(seen!.prefix, 'pl-1-');
  assert.equal(seen!.motion, 'static');
});

test("setMotion() only lowers a boundary's motion", () => {
  assert.equal(lowerMotion('full', 'static'), 'static');
  assert.equal(lowerMotion('full', 'reduced'), 'reduced');
  assert.equal(lowerMotion('reduced', 'full'), 'reduced');
  assert.equal(lowerMotion('reduced', 'static'), 'static');
  assert.equal(lowerMotion('static', 'full'), 'static');
  assert.equal(lowerMotion('full', null), 'full');
});
