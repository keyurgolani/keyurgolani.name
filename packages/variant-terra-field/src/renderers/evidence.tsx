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
import { evidenceForm, said } from '../model';
import { Line, linkText, Links, Out, Words } from '../parts';

// Evidence, by type (brief §5.5): a run of figures is a ledger, each the
// record's own words with its figure at the end of the rule (never the
// hero-metric tile); testimonials are voices, the first set large;
// publications and patents are citation plates on paper; talks a ruled
// list; awards a row of field-coloured year seals; press pulled quotes;
// work elsewhere signposts; and a mix the ruled fallback.

type Props = SectionRendererProps<SectionOf<'evidence'>>;
type Part = {
  /** The section the records render in; none on a work's own page, where they take no anchor. */
  section?: SectionOf<'evidence'>;
  records: readonly Evidence[];
  ctx: RenderContext;
};

const anchorOf = (
  section: SectionOf<'evidence'> | undefined,
  record: Evidence,
  input: RenderContext['input'],
) => (section ? recordAnchor(section, record, input) : undefined);

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

/** A title, linked to the record's own address when it has one. */
function Title({
  record,
  ctx,
  className,
}: {
  record: Evidence;
  ctx: RenderContext;
  className: string;
}) {
  const title = record.title;
  if (!said(title)) return null;
  return (
    <Heading level={ctx.itemLevel} className={className}>
      {record.url ? <Out href={hrefFor(record.url, ctx.input)}>{title}</Out> : title}
    </Heading>
  );
}

