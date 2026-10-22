import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  formatFigure,
  formatNames,
  hrefFor,
  ItemTitle,
  LabeledDate,
  LinkList,
  MaybeLink,
  Meta,
  present,
  renderContext,
  SectionHeader,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import { evidenceOf, recordAnchor } from '../view';

// Evidence (#10, slice 1, item 7): typed, attributable facts. Each shows its
// statement as the owner wrote it, its source by the owner's name for it,
// and its date as As of. A metric shows its value formatted in the content's
// language, with its unit, and nothing around it: no plus, no counter. A
// testimonial is a quote, and its source the person who said it.

type Evidence = NonNullable<VariantRenderInput['portfolio']['evidence']>[number];

/** A DOI as written, without a `doi:` or resolver prefix, and its doi.org link, each part encoded. */
export function doiLink(raw: string): { text: string; url: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** The source, by the owner's name for it, linked when it has an address. */
function Source({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const source = entry.source;
  if (!source || !present(source.name)) return null;
  return (
    <MaybeLink url={source.url} ctx={ctx}>
      {source.name}
    </MaybeLink>
  );
}

/** A metric's value and unit, or nothing when the metric is a statement alone. */
function MetricValue({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const metric = entry.metric;
  if (!metric || metric.value === undefined) return null;
  return (
    <p className="pf-metric" data-metric={metric.key}>
      <data className="pf-metric__value" value={String(metric.value)}>
        {formatFigure(metric.value, ctx)}
      </data>
      {present(metric.unit) ? (
        <>
          {' '}
          <span className="pf-metric__unit">{metric.unit}</span>
        </>
      ) : null}
    </p>
  );
}

/** One piece of evidence, as a list item whose id is the record's when this section lists it first. */
export function EvidenceEntry({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  const { input } = ctx;
  const asOf = entry.asOf !== undefined && (
    <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
  );
  if (entry.type === 'testimonial') {
    return (
      <li id={anchor} className="pf-item" data-evidence-type={entry.type}>
        <figure className="pf-quote">
          <blockquote
            cite={entry.source?.url !== undefined ? hrefFor(entry.source.url, input) : undefined}
          >
            <p>{entry.statement}</p>
          </blockquote>
          <figcaption>
            <Meta parts={[<Source key="source" entry={entry} ctx={ctx} />, asOf]} />
          </figcaption>
        </figure>
      </li>
    );
  }
  const doi = entry.doi !== undefined ? doiLink(entry.doi) : undefined;
  return (
    <li
      id={anchor}
      className="pf-item"
      data-evidence-type={entry.type}
      data-metric={entry.metric?.key}
    >
      <ItemTitle text={entry.title} url={entry.url} ctx={ctx} />
      <MetricValue entry={entry} ctx={ctx} />
      {present(entry.statement) ? <p className="pf-statement">{entry.statement}</p> : null}
      {entry.authors?.some(present) ? (
        <p className="pf-authors">{formatNames(entry.authors, ctx)}</p>
      ) : null}
      <Meta
        parts={[
          <Source key="source" entry={entry} ctx={ctx} />,
          entry.venue,
          asOf,
          doi && (
            <a key="doi" className="pf-doi" href={doi.url}>
              {doi.text}
            </a>
          ),
        ]}
      />
      {present(entry.description) ? <RichText source={entry.description} input={input} /> : null}
      <LinkList links={entry.links} ctx={ctx} />
    </li>
  );
}

export function EvidenceSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="pf-list pf-evidence" role="list">
        {evidenceOf(section, input).map((entry) => (
          <EvidenceEntry
            key={entry.id}
            entry={entry}
            ctx={ctx}
            anchor={recordAnchor(section, entry, input)}
          />
        ))}
      </ul>
    </>
  );
}
