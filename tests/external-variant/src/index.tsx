import type { ReactElement } from 'react';
import { Enhancement } from '@portfolio/kit/enhancements';
import {
  evidenceOf,
  renderSection,
  RichText,
  VisitorControlSlot,
  type BespokeRenderers,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import {
  routeHref,
  type VariantRenderInput,
  type ViewDeclaration,
} from '@portfolio/variant-contract';

// The reference third-party variant (#5, Slice 6), in the format a variant
// ships in: compiled ESM, its .d.ts, styles.css, and manifest.json, with the
// platform's packages as peers. pnpm test:external-variant builds and packs
// it, installs the tarball in a temporary worktree, and removes it; nothing
// installs it in a release. It renders evidence bespoke, leaves fun facts
// out, has a colophon view, and a compact control, and lazy-loads one
// enhancement, a badge beside the navigation.

type Props = { readonly input: VariantRenderInput };

/**
 * Evidence as a ledger: each statement, through the kit's rich text, or its
 * title when it has none, then its figure, or else its source. A line needs
 * both, so evidence with no figure and no source isn't one.
 */
function EvidenceLedger({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>): ReactElement {
  const Heading = `h${level}` as const;
  return (
    <>
      {section.title ? <Heading>{section.title}</Heading> : null}
      {section.subtitle ? <p>{section.subtitle}</p> : null}
      <dl className="acme-ledger">
        {evidenceOf(section, input).map((entry) => {
          const term = entry.statement ? (
            <RichText source={entry.statement} inline input={input} />
          ) : (
            entry.title || null
          );
          const figure =
            entry.metric?.value !== undefined
              ? `${String(entry.metric.value)}${entry.metric.unit ? ` ${entry.metric.unit}` : ''}`
              : entry.source?.name;
          if (term === null || !figure) return null;
          return (
            <div key={entry.id} data-evidence-type={entry.type} data-metric={entry.metric?.key}>
              <dt>{term}</dt>
              <dd>{figure}</dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

/** The kinds in the manifest's renderedKinds, each with its renderer. */
const RENDERERS: BespokeRenderers = { evidence: EvidenceLedger };

/** The host's words are English, marked so in a portfolio in another language. */
const uiLang = ({ portfolio }: VariantRenderInput) =>
  /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en';

function Home({ input }: Props): ReactElement {
  return (
    <>
      <h1 className="acme-name">{input.portfolio.identity.name}</h1>
      {input.portfolio.sections.map((section) =>
        renderSection(section, input, RENDERERS, { level: 2 }),
      )}
    </>
  );
}

function Colophon({ input }: Props): ReactElement {
  const count = input.portfolio.sections.length;
  return (
    <>
      <h1 lang={uiLang(input)}>Colophon</h1>
      <p lang={uiLang(input)}>
        {`This portfolio has ${count} ${count === 1 ? 'section' : 'sections'}, set by the Acme reference variant.`}
      </p>
    </>
  );
}

export default function AcmeReference({ input }: Props): ReactElement {
  const { ids, route } = input;
  const colophon = input.capabilities.views.find(
    (view) => view.id === 'colophon',
  ) as ViewDeclaration;
  const onColophon = route.route === 'view' && route.view.id === 'colophon';
  return (
    <>
      <header className="acme-header">
        <nav className="acme-nav" aria-label="Pages" lang={uiLang(input)}>
          <ul role="list">
            <li>
              <a
                href={routeHref(input, { route: 'home' })}
                aria-current={onColophon ? undefined : 'page'}
              >
                Home
              </a>
            </li>
            <li>
              <a
                href={routeHref(input, { route: 'view', view: colophon, params: {} })}
                aria-current={onColophon ? 'page' : undefined}
              >
                Colophon
              </a>
            </li>
          </ul>
        </nav>
        <VisitorControlSlot />
        <Enhancement input={input} id="badge" />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main
        id={ids.main}
        className="acme-main"
        tabIndex={-1}
        data-density={input.controls.compact === true ? 'compact' : 'comfortable'}
      >
        {onColophon ? <Colophon input={input} /> : <Home input={input} />}
      </main>
    </>
  );
}
