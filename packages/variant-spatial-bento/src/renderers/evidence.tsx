import type { ReactElement } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  citesWhole,
  DateText,
  evidenceOf,
  formatFigure,
  formatNames,
  Heading,
  present,
  recordAnchor,
  renderContext,
  RichText,
  shownPlace,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { evidenceType } from '../model';
import { AddressRow, Facts, LinkRow, Out, TileHead } from '../parts';

// The evidence tiles, each entry the object its type is: a metric a row of
// a tally, its count in squares, a testimonial a quote with whoever said
// it, a paper with its authors and its links, a talk a ticket stub with its
// date punched out, an award a dated row, a patent its number and the span
// from filing to grant, press a pull quote, and work elsewhere a link with
// its figures in its caption line. A section's tile takes the shape of what it mostly holds.

type EvidenceProps = SectionRendererProps<SectionOf<'evidence'>>;

interface ItemProps {
  readonly entry: Evidence;
  readonly ctx: RenderContext;
  readonly anchor?: string;
  /** Its title as a line, not a heading: an entry set outside any part, before the sheet's first heading (SPA-1). */
  readonly plain?: boolean;
}

/** The entry's name: its title, else its source's. */
const nameOf = (entry: Evidence) =>
  present(entry.title) ? entry.title : present(entry.source?.name) ? entry.source.name : undefined;

/** The entry's title, a link when it has an address. */
function Title({ entry, ctx, className, plain }: ItemProps & { className: string }) {
  const name = nameOf(entry);
  if (name === undefined) return null;
  const words = present(entry.url) ? (
    <Out url={entry.url} ctx={ctx}>
      {name}
    </Out>
  ) : (
    name
  );
  return plain ? (
    <p className={className}>{words}</p>
  ) : (
    <Heading level={ctx.itemLevel} className={className}>
      {words}
    </Heading>
  );
}

/** The most a tally counts out in squares: past it, or for a figure that isn't a whole count, the figure stands alone. */
export const TALLY_MOST = 60;

/** How many squares a metric's tally draws: its value, when that's a whole count from 1 to TALLY_MOST; else none. */
export function tallyOf(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= TALLY_MOST
    ? value
    : 0;
}

/**
 * A metric as a row of the tally, one chart (S6): what it counts, the
 * figure and its unit, then a strip of squares three deep, one a count,
 * each in its own track, so every strip starts on one line and the strips
 * down the tile compare at a glance; a note under it. The squares are
 * decoration: the figure says it.
 */
/**
 * A tally row's words (E3): its statement, or for a long one with no note
 * of its own, the clause before its first comma as what it counts and the
 * rest as its note, so "Years engineering" sits with its figure and strip.
 */
export function tallyWords(
  statement: string | undefined,
  description: string | undefined,
): { label?: string; note?: string } {
  const note = present(description) ? description : undefined;
  if (!present(statement)) return note ? { note } : {};
  const text = statement.trim();
  const comma = text.indexOf(', ');
  if (note || text.length <= TALLY_LABEL || comma < 0 || comma > TALLY_LABEL) {
    return { label: text, ...(note ? { note } : {}) };
  }
  return { label: text.slice(0, comma), note: text.slice(comma + 2) };
}

/** The longest statement a tally row keeps whole as its label. */
export const TALLY_LABEL = 32;

function TallyRow({ entry, ctx, anchor }: ItemProps) {
  const metric = entry.metric;
  const words = tallyWords(entry.statement, entry.description);
  const label = words.label ?? nameOf(entry);
  const squares = tallyOf(metric?.value);
  return (
    <div id={anchor} className="sb-tally__row" lang={entry.lang}>
      <dt className="sb-tally__what">
        {label !== undefined ? <RichText source={label} inline input={ctx.input} /> : null}
      </dt>
      <dd className="sb-tally__figure">
        <span className="sb-tally__value">
          {metric?.value !== undefined ? (
            <data value={metric.value}>{formatFigure(metric.value, ctx)}</data>
          ) : null}
          {present(metric?.unit) ? <span className="sb-tally__unit"> {metric.unit}</span> : null}
        </span>
        {squares > 0 ? (
          <span className="sb-tally__marks" aria-hidden="true" data-count={squares}>
            {Array.from({ length: squares }, (_, index) => (
              <span key={index} />
            ))}
          </span>
        ) : null}
      </dd>
      {words.note !== undefined ? <dd className="sb-tally__note">{words.note}</dd> : null}
    </div>
  );
}

