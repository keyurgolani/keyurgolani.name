import type { ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  citesWhole,
  DateText,
  evidenceOf,
  formatFigure,
  formatNames,
  Heading,
  hrefFor,
  LabeledDate,
  MaybeLink,
  present,
  recordAnchor,
  renderContext,
  RichText,
  shownPlace,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Breakable, Chips, Fit, Line, linkText, Links, Out, Words } from '../parts';
import { shapeOf } from '../shapes';
import { RuledTable } from './ruled-table';

// Evidence, by type: a run of figures is fact cells, a big figure over its
// statement folded in as the label (never the hero-metric tile: no icon,
// no accent, the label is the record's own words); testimonials are
// pasted notes on the bare board, staggered; talks are a ruled table; and
// anything else, papers, awards, patents, press, work elsewhere, is a cell
// of its own, set side by side.

type Props = SectionRendererProps<SectionOf<'evidence'>>;

const TALK_FORMATS: Readonly<Record<string, string>> = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
};
const PATENT_STATUSES: Readonly<Record<string, string>> = {
  granted: 'Granted',
  pending: 'Pending',
  expired: 'Expired',
};

/** When the record was true. */
function When({ record, ctx }: { record: Evidence; ctx: RenderContext }): ReactNode {
  const raw =
    record.publishedAt ??
    record.presentedAt ??
    record.receivedAt ??
    record.grantedAt ??
    record.filedAt;
  if (raw !== undefined) return <DateText raw={raw} ctx={ctx} />;
  if (record.asOf !== undefined) return <LabeledDate label="As of" raw={record.asOf} ctx={ctx} />;
  return null;
}

/** The record's own links: its address's action, its PDF, slides, video, and links. */
function recordLinks(record: Evidence) {
  const action = [record.buttonText, record.urlLabel].find(present);
  return [
    record.url ? { url: record.url, text: action ?? 'Read' } : null,
    record.pdfUrl ? { url: record.pdfUrl, text: 'PDF' } : null,
    record.slidesUrl ? { url: record.slidesUrl, text: 'Slides' } : null,
    record.videoUrl ? { url: record.videoUrl, text: 'Video' } : null,
    ...(record.links ?? []).map((link) => ({ url: link.url, text: linkText(link) })),
  ].filter((link): link is { url: string; text: string } => link !== null);
}

