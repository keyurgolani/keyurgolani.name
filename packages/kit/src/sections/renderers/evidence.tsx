import type { Evidence } from '@portfolio/schema';
import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
import {
  DateText,
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
  TagList,
  Ui,
  UrlLinks,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import { evidenceOf, recordAnchor } from '../view';

// Evidence (#10, slice 1, item 7): typed, attributable facts. Each shows the
// owner's words, its source by the owner's name for it, and when it was
// true, as As of. A metric shows its value formatted in the content's
// language, with its unit, and nothing around it: no plus, no counter. A
// testimonial is a quote, captioned with who said it. A field's own name is
// never shown: a talk's format and a patent's status show as their values,
// and a date or a link the owner gave no label for carries its field name
// on a data attribute, for a composition that labels it.

const TALK_FORMATS = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
} as const;

const PATENT_STATUSES = { granted: 'Granted', pending: 'Pending', expired: 'Expired' } as const;

/** A DOI as written, without a `doi:` or resolver prefix, and its doi.org link, each part encoded. */
export function doiLink(raw: string): { text: string; url: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** The source by the owner's name for it, linked when it has an address. */
function SourceName({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { source } = entry;
  if (!source) return null;
  return (
    <MaybeLink url={source.url} ctx={ctx}>
      {source.name}
    </MaybeLink>
  );
}

/** A metric's value and unit, or nothing when the metric names what it counts alone. */
function MetricValue({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { metric } = entry;
  if (metric?.value === undefined) return null;
  return (
    <p className="pf-metric">
      <data className="pf-metric__value" value={metric.value}>
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

/** A testimonial: the words, then who said them, with their role, organization, and portrait. */
function Testimonial({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { input } = ctx;
  const avatar = placedMedia(entry.source?.avatar, ctx);
  return (
    <figure className="pf-quote">
      <blockquote
        cite={entry.source?.url !== undefined ? hrefFor(entry.source.url, input) : undefined}
      >
        {present(entry.statement) ? <RichText source={entry.statement} input={input} /> : null}
      </blockquote>
      <figcaption>
        {avatar ? (
          <MediaFigure placed={avatar} ctx={ctx} className="pf-avatar" sizes="3rem" inline />
        ) : null}
        <Meta
          parts={[
            entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
            entry.source?.role,
            entry.source?.organization,
            entry.asOf !== undefined && (
              <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
            ),
          ]}
        />
      </figcaption>
    </figure>
  );
}

/** Any other evidence: its title, figure, words, and every fact the owner gave about it. */
function Fact({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { input } = ctx;
  const doi = entry.doi !== undefined ? doiLink(entry.doi) : undefined;
  const action = [entry.buttonText, entry.urlLabel].find(present);
  return (
    <>
      <ItemTitle text={entry.title} url={entry.url} ctx={ctx} />
      <MetricValue entry={entry} ctx={ctx} />
      {present(entry.statement) ? (
        <RichText source={entry.statement} className="pf-statement" input={input} />
      ) : null}
      {entry.authors?.length ? (
        <p className="pf-authors">{formatNames(entry.authors, ctx)}</p>
      ) : null}
      {entry.inventors?.length ? (
        <p className="pf-authors" data-field="inventors">
          {formatNames(entry.inventors, ctx)}
        </p>
      ) : null}
      <Meta
        parts={[
          entry.format !== undefined && (
            <Ui key="format" ctx={ctx}>
              {TALK_FORMATS[entry.format]}
            </Ui>
          ),
          entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
          entry.source?.role,
          entry.source?.organization,
          entry.venue,
          entry.publication,
          entry.author,
          entry.organization,
          entry.assignee,
          entry.location,
          entry.locationLabel,
          entry.number,
          entry.status !== undefined && (
            <Ui key="status" ctx={ctx}>
              {PATENT_STATUSES[entry.status]}
            </Ui>
          ),
          entry.publishedAt !== undefined && (
            <DateText key="published" raw={entry.publishedAt} ctx={ctx} field="publishedAt" />
          ),
          entry.presentedAt !== undefined && (
            <DateText key="presented" raw={entry.presentedAt} ctx={ctx} field="presentedAt" />
          ),
          entry.receivedAt !== undefined && (
            <DateText key="received" raw={entry.receivedAt} ctx={ctx} field="receivedAt" />
          ),
          entry.filedAt !== undefined && (
            <DateText key="filed" raw={entry.filedAt} ctx={ctx} field="filedAt" />
          ),
          entry.grantedAt !== undefined && (
            <DateText key="granted" raw={entry.grantedAt} ctx={ctx} field="grantedAt" />
          ),
          entry.asOf !== undefined && (
            <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
          ),
        ]}
      />
      {present(entry.abstract) ? (
        <RichText source={entry.abstract} className="pf-abstract" input={input} />
      ) : null}
      {present(entry.excerpt) ? (
        <blockquote className="pf-excerpt">
          <RichText source={entry.excerpt} input={input} />
        </blockquote>
      ) : null}
      {present(entry.description) ? <RichText source={entry.description} input={input} /> : null}
      {present(entry.citation) ? <p className="pf-citation">{entry.citation}</p> : null}
      <TagList items={entry.awards} className="pf-highlights" />
      <TagList items={entry.categories} />
      {entry.highlights?.length ? (
        <dl className="pf-facts">
          {entry.highlights.map((highlight, index) => (
            <div key={index}>
              <dt>{highlight.label}</dt>
              <dd>{highlight.sub}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {doi ? (
        <p className="pf-doi">
          <a href={doi.url}>{doi.text}</a>
        </p>
      ) : null}
      {action !== undefined && entry.url !== undefined ? (
        <p className="pf-external-link">
          <a className="pf-action" href={hrefFor(entry.url, input)}>
            {action}
          </a>
          {present(entry.buttonText) && present(entry.urlLabel) ? (
            <>
              {' '}
              <span className="pf-url">{entry.urlLabel}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <UrlLinks
        urls={[
          ['pdfUrl', entry.pdfUrl],
          ['slidesUrl', entry.slidesUrl],
          ['videoUrl', entry.videoUrl],
        ]}
        ctx={ctx}
      />
      <LinkList links={entry.links} ctx={ctx} />
    </>
  );
}

/** One piece of evidence, as a list item whose id is the record's on the first section that lists it. */
export function EvidenceEntry({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  return (
    <li
      id={anchor}
      className="pf-item"
      data-evidence-type={entry.type}
      data-metric={entry.metric?.key}
      data-icon={entry.iconName}
      lang={entry.lang}
    >
      {entry.type === 'testimonial' ? (
        <Testimonial entry={entry} ctx={ctx} />
      ) : (
        <Fact entry={entry} ctx={ctx} />
      )}
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