/** A testimonial: the words, then who said them. */
// One treatment for every quote, so none carries a picture the others don't: no avatars.
function Testimonial({ entry, ctx, anchor }: ItemProps) {
  const source = entry.source;
  return (
    <figure id={anchor} className="sb-quote" lang={entry.lang}>
      {present(entry.statement) ? (
        <blockquote className="sb-quote__words">
          <RichText source={`“${entry.statement.trim()}”`} input={ctx.input} />
        </blockquote>
      ) : null}
      {source ? (
        <figcaption className="sb-quote__who">
          <span className="sb-strong">
            {present(source.url) ? (
              <Out url={source.url} ctx={ctx}>
                {source.name}
              </Out>
            ) : (
              source.name
            )}
          </span>
          <Facts className="sb-label" parts={[source.role, source.organization]} />
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A paper: its title, authors, venue and date, any award, and its links. */
function Paper({ entry, ctx, anchor }: ItemProps) {
  return (
    <li id={anchor} className="sb-paper" lang={entry.lang}>
      <Title entry={entry} ctx={ctx} className="sb-strong" />
      {/* A citation written whole stands for the authors, venue, and date (A4). */}
      {citesWhole(entry) ? null : (
        <Facts
          className="sb-label"
          parts={[
            entry.authors?.length ? formatNames(entry.authors, ctx) : null,
            entry.venue,
            entry.publishedAt !== undefined ? <DateText raw={entry.publishedAt} ctx={ctx} /> : null,
          ]}
        />
      )}
      {entry.awards?.length ? (
        <ul className="sb-chips" role="list">
          {entry.awards.filter(present).map((award) => (
            <li key={award} className="sb-chip">
              {award}
            </li>
          ))}
        </ul>
      ) : null}
      {present(entry.abstract) ? (
        <RichText source={entry.abstract} input={ctx.input} className="sb-quiet" />
      ) : null}
      {present(entry.citation) ? <p className="sb-label sb-paper__cite">{entry.citation}</p> : null}
      <AddressRow
        items={[
          [entry.pdfUrl, 'PDF'],
          [present(entry.doi) ? `https://doi.org/${entry.doi}` : undefined, 'DOI'],
        ]}
        ctx={ctx}
      />
      <LinkRow links={entry.links} ctx={ctx} />
    </li>
  );
}

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A YYYY-MM-DD date's day of the month and its month and year, for a ticket's stub. */
function stubOf(raw: string | undefined) {
  const match = raw === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return undefined;
  const day = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return undefined;
  return { day: String(Number(match[3])), month: MONTH.format(day), iso: raw! };
}

/** A talk: a ticket, its date punched out at the start. */
function Ticket({ entry, ctx, anchor }: ItemProps) {
  const stub = stubOf(entry.presentedAt);
  return (
    <li id={anchor} className="sb-ticket" lang={entry.lang}>
      <p className="sb-ticket__stub">
        {stub ? (
          <time dateTime={stub.iso}>
            <span className="sb-ticket__day">{stub.day}</span>
            <span className="sb-ticket__month" lang={ctx.uiLang}>
              {stub.month}
            </span>
          </time>
        ) : entry.presentedAt !== undefined ? (
          <DateText raw={entry.presentedAt} ctx={ctx} />
        ) : null}
      </p>
      <div className="sb-ticket__body">
        <Title entry={entry} ctx={ctx} className="sb-strong" />
        <Facts className="sb-label" parts={[entry.venue, shownPlace(entry.location)]} />
        {present(entry.description) ? (
          <RichText source={entry.description} input={ctx.input} className="sb-quiet" />
        ) : null}
        <AddressRow
          items={[
            [entry.slidesUrl, 'Slides'],
            [entry.videoUrl, 'Video'],
          ]}
          ctx={ctx}
        />
      </div>
    </li>
  );
}

/** The year of a loose date. */
const yearOf = (raw: string | undefined) =>
  raw === undefined ? undefined : /^\d{4}/.exec(raw)?.[0];

/** An award: its year large, then what and from whom. */
function Dated({ entry, ctx, anchor }: ItemProps) {
  const year = yearOf(entry.receivedAt ?? entry.asOf ?? entry.publishedAt);
  return (
    <li id={anchor} className="sb-dated" lang={entry.lang}>
      <p className="sb-dated__year">{year ?? ''}</p>
      <div className="sb-dated__body">
        <Title entry={entry} ctx={ctx} className="sb-strong" />
        <Facts className="sb-label" parts={[entry.organization, entry.source?.name]} />
        {present(entry.description) ? (
          <RichText source={entry.description} input={ctx.input} className="sb-quiet" />
        ) : present(entry.statement) ? (
          <RichText source={entry.statement} input={ctx.input} className="sb-quiet" />
        ) : null}
      </div>
    </li>
  );
}

/** A patent: its number at title size, its status, and the span from filing to grant. */
function Patent({ entry, ctx, anchor }: ItemProps) {
  return (
    <li id={anchor} className="sb-patent" lang={entry.lang}>
      <div className="sb-patent__top">
        {present(entry.number) ? <p className="sb-patent__number">{entry.number}</p> : null}
        {entry.status !== undefined ? (
          <p className="sb-chip" data-status={entry.status} lang={ctx.uiLang}>
            {entry.status}
          </p>
        ) : null}
      </div>
      <Title entry={entry} ctx={ctx} className="sb-strong" />
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} className="sb-quiet" />
      ) : null}
      {entry.filedAt !== undefined || entry.grantedAt !== undefined ? (
        <p className="sb-span">
          {entry.filedAt !== undefined ? (
            <span className="sb-label">
              <DateText raw={entry.filedAt} ctx={ctx} field="filedAt" />
            </span>
          ) : null}
          <span className="sb-span__line" aria-hidden="true" />
          {entry.grantedAt !== undefined ? (
            <span className="sb-label">
              <DateText raw={entry.grantedAt} ctx={ctx} field="grantedAt" />
            </span>
          ) : null}
        </p>
      ) : null}
      <Facts
        className="sb-label"
        parts={[entry.inventors?.length ? formatNames(entry.inventors, ctx) : null, entry.assignee]}
      />
    </li>
  );
}

/** Press: the line it printed, at title size, then who wrote it, and where. */
function Press({ entry, ctx, anchor, plain }: ItemProps) {
  const words = present(entry.excerpt) ? entry.excerpt : entry.statement;
  return (
    <li id={anchor} className="sb-press" lang={entry.lang}>
      {present(words) ? (
        <blockquote className="sb-press__words">
          <RichText source={`“${words.trim()}”`} input={ctx.input} />
        </blockquote>
      ) : null}
      <Title entry={entry} ctx={ctx} className="sb-label sb-press__title" plain={plain} />
      <Facts
        className="sb-label"
        parts={[
          entry.author,
          entry.publication,
          entry.publishedAt !== undefined ? <DateText raw={entry.publishedAt} ctx={ctx} /> : null,
        ]}
      />
    </li>
  );
}

/** Work elsewhere: a link whose whole item is the target, with its own figures. */
/**
 * A highlight as words in a caption line: its figure, then what it counts,
 * in lower case after the figure ("120+ published frames"), and a unit
 * stuck to its figure given its space ("~52 min").
 */
export function figureWords(figure: string | undefined, what: string | undefined): string {
  const spaced = (figure ?? '').trim().replace(/^([~≈<>+-]?[\d.,]+[+]?)([a-z]+)$/i, '$1 $2');
  const counted = (what ?? '').trim();
  const lower =
    counted.length > 1 && /^[A-Z][a-z]/.test(counted) && !/[A-Z]/.test(counted.slice(1))
      ? counted[0]!.toLowerCase() + counted.slice(1)
      : counted;
  return [spaced, lower].filter((part) => part !== '').join(' ');
}

function Elsewhere({ entry, ctx, anchor }: ItemProps) {
  const label = present(entry.buttonText)
    ? entry.buttonText
    : present(entry.urlLabel)
      ? entry.urlLabel
      : undefined;
  return (
    <li id={anchor} className="sb-elsewhere" lang={entry.lang}>
      <Title entry={entry} ctx={ctx} className="sb-strong" />
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} className="sb-quiet" />
      ) : null}
      {/* Where it lives and what kind it is, in the meta line's own words, not chips. */}
      <Facts
        className="sb-label"
        parts={[
          shownPlace(entry.locationLabel),
          entry.categories?.some(present)
            ? formatNames(entry.categories.filter(present), ctx)
            : null,
          ...(entry.highlights ?? []).map((highlight) =>
            figureWords(highlight.label, highlight.sub),
          ),
          present(entry.url) && label !== undefined ? (
            <Out url={entry.url} ctx={ctx}>
              {label}
            </Out>
          ) : null,
        ]}
      />
    </li>
  );
}

