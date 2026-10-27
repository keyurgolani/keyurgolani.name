import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { CaseStudy, renderContext, SHARED_RENDERERS } from '../sections';
import { COMPLETE, GITHUB, MEDIA } from '../sections/__fixtures__/complete';

// Every kit part as a composition that wraps it would place it (the redesign
// audit's rescope): each shared renderer's output inside a bespoke frame of
// the composition's own, `data-renderer="bespoke"` with a class of its own,
// for the browser check that each part keeps its layout there
// (tests/e2e/kit-parts.spec.ts). The fixture is the shared renderers' own,
// every image ready and the GitHub snapshot in, plus a section of four
// figures. Run with tsx, it prints the markup.

// tsx compiles the kit's JSX to React.createElement calls, so this supplies React.
Object.assign(globalThis, { React });

const { PortfolioSchema, SiteSchema } = composeSchemas();

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'probe',
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

/** The fallback composition's manifest: every kind the shared way. */
function fallbackManifest(): VariantManifest {
  const raw = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fallback-composition/manifest.json', import.meta.url)),
      'utf8',
    ),
  );
  const result = validateManifest(raw, { packageName: '@portfolio/fallback-composition' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.manifest as VariantManifest;
}

const FIGURES = ['first', 'second', 'third', 'fourth'].map((name, index) => ({
  id: `figure-${name}`,
  type: 'metric',
  statement: `Figure ${name}`,
  ...(index === 0 ? { description: 'Figure note' } : {}),
  metric: { key: `figure-${name}`, value: (index + 1) * 12 },
}));

/** The markup: every section of the fixture, a section of four figures, and a case study, each in its own frame. */
export function kitPartsMarkup(): string {
  const portfolio = PortfolioSchema.parse({
    ...COMPLETE,
    evidence: [...COMPLETE.evidence, ...FIGURES],
    sections: [
      ...COMPLETE.sections,
      {
        kind: 'evidence',
        id: 'figures',
        title: 'Figures',
        items: FIGURES.map(({ id }) => id),
      },
    ],
  });
  const input = buildRenderInput({
    view: resolvePortfolioView(
      { portfolio, site: SITE } as ParsedPair,
      { media: MEDIA, snapshots: { github: GITHUB } } as never,
      { mediaBase: '/media' },
    ),
    manifest: fallbackManifest(),
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T12:00:00Z',
  });
  const frames = input.portfolio.sections.map((section) => {
    const Renderer = SHARED_RENDERERS[section.kind as keyof typeof SHARED_RENDERERS] as never as (
      props: Record<string, unknown>,
    ) => React.ReactElement;
    return (
      <article
        key={section.id}
        className="own-frame"
        data-renderer="bespoke"
        data-section-id={section.id}
        data-kind={section.kind}
      >
        <Renderer section={section} input={input} level={2} />
      </article>
    );
  });
  const work = input.portfolio.works.find(({ id }) => id === 'tide-atlas');
  return renderToStaticMarkup(
    <>
      {frames}
      {work ? (
        <article className="own-frame" data-renderer="bespoke" data-kind="case-study">
          <CaseStudy
            work={work as never}
            ctx={renderContext(input, { id: 'case', lang: undefined, title: undefined }, 2)}
            level={2}
          />
        </article>
      ) : null}
    </>,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(kitPartsMarkup());
}
