import type { ReactNode } from 'react';
import type { Evidence, Section } from '@portfolio/schema';
import {
  citesWhole,
  evidenceOf,
  formatFigure,
  formatNames,
  Heading,
  hrefFor,
  present,
  recordAnchor,
  renderContext,
  RichText,
  shownPlace,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { dateText, folds, recordState, said, type HomeModel } from '../model';
import { linkText, Out, StateLine, traceAttrs, Words } from '../parts';

// Evidence on the wall. Metrics are a ledger (the figure in the numeric
// role, the statement verbatim beside it); the Overview's square readouts
// are their summary. Testimonials are quote cells, a hairline between
// them. Everything else is a log row: when, what, where, and its lamps; in
// a mixed section a testimonial's row is its quote with its source, and a
// metric's row leads with its figure.

/** The date an evidence record's own fields give, the most telling first. */
const dateOf = (record: Evidence) =>
  record.publishedAt ??
  record.presentedAt ??
  record.grantedAt ??
  record.receivedAt ??
  record.filedAt;

/** Where an evidence record happened or appeared: each place it names, in that order. */
const placeOf = (record: Evidence) =>
  [record.venue, record.publication, record.organization, shownPlace(record.location)]
    .filter(said)
    .join(', ') || undefined;

/** Who a source is: the name, then the role and organization, as written. */
const sourceText = (record: Evidence) =>
  record.source
    ? [record.source.name, record.source.role, record.source.organization].filter(said).join(', ')
    : undefined;

/**
 * A record's who and what past its title, by its type's fields: the authors (unless a whole
 * citation stands for them, A4), inventors, an article's author, a patent's number and
 * assignee, an outside work's categories, place and address label, and a non-testimonial
 * record's source.
 */
function factsOf(record: Evidence, ctx: RenderContext): string[] {
  return [
    !citesWhole(record) && record.authors?.length ? formatNames(record.authors, ctx) : undefined,
    record.inventors?.length ? formatNames(record.inventors, ctx) : undefined,
    record.author,
    record.number,
    record.assignee,
    record.categories?.filter(said).join(', '),
    shownPlace(record.locationLabel),
    record.urlLabel,
    record.type === 'testimonial' ? undefined : sourceText(record),
  ].filter((part): part is string => said(part));
}

/** The rest of what the owner wrote about a record: its abstract, excerpt, citation, DOI, awards, figures and links. */
function RecordMore({
  record,
  ctx,
  titled,
}: {
  record: Evidence;
  ctx: RenderContext;
  /** The link the record's title already carries, if any. */
  titled: string | undefined;
}) {
  const { input } = ctx;
  const facts = factsOf(record, ctx);
  // The title's own link, unless its label says something the title doesn't, then the rest.
  const links = (record.links ?? []).filter(
    (link) => link.url !== titled || (said(link.label) && link.label !== record.title),
  );
  const button = said(record.buttonText) && record.url ? record.url : undefined;
  const highlights = (record.highlights ?? []).filter(({ label, sub }) => said(label) || said(sub));
  const awards = (record.awards ?? []).filter(said);
  return (
    <>
      {facts.length > 0 ? (
        <p className="mc-log__facts">
          {facts.map((fact, index) => (
            <span key={index}>{fact}</span>
          ))}
        </p>
      ) : null}
      {present(record.excerpt) ? (
        <blockquote className="mc-excerpt">
          <RichText source={record.excerpt} input={input} />
        </blockquote>
      ) : null}
      {present(record.abstract) ? (
        <RichText source={record.abstract} className="mc-log__summary" input={input} />
      ) : null}
      {said(record.citation) ? <p className="mc-log__cite">{record.citation}</p> : null}
      {highlights.length > 0 ? (
        <ul className="mc-figures">
          {highlights.map(({ label, sub }, index) => (
            <li key={index}>
              <span className="mc-figures__figure mc-num">{label}</span>{' '}
              <span className="mc-figures__sub">{sub}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {awards.length > 0 ? (
        <ul className="mc-ticks">
          {awards.map((award, index) => (
            <li key={index}>{award}</li>
          ))}
        </ul>
      ) : null}
      {said(record.doi) || links.length > 0 || button ? (
        <ul className="mc-actions">
          {button ? (
            <li>
              <Out href={hrefFor(button, input)} className="mc-link">
                {record.buttonText}
              </Out>
            </li>
          ) : null}
          {said(record.doi) ? (
            <li>
              <Out
                href={`https://doi.org/${encodeURI(record.doi!.replace(/^https?:\/\/doi\.org\//i, ''))}`}
                className="mc-link"
              >
                <span className="mc-num">{record.doi}</span>
              </Out>
            </li>
          ) : null}
          {links.map((link) => (
            <li key={link.url}>
              <Out href={hrefFor(link.url, input)} className="mc-link">
                {linkText(link)}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Ledger({
  section,
  input,
  records,
  model,
}: {
  section: Section;
  input: VariantRenderInput;
  records: readonly Evidence[];
  model: HomeModel;
}) {
  const ctx = renderContext(input, section as SectionOf<'evidence'>, 2);
  return (
    <dl className="mc-ledger">
      {records.map((record) => (
        <div
          key={record.id}
          className="mc-ledger__row"
          id={recordAnchor(section, record, input)}
          lang={record.lang}
          {...traceAttrs(record.id, model)}
        >
          <dt className="mc-ledger__figure">
            <Figure record={record} ctx={ctx} />
          </dt>
          <dd className="mc-ledger__text">
            {said(record.statement) ? (
              <>
                {said(record.title) ? (
                  <span className="mc-ledger__title">{record.title}</span>
                ) : null}
                <RichText
                  source={record.statement}
                  inline
                  className="mc-ledger__statement"
                  input={input}
                />
              </>
            ) : said(record.title) ? (
              <span className="mc-ledger__statement">{record.title}</span>
            ) : null}
            {sourceText(record) ? (
              <span className="mc-ledger__note">{sourceText(record)}</span>
            ) : null}
            {said(record.description) ? (
              <RichText
                source={record.description}
                inline
                className="mc-ledger__note"
                input={input}
              />
            ) : null}
            <StateLine
              id={record.id}
              lamps={[]}
              anchored={recordAnchor(section, record, input) !== undefined}
              model={model}
              input={input}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A testimonial: the quote, then who said it. */
function Quote({
  record,
  input,
  state,
}: {
  record: Evidence;
  input: VariantRenderInput;
  /** Its lamps and Linked control, on the caption's row after the source. */
  state?: ReactNode;
}) {
  const role = [record.source?.role, record.source?.organization].filter(said);
  return (
    <figure className="mc-quote">
      {said(record.statement) ? (
        <blockquote className="mc-quote__text">
          <RichText source={record.statement} input={input} />
        </blockquote>
      ) : null}
      {record.source || state ? (
        <figcaption className="mc-quote__source">
          {record.source ? (
            <span className="mc-quote__who">
              <span className="mc-quote__name">{record.source.name}</span>
              {role.length > 0 ? <span className="mc-quote__role">{role.join(', ')}</span> : null}
            </span>
          ) : null}
          {state}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A metric's figure and unit, in the numeric role. */
function Figure({ record, ctx }: { record: Evidence; ctx: ReturnType<typeof renderContext> }) {
  return (
    <>
      {record.metric?.value !== undefined ? (
        <span className="mc-num">{formatFigure(record.metric.value, ctx)}</span>
      ) : null}
      {said(record.metric?.unit) ? (
        <span className="mc-ledger__unit"> {record.metric!.unit}</span>
      ) : null}
    </>
  );
}

function Quotes({
  section,
  input,
  records,
  model,
}: {
  section: Section;
  input: VariantRenderInput;
  records: readonly Evidence[];
  model: HomeModel;
}) {
  const cell = (record: Evidence) => (
    <li
      key={record.id}
      id={recordAnchor(section, record, input)}
      lang={record.lang}
      {...traceAttrs(record.id, model)}
    >
      <Quote
        record={record}
        input={input}
        state={
          <StateLine
            id={record.id}
            lamps={[]}
            anchored={recordAnchor(section, record, input) !== undefined}
            model={model}
            input={input}
          />
        }
      />
    </li>
  );
  // The first quote stands on the wall; the rest wait under one disclosure inside the panel,
  // as Experience's earlier roles do (Design gate rule 7). A section of the full record is
  // already folded, so it lists every quote.
  const [first, ...more] = records;
  if (more.length === 0 || folds(section, input))
    return <ul className="mc-quotes">{records.map(cell)}</ul>;
  return (
    <div className="mc-quoteset" data-more={Math.min(more.length, 3)}>
      <ul className="mc-quotes mc-quotes--lead">{cell(first!)}</ul>
      <details className="mc-fold mc-fold--inner mc-quoteset__more" data-mc-fold="">
        <summary className="mc-fold__bar mc-fold__bar--inner">
          <span className="mc-count">
            <span className="mc-num">{more.length}</span>{' '}
            <Words lang={model.uiLang}>{more.length === 1 ? 'more quote' : 'more quotes'}</Words>
          </span>
        </summary>
        <ul className="mc-quotes">{more.map(cell)}</ul>
      </details>
    </div>
  );
}

function Log({
  section,
  input,
  records,
  level,
  model,
}: {
  section: Section;
  input: VariantRenderInput;
  records: readonly Evidence[];
  level: SectionRendererProps<Section>['level'];
  model: HomeModel;
}) {
  const ctx = renderContext(input, section as SectionOf<'evidence'>, level);
  // A log none of whose records has a date drops the date track, rather than indent every row
  // into an empty one (G2).
  const dated = records.some((record) => dateOf(record) !== undefined);
  return (
    <ol className="mc-log" {...(dated ? {} : { 'data-dated': 'none' })}>
      {records.map((record) => {
        const date = dateOf(record);
        // A record whose button names its address links there, and its title stays words.
        const url = said(record.buttonText) ? undefined : (record.url ?? record.links?.[0]?.url);
        const quote = record.type === 'testimonial';
        const figure =
          record.type === 'metric' &&
          (record.metric?.value !== undefined || said(record.metric?.unit));
        // A quote is its own words, not a title; any other record is titled by its title,
        // else its statement.
        const title = quote ? record.title : (record.title ?? record.statement);
        const place = placeOf(record);
        return (
          <li
            key={record.id}
            id={recordAnchor(section, record, input)}
            lang={record.lang}
            className="mc-log__row"
            {...traceAttrs(record.id, model)}
          >
            {date ? (
              <time className="mc-log__date mc-num" dateTime={date}>
                {dateText(date, input.portfolio.locale)}
              </time>
            ) : dated ? (
              <span className="mc-log__date" />
            ) : null}
            <div className="mc-log__main">
              {figure ? (
                <p className="mc-log__figure">
                  <Figure record={record} ctx={ctx} />
                </p>
              ) : null}
              {said(title) ? (
                <Heading level={ctx.itemLevel} className="mc-log__title">
                  {url ? (
                    <Out href={hrefFor(url, input)}>
                      <RichText source={title} inline input={input} />
                    </Out>
                  ) : (
                    <RichText source={title} inline input={input} />
                  )}
                </Heading>
              ) : null}
              {quote ? (
                <Quote record={record} input={input} />
              ) : record.title !== undefined && said(record.statement) ? (
                <RichText source={record.statement} className="mc-log__summary" input={input} />
              ) : null}
              {said(record.description) ? (
                <RichText source={record.description} className="mc-log__summary" input={input} />
              ) : null}
              <RecordMore record={record} ctx={ctx} titled={url} />
            </div>
            <div className="mc-log__meta">
              {place ? <span>{place}</span> : null}
              <StateLine
                id={record.id}
                lamps={recordState(record, input)}
                anchored={recordAnchor(section, record, input) !== undefined}
                model={model}
                input={input}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EvidenceBody(
  props: SectionRendererProps<SectionOf<'evidence'>> & { model: HomeModel },
) {
  const { section, input, level, model } = props;
  const records = evidenceOf(section, input);
  if (records.length === 0) return null;
  if (records.every((record) => record.type === 'metric'))
    return <Ledger section={section} input={input} records={records} model={model} />;
  if (records.every((record) => record.type === 'testimonial'))
    return <Quotes section={section} input={input} records={records} model={model} />;
  return <Log section={section} input={input} records={records} level={level} model={model} />;
}