/** Anything else: its name, its words, its source, and its date. */
function Entry({ entry, ctx, anchor }: ItemProps) {
  return (
    <li id={anchor} className="sb-entry" lang={entry.lang}>
      <Title entry={entry} ctx={ctx} className="sb-strong" />
      {entry.metric?.value !== undefined ? (
        <p className="sb-entry__figure">
          <data value={entry.metric.value}>{formatFigure(entry.metric.value, ctx)}</data>
          {present(entry.metric.unit) ? ` ${entry.metric.unit}` : null}
        </p>
      ) : null}
      {present(entry.statement) ? <RichText source={entry.statement} input={ctx.input} /> : null}
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} className="sb-quiet" />
      ) : null}
      <Facts
        className="sb-label"
        parts={[
          entry.source?.organization,
          entry.venue,
          shownPlace(entry.location),
          entry.asOf !== undefined ? <DateText raw={entry.asOf} ctx={ctx} /> : null,
        ]}
      />
      <LinkRow links={entry.links} ctx={ctx} />
    </li>
  );
}

const ITEMS: Partial<Record<Evidence['type'], (props: ItemProps) => ReactElement>> = {
  publication: Paper,
  talk: Ticket,
  award: Dated,
  patent: Patent,
  press: Press,
  'external-work': Elsewhere,
};