/** The figures: a ledger of ruled rows, the record's words, then its figure at the rule's end. */
function Ledger({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <dl className="tf-ledger">
      {records.map((record) => {
        const unit = record.metric?.unit;
        const leads =
          said(unit) &&
          said(record.statement) &&
          record.statement.toLowerCase().startsWith(unit.toLowerCase());
        return (
          <div key={record.id} id={anchorOf(section, record, input)} lang={record.lang}>
            <dt>
              {said(record.statement) ? (
                <RichText source={record.statement} inline input={input} />
              ) : (
                record.title
              )}
              {said(record.description) ? (
                <span className="tf-ledger__note tf-compact tf-muted">{record.description}</span>
              ) : null}
            </dt>
            <dd className="tf-num">
              {formatFigure(record.metric!.value!, ctx)}
              {said(unit) && !leads ? <span className="tf-ledger__unit"> {unit}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Testimonials: voices, the first large, the others beside it. */
function Voices({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <div className="tf-voices" data-count={Math.min(records.length, 3)}>
      {records.map((record) => (
        <figure
          key={record.id}
          className="tf-voice"
          id={anchorOf(section, record, input)}
          lang={record.lang}
        >
          <blockquote>
            <RichText
              source={record.statement ?? record.title ?? ''}
              className="tf-quote"
              input={input}
            />
          </blockquote>
          {record.source ? (
            <figcaption className="tf-compact">
              <span className="tf-voice__who">
                <MaybeLink url={record.source.url} ctx={ctx}>
                  {record.source.name}
                </MaybeLink>
              </span>
              <Line className="tf-muted" parts={[record.source.role, record.source.organization]} />
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

/** Who and where: the record's own facts. A citation written whole stands for the authors. */
function factsOf(record: Evidence, ctx: RenderContext): ReactNode[] {
  return [
    record.authors?.length && !citesWhole(record) ? formatNames(record.authors, ctx) : null,
    record.inventors?.length ? formatNames(record.inventors, ctx) : null,
    record.publication,
    record.author,
    record.organization,
    record.assignee,
    shownPlace(record.locationLabel) ?? shownPlace(record.location),
    record.number,
    record.status !== undefined && PATENT_STATUSES[record.status] ? (
      <Words lang={ctx.uiLang}>{PATENT_STATUSES[record.status]}</Words>
    ) : null,
  ];
}

/** Publications and patents: citation plates on paper, each its venue and date, title, and reference. */
function Citations({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <div className="tf-cites" data-count={Math.min(records.length, 2)}>
      {records.map((record) => (
        <article
          key={record.id}
          className="tf-cite"
          id={anchorOf(section, record, input)}
          lang={record.lang}
        >
          <Line
            className="tf-label tf-kicker"
            parts={
              citesWhole(record) ? [] : [record.venue, <When key="w" record={record} ctx={ctx} />]
            }
          />
          <Title record={record} ctx={ctx} className="tf-title tf-cite__title" />
          <Line className="tf-compact tf-second" parts={factsOf(record, ctx)} />
          {said(record.abstract) ? (
            <RichText source={record.abstract} className="tf-compact" input={input} />
          ) : said(record.description) ? (
            <RichText source={record.description} className="tf-compact" input={input} />
          ) : null}
          {said(record.citation) ? (
            <p className="tf-cite__ref tf-compact tf-muted">{record.citation}</p>
          ) : null}
          {record.awards?.length ? (
            <p className="tf-compact tf-emph">{record.awards.join(', ')}</p>
          ) : null}
          <Links links={recordLinks(record).filter((link) => link.text !== 'Read')} input={input} />
        </article>
      ))}
    </div>
  );
}

/** Talks: a ruled list, each its date, title, where, and links. */
function Talks({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <ol className="tf-talks" role="list">
      {records.map((record) => (
        <li key={record.id} id={anchorOf(section, record, input)} lang={record.lang}>
          <p className="tf-talks__when tf-compact tf-num">
            <When record={record} ctx={ctx} />
          </p>
          <div className="tf-talks__main">
            <Heading level={ctx.itemLevel} className="tf-title">
              {record.title ?? record.statement}
            </Heading>
            {said(record.description) ? (
              <RichText
                source={record.description}
                className="tf-compact tf-second"
                input={input}
              />
            ) : null}
          </div>
          <Line
            className="tf-talks__where tf-compact"
            parts={[
              record.venue,
              shownPlace(record.location),
              record.format !== undefined && TALK_FORMATS[record.format] ? (
                <Words lang={ctx.uiLang}>{TALK_FORMATS[record.format]}</Words>
              ) : null,
            ]}
          />
          <Links className="tf-links tf-talks__links" links={recordLinks(record)} input={input} />
        </li>
      ))}
    </ol>
  );
}

/** Awards: each a year seal on the field's ground beside its title and who gave it. */
function YearSeals({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <ul className="tf-awards" role="list">
      {records.map((record) => (
        <li
          key={record.id}
          className="tf-award"
          id={anchorOf(section, record, input)}
          lang={record.lang}
        >
          <p className="tf-award__seal tf-title tf-num" aria-hidden="true">
            {String(record.receivedAt).slice(0, 4)}
          </p>
          <div className="tf-award__text">
            <p className="tf-sr">
              <When record={record} ctx={ctx} />
            </p>
            <Title record={record} ctx={ctx} className="tf-title" />
            <Line className="tf-compact tf-second" parts={[record.organization]} />
            {said(record.description) ? (
              <RichText source={record.description} className="tf-compact" input={input} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Press: the excerpt pulled, captioned with where and when it ran. */
function PullQuotes({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <div className="tf-press" data-count={Math.min(records.length, 2)}>
      {records.map((record) => (
        <figure
          key={record.id}
          className="tf-pull"
          id={anchorOf(section, record, input)}
          lang={record.lang}
        >
          {said(record.excerpt) ? (
            <blockquote>
              <RichText source={record.excerpt} className="tf-quote" input={input} />
            </blockquote>
          ) : null}
          <figcaption className="tf-compact">
            <Title record={record} ctx={ctx} className="tf-title tf-pull__title" />
            <Line
              className="tf-muted"
              parts={[
                record.publication,
                record.author,
                <When key="w" record={record} ctx={ctx} />,
              ]}
            />
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Work elsewhere: signposts, each its place, what it holds, and the way there. */
function Signposts({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <ul className="tf-places" role="list">
      {records.map((record) => {
        const links = recordLinks(record);
        return (
          <li
            key={record.id}
            className="tf-place"
            id={anchorOf(section, record, input)}
            lang={record.lang}
          >
            <Line
              className="tf-label tf-kicker"
              parts={[shownPlace(record.locationLabel), ...(record.categories ?? [])]}
            />
            <Title record={record} ctx={ctx} className="tf-title" />
            {said(record.description) ? (
              <RichText
                source={record.description}
                className="tf-compact tf-second"
                input={input}
              />
            ) : said(record.statement) ? (
              <RichText source={record.statement} className="tf-compact tf-second" input={input} />
            ) : null}
            {record.highlights?.length ? (
              <dl className="tf-place__figs tf-compact">
                {record.highlights.map((highlight, index) => (
                  <div key={index}>
                    <dt className="tf-muted">{highlight.sub}</dt>
                    <dd className="tf-num">{highlight.label}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <Links
              links={links.filter((link) => !(record.title && link.text === 'Read'))}
              input={input}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Anything else: one ruled list, every record its date, title, words, and links. */
function Ruled({ section, records, ctx }: Part) {
  const { input } = ctx;
  return (
    <ul className="tf-rows" role="list">
      {records.map((record) => {
        const quote =
          record.excerpt ?? (record.type === 'testimonial' ? record.statement : undefined);
        return (
          <li
            key={record.id}
            id={anchorOf(section, record, input)}
            lang={record.lang}
            data-type={record.type}
          >
            <p className="tf-rows__when tf-compact tf-num">
              <When record={record} ctx={ctx} />
            </p>
            <div className="tf-rows__main">
              <Title record={record} ctx={ctx} className="tf-title" />
              {record.type === 'metric' && record.metric?.value !== undefined ? (
                <p className="tf-title tf-num">
                  {formatFigure(record.metric.value, ctx)}
                  {said(record.metric.unit) ? ` ${record.metric.unit}` : null}
                </p>
              ) : null}
              {said(quote) ? (
                <blockquote>
                  <RichText source={quote} className="tf-quote" input={input} />
                </blockquote>
              ) : said(record.statement) ? (
                <RichText source={record.statement} input={input} />
              ) : null}
              {said(record.description) ? (
                <RichText
                  source={record.description}
                  className="tf-compact tf-second"
                  input={input}
                />
              ) : null}
              <Line
                className="tf-compact tf-muted"
                parts={[...factsOf(record, ctx), record.source?.name]}
              />
              <Links
                links={recordLinks(record).filter(
                  (link) => !(record.title && link.text === 'Read'),
                )}
                input={input}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceBody({ section, input, level }: Props) {
  const ctx = renderContext(input, section, level);
  return <Records part={{ section, records: evidenceOf(section, input), ctx }} />;
}

/**
 * A work's cited records on its own page, in the order it cites them: each
 * run of one type in that type's own form, as home sets them (the award's
 * year seal, a voice, a citation plate, a ledger row), none taking an
 * anchor, since their sections on home hold those.
 */
export function CitedRecords({
  records,
  ctx,
}: {
  records: readonly Evidence[];
  ctx: RenderContext;
}) {
  const runs: Evidence[][] = [];
  for (const record of records) {
    const last = runs.at(-1);
    if (last && evidenceForm([...last, record]) === evidenceForm([record])) last.push(record);
    else runs.push([record]);
  }
  return (
    <div className="tf-cited">
      {runs.map((run) => (
        <Records key={run[0]!.id} part={{ records: run, ctx }} />
      ))}
    </div>
  );
}

function Records({ part }: { part: Part }) {
  switch (evidenceForm(part.records)) {
    case 'ledger':
      return <Ledger {...part} />;
    case 'voices':
      return <Voices {...part} />;
    case 'citations':
      return <Citations {...part} />;
    case 'talks':
      return <Talks {...part} />;
    case 'year-seals':
      return <YearSeals {...part} />;
    case 'pull-quotes':
      return <PullQuotes {...part} />;
    case 'signposts':
      return <Signposts {...part} />;
    default:
      return <Ruled {...part} />;
  }
}