/** A DOI as written, less a `doi:` or resolver prefix, and its doi.org address, each part encoded. */
export function doiLink(raw: string | undefined): { text: string; url: string } | undefined {
  const text = (raw ?? '').trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** A record's DOI, a label line linking to doi.org, the address wrapping at its own points. */
export function Doi({ raw, uiLang }: { raw: string | undefined; uiLang: 'en' | undefined }) {
  const doi = doiLink(raw);
  return doi ? (
    <p className="rg-meta">
      <Out href={doi.url}>
        <Words lang={uiLang}>DOI</Words> <Breakable text={doi.text} />
      </Out>
    </p>
  ) : null;
}

/** Fact cells: the figure at display size, its statement as the label. */
function Facts({
  section,
  records,
  ctx,
}: {
  section: SectionOf<'evidence'>;
  records: readonly Evidence[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  return (
    <>
      {records.map((record) => (
        <figure
          key={record.id}
          className="rg-cell rg-fact"
          id={recordAnchor(section, record, input)}
          lang={record.lang}
        >
          <p className="rg-fact__n">
            {formatFigure(record.metric!.value!, ctx)}
            {present(record.metric?.unit) &&
            !record.statement?.toLowerCase().startsWith(record.metric!.unit!.toLowerCase()) ? (
              <span className="rg-fact__unit"> {record.metric!.unit}</span>
            ) : null}
          </p>
          <figcaption>
            {present(record.statement) ? (
              <RichText source={record.statement} inline input={input} />
            ) : null}
            {present(record.description) ? (
              <span className="rg-meta">{record.description}</span>
            ) : null}
            {record.asOf !== undefined ? (
              <span className="rg-meta">
                <LabeledDate label="As of" raw={record.asOf} ctx={ctx} />
              </span>
            ) : null}
            {record.source ? (
              <span className="rg-meta" data-parts="">
                {present(record.source.name) ? (
                  <span>
                    <MaybeLink url={record.source.url} ctx={ctx}>
                      {record.source.name}
                    </MaybeLink>
                  </span>
                ) : null}
                {present(record.source.organization) ? (
                  <span>{record.source.organization}</span>
                ) : null}
              </span>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </>
  );
}

/** Testimonials: notes pasted on the bare board, the first set larger. */
function Notes({
  section,
  records,
  ctx,
}: {
  section: SectionOf<'evidence'>;
  records: readonly Evidence[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  return (
    <div className="rg-bay">
      <ul className="rg-wall" role="list" data-count={Math.min(records.length, 3)}>
        {records.map((record) => (
          <li key={record.id} className="rg-slot" lang={record.lang}>
            <figure className="rg-note" id={recordAnchor(section, record, input)}>
              <blockquote>
                <RichText source={record.statement ?? record.title ?? ''} input={input} />
              </blockquote>
              {record.source ? (
                <figcaption>
                  <span className="rg-note__who">
                    <MaybeLink url={record.source.url} ctx={ctx}>
                      {record.source.name}
                    </MaybeLink>
                  </span>
                  <Line
                    className="rg-meta"
                    parts={[record.source.role, record.source.organization]}
                  />
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Talks: the ruled table. */
function Talks({
  section,
  records,
  ctx,
}: {
  section: SectionOf<'evidence'>;
  records: readonly Evidence[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  return (
    <RuledTable
      rows={records}
      variant="talks"
      caption={section.title ?? 'Talks'}
      uiLang={ctx.uiLang}
      rowId={(record) => recordAnchor(section, record, input)}
      rowLang={(record) => record.lang}
      columns={[
        {
          key: 'when',
          head: 'When',
          className: 'rg-t-date',
          cell: (record) => <When record={record} ctx={ctx} />,
        },
        {
          key: 'talk',
          head: 'Talk',
          cell: (record) => (
            <>
              <Heading level={ctx.itemLevel} className="rg-t-title">
                {record.title ?? record.statement}
              </Heading>
              {present(record.abstract) ? (
                <RichText source={record.abstract} className="rg-t-desc" input={input} />
              ) : null}
              {present(record.description) ? (
                <RichText source={record.description} className="rg-t-desc" input={input} />
              ) : null}
            </>
          ),
        },
        {
          key: 'where',
          head: 'Where',
          cell: (record) => (
            <Line className="rg-meta" parts={[record.venue, shownPlace(record.location)]} />
          ),
        },
        {
          key: 'format',
          head: 'Format',
          cell: (record) =>
            record.format !== undefined && TALK_FORMATS[record.format] ? (
              <Words lang={ctx.uiLang}>{TALK_FORMATS[record.format]}</Words>
            ) : null,
        },
        {
          key: 'links',
          head: 'Links',
          hiddenHead: true,
          cell: (record) => (
            <Links
              links={recordLinks(record).filter((link) => link.text !== 'Read')}
              input={input}
            />
          ),
        },
      ]}
    />
  );
}

/**
 * Who and where: the record's own facts. A citation written whole stands for
 * the authors (A4), and a location of "online" isn't shown.
 */
function factsOf(record: Evidence, ctx: RenderContext): ReactNode[] {
  return [
    record.authors?.length && !citesWhole(record) ? formatNames(record.authors, ctx) : null,
    record.inventors?.length ? formatNames(record.inventors, ctx) : null,
    record.publication,
    record.author,
    record.organization,
    record.assignee,
    shownPlace(record.locationLabel) ?? shownPlace(record.location),
    // Where the work is, in the owner's words, when the link says what to do there instead.
    present(record.buttonText) && record.url ? record.urlLabel : undefined,
    record.number,
    record.status !== undefined && PATENT_STATUSES[record.status] ? (
      <Words lang={ctx.uiLang}>{PATENT_STATUSES[record.status]}</Words>
    ) : null,
  ];
}

/** Anything else: each record a cell, side by side. */
function Stack({
  section,
  records,
  ctx,
}: {
  section: SectionOf<'evidence'>;
  records: readonly Evidence[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  return (
    <>
      {records.map((record) => {
        const title = record.title ?? undefined;
        const links = recordLinks(record);
        const quote =
          record.excerpt ?? (record.type === 'testimonial' ? record.statement : undefined);
        return (
          <article
            key={record.id}
            className="rg-cell rg-item"
            id={recordAnchor(section, record, input)}
            lang={record.lang}
            data-type={record.type}
          >
            <Line
              className="rg-meta rg-item__top"
              // A citation written whole stands for the venue and date (A4).
              parts={
                citesWhole(record) ? [] : [record.venue, <When key="w" record={record} ctx={ctx} />]
              }
            />
            {title ? (
              <Heading level={ctx.itemLevel} className="rg-item__title">
                {/* By its longest word, the link's mark with the last. */}
                <Fit text={record.url ? `${title}↗` : title}>
                  {record.url ? <Out href={hrefFor(record.url, input)}>{title}</Out> : title}
                </Fit>
              </Heading>
            ) : null}
            {present(quote) ? (
              <blockquote className="rg-item__quote">
                <RichText source={quote} input={input} />
              </blockquote>
            ) : null}
            {!present(quote) && present(record.statement) && title ? (
              <RichText source={record.statement} input={input} />
            ) : null}
            {!title && present(record.statement) ? (
              <RichText source={record.statement} className="rg-item__quote" input={input} />
            ) : null}
            {/* Whose words or figure it is, as a note's caption says. */}
            {record.source ? (
              <Line
                className="rg-meta"
                parts={[
                  present(record.source.name) ? (
                    <MaybeLink key="n" url={record.source.url} ctx={ctx}>
                      {record.source.name}
                    </MaybeLink>
                  ) : null,
                  record.source.role,
                  record.source.organization,
                ]}
              />
            ) : null}
            {present(record.abstract) ? (
              <RichText source={record.abstract} className="rg-item__desc" input={input} />
            ) : null}
            {present(record.description) ? (
              <RichText source={record.description} className="rg-item__desc" input={input} />
            ) : null}
            <Line className="rg-meta" parts={factsOf(record, ctx)} />
            {record.highlights?.length ? (
              <dl className="rg-item__figs">
                {record.highlights.map((highlight, index) => (
                  <div key={index}>
                    <dt>{highlight.sub}</dt>
                    <dd className="rg-num">{highlight.label}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <Chips items={[...(record.categories ?? []), ...(record.awards ?? [])]} />
            {present(record.citation) ? <p className="rg-meta">{record.citation}</p> : null}
            <Doi raw={record.doi} uiLang={ctx.uiLang} />
            <Links links={links.filter((link) => !(title && link.text === 'Read'))} input={input} />
          </article>
        );
      })}
    </>
  );
}

export function EvidenceBody({ section, input, level }: Props) {
  const ctx = renderContext(input, section, level);
  const records = evidenceOf(section, input);
  switch (shapeOf(section, input)) {
    case 'facts':
      return <Facts section={section} records={records} ctx={ctx} />;
    case 'notes':
      return <Notes section={section} records={records} ctx={ctx} />;
    case 'table':
      return <Talks section={section} records={records} ctx={ctx} />;
    default:
      return <Stack section={section} records={records} ctx={ctx} />;
  }
}