/** The component an entry renders as, among other evidence. */
const itemOf = (entry: Evidence) =>
  entry.type === 'metric' || entry.type === 'testimonial' ? Entry : (ITEMS[entry.type] ?? Entry);

/**
 * Evidence a work cites, each as its type is, for the case-study sheet; any
 * figures the sheet draws for the part lead the records, a row each (SPA-1).
 */
export function EvidenceItems({
  entries,
  ctx,
  figures = [],
  plain,
  after,
}: {
  readonly entries: readonly Evidence[];
  readonly ctx: RenderContext;
  readonly figures?: readonly ReactElement[];
  /** Titles as lines, not headings: for records set before the sheet's first heading. */
  readonly plain?: boolean;
  /** The figures after the records, not before them. */
  readonly after?: boolean;
}) {
  if (entries.length === 0 && figures.length === 0) return null;
  const drawn = figures.map((figure) => <li key={figure.key}>{figure}</li>);
  return (
    <ul className="sb-ev" role="list">
      {after ? null : drawn}
      {entries.map((entry) => {
        const Item = itemOf(entry);
        return <Item key={entry.id} entry={entry} ctx={ctx} plain={plain} />;
      })}
      {after ? drawn : null}
    </ul>
  );
}

/** An evidence section: one tile, shaped by what it mostly holds. */
export function EvidenceTile({ section, input, level }: EvidenceProps) {
  const ctx = renderContext(input, section, level);
  const entries = evidenceOf(section, input);
  const type = evidenceType(section, input);
  const anchor = (entry: Evidence) => recordAnchor(section, entry, input);
  const head = <TileHead title={section.title} subtitle={section.subtitle} level={level} />;
  if (entries.every((entry) => entry.type === 'metric')) {
    return (
      <>
        {head}
        <dl className="sb-tally">
          {entries.map((entry) => (
            <TallyRow key={entry.id} entry={entry} ctx={ctx} anchor={anchor(entry)} />
          ))}
        </dl>
      </>
    );
  }
  if (entries.every((entry) => entry.type === 'testimonial')) {
    return (
      <>
        {head}
        <div className="sb-quotes" data-count={entries.length}>
          {entries.map((entry) => (
            <Testimonial key={entry.id} entry={entry} ctx={ctx} anchor={anchor(entry)} />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <ul className={`sb-ev sb-ev--${type ?? 'entry'}`} role="list">
        {entries.map((entry) => {
          // A metric or a testimonial among other evidence is a plain entry, its words kept.
          const Item = itemOf(entry);
          return <Item key={entry.id} entry={entry} ctx={ctx} anchor={anchor(entry)} />;
        })}
      </ul>
    </>
  );
}
