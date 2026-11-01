import type { ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  asSentence,
  citesWhole,
  DateText,
  evidenceOf,
  formatFigure,
  formatNames,
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
import { figureKey, isFigureTable } from '../figures';
import { Caption, joined, Row, Rows, Words } from '../parts';
import type { Env } from '../env';

// Evidence: what others record of the work. A run of figures is a numbered
// figure table, statement and value on one ruled line with a dashed leader,
// never the hero-metric tiles. A run of testimonials is quotations, the
// first set large across the text column and the rest paired beside it.
// Anything else (papers, talks, awards, patents, press, work elsewhere) is
// a ruled row: the title, a leader, and its date, the venue under it, and
// its abstract or excerpt in the margin, beside it.

type EvidenceProps = SectionRendererProps<SectionOf<'evidence'>> & { readonly env: Env };

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

/** The date that says when a record was true: published, presented, received, granted, or filed. */
function EntryDate({ entry, ctx }: { entry: Evidence; ctx: RenderContext }): ReactNode {
  const raw =
    entry.publishedAt ?? entry.presentedAt ?? entry.receivedAt ?? entry.grantedAt ?? entry.filedAt;
  if (raw !== undefined) return <DateText raw={raw} ctx={ctx} />;
  if (entry.asOf !== undefined) return <LabeledDate label="As of" raw={entry.asOf} ctx={ctx} />;
  return null;
}

const hasDate = (entry: Evidence) =>
  [
    entry.publishedAt,
    entry.presentedAt,
    entry.receivedAt,
    entry.grantedAt,
    entry.filedAt,
    entry.asOf,
  ].some((raw) => raw !== undefined);

/** A DOI as written, without a prefix, and its doi.org link. */
function doiOf(raw: string | undefined): { text: string; url: string } | undefined {
  if (!present(raw)) return undefined;
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** The record's links: its own address's action, PDF, slides, video, and links, in a line. */
function EntryLinks({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { input } = ctx;
  const action = [entry.buttonText, entry.urlLabel].find(present);
  const links = [
    action !== undefined && entry.url !== undefined ? { url: entry.url, text: action } : null,
    entry.pdfUrl ? { url: entry.pdfUrl, text: 'PDF' } : null,
    entry.slidesUrl ? { url: entry.slidesUrl, text: 'Slides' } : null,
    entry.videoUrl ? { url: entry.videoUrl, text: 'Video' } : null,
    ...(entry.links ?? []).map((link) => ({
      url: link.url,
      text: [link.label, link.platform].find(present) ?? link.url,
    })),
  ].filter((link): link is { url: string; text: string } => link !== null);
  if (links.length === 0) return null;
  return (
    <ul className="ee-links" role="list">
      {links.map((link, index) => (
        <li key={index}>
          <a href={hrefFor(link.url, input)}>
            {['PDF', 'Slides', 'Video'].includes(link.text) ? (
              <Words input={input}>{link.text}</Words>
            ) : (
              link.text
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who and where: authors, inventors, format, source, venue, publication,
 * status. A citation written whole stands for the authors and venue, so the
 * line names them once (A4); the row keeps its date as the ruled line's
 * anchor, as layout. A location of "online" isn't shown.
 */
function entryFacts(entry: Evidence, ctx: RenderContext): ReactNode[] {
  const { input } = ctx;
  const whole = citesWhole(entry);
  return [
    entry.authors?.length && !whole ? formatNames(entry.authors, ctx) : null,
    entry.inventors?.length ? formatNames(entry.inventors, ctx) : null,
    entry.format !== undefined && TALK_FORMATS[entry.format] ? (
      <Words input={input}>{TALK_FORMATS[entry.format]!}</Words>
    ) : null,
    entry.source && present(entry.title) ? (
      <MaybeLink url={entry.source.url} ctx={ctx}>
        {entry.source.name}
      </MaybeLink>
    ) : null,
    whole ? null : entry.venue,
    entry.publication ? <i>{entry.publication}</i> : null,
    entry.author,
    entry.organization,
    entry.assignee,
    shownPlace(entry.location) ?? shownPlace(entry.locationLabel),
    entry.number,
    entry.status !== undefined && PATENT_STATUSES[entry.status] ? (
      <Words input={input}>{PATENT_STATUSES[entry.status]!}</Words>
    ) : null,
    whole ? entry.citation : null,
  ].filter((part) => part !== null && part !== undefined && part !== '');
}

/**
 * The facts as one sentence: the last, when it's the owner's text, closed by
 * asSentence(), so "Acme Inc." or a "?" gets no second mark (A4); else a
 * period after it.
 */
function factsSentence(facts: readonly ReactNode[]): ReactNode {
  const last = facts.at(-1);
  if (typeof last === 'string') return joined([...facts.slice(0, -1), asSentence(last)]);
  return <>{joined(facts)}.</>;
}

/** A label's first letter in lower case to run on in a sentence, unless it starts an acronym. */
function lowerInitial(text: string, locale: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase(locale) + text.slice(1) : text;
}

/** One record as a row. */
function EntryRow({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  const { input } = ctx;
  const title = present(entry.title) ? entry.title : (entry.source?.name ?? '');
  const doi = doiOf(entry.doi);
  const facts = entryFacts(entry, ctx);
  const metric = entry.metric?.value;
  const note = [
    present(entry.abstract) ? <RichText key="a" source={entry.abstract} input={input} /> : null,
    present(entry.excerpt) ? (
      <blockquote key="e" className="ee-row__quote">
        <RichText source={entry.excerpt} input={input} />
      </blockquote>
    ) : null,
    present(entry.statement) && entry.type !== 'testimonial' ? (
      <RichText key="s" source={entry.statement} input={input} />
    ) : null,
    present(entry.description) ? (
      <RichText key="d" source={entry.description} input={input} />
    ) : null,
    // Its highlights as one sentence, the figure folded into its label (C6): never a stat stack.
    entry.highlights?.length ? (
      <p key="h">
        {formatNames(
          entry.highlights.map(({ label, sub }) =>
            present(sub)
              ? `${label} ${lowerInitial(sub, entry.lang ?? input.portfolio.locale)}`
              : label,
          ),
          ctx,
        )}
        .
      </p>
    ) : null,
    doi ? (
      <p key="doi">
        DOI <a href={doi.url}>{doi.text}</a>
      </p>
    ) : null,
  ].filter(Boolean);
  return (
    <Row
      id={anchor}
      lang={entry.lang}
      level={ctx.itemLevel}
      title={
        <MaybeLink url={entry.url} ctx={ctx}>
          {title}
        </MaybeLink>
      }
      end={
        metric !== undefined ? (
          <data value={metric}>
            {formatFigure(metric, ctx)}
            {present(entry.metric?.unit) ? ` ${entry.metric.unit}` : null}
          </data>
        ) : hasDate(entry) ? (
          <EntryDate entry={entry} ctx={ctx} />
        ) : undefined
      }
      sub={
        facts.length > 0 || entry.awards?.length || entry.categories?.length ? (
          <>
            {facts.length > 0 ? <span>{factsSentence(facts)} </span> : null}
            {entry.awards?.length ? (
              <b className="ee-badge">{asSentence(formatNames(entry.awards, ctx))}</b>
            ) : null}
            {entry.categories?.length ? (
              <span> {asSentence(formatNames(entry.categories, ctx))}</span>
            ) : null}
            <EntryLinks entry={entry} ctx={ctx} />
          </>
        ) : (
          <EntryLinks entry={entry} ctx={ctx} />
        )
      }
      note={note.length > 0 ? note : undefined}
      attributes={{ 'data-evidence-type': entry.type }}
    >
      {entry.type === 'testimonial' && present(entry.statement) ? (
        <blockquote className="ee-row__quote">
          <RichText source={entry.statement} input={input} />
        </blockquote>
      ) : null}
    </Row>
  );
}

/** A run of figures as one numbered figure table, each figure on its ruled line. */
function FigureTable({
  entries,
  ctx,
  number,
  anchorOf,
}: {
  entries: readonly Evidence[];
  ctx: RenderContext;
  number: number | undefined;
  anchorOf: (entry: Evidence) => string | undefined;
}) {
  const { input } = ctx;
  const dates = entries.flatMap((entry) => (entry.asOf !== undefined ? [entry.asOf] : []));
  return (
    <figure className="ee-figtable">
      <dl className="ee-figtable__rows">
        {entries.map((entry) => (
          <div key={entry.id} id={anchorOf(entry)} className="ee-figrow" lang={entry.lang}>
            <dt>
              <FigLabel entry={entry} input={input} />
              {present(entry.description) ? (
                <small data-type-role="body-compact">{entry.description}</small>
              ) : null}
              {entry.source ? (
                <small data-type-role="body-compact">
                  <MaybeLink url={entry.source.url} ctx={ctx}>
                    {entry.source.name}
                  </MaybeLink>
                </small>
              ) : null}
            </dt>
            <dd>
              <span className="ee-figrow__leader" aria-hidden="true" />
              <data
                value={entry.metric!.value!}
                className="ee-figrow__value"
                data-type-role="headline"
              >
                {formatFigure(entry.metric!.value!, ctx)}
              </data>
              {present(entry.metric?.unit) ? (
                <span className="ee-figrow__unit" data-type-role="body-compact">
                  {entry.metric.unit}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <figcaption>
        <Caption
          index={number !== undefined ? <Words input={input}>{`Fig. ${number}`}</Words> : undefined}
        >
          {dates.length > 0 ? (
            <p>
              <LabeledDate label="As of" raw={[...dates].sort().at(-1)} ctx={ctx} />
            </p>
          ) : null}
        </Caption>
      </figcaption>
    </figure>
  );
}

/**
 * A figure's label: its statement, or when the statement is a sentence, its
 * first clause as the label and the rest under it, so every row reads as a
 * label beside its figure (round 3: the "12 years" row).
 */
function FigLabel({ entry, input }: { entry: Evidence; input: RenderContext['input'] }) {
  if (!present(entry.statement)) return <>{entry.title ?? entry.metric?.key}</>;
  const text = entry.statement.trim();
  const comma = text.indexOf(', ');
  if (text.length > 48 && comma > 0 && comma <= 32 && !/[*_`[\]]/.test(text)) {
    return (
      <>
        {text.slice(0, comma)}
        <small data-type-role="body-compact">{text.slice(comma + 2)}</small>
      </>
    );
  }
  return <RichText source={text} inline input={input} />;
}

/** A run of testimonials: the first set large, the rest paired. */
function Quotations({
  entries,
  ctx,
  anchorOf,
}: {
  entries: readonly Evidence[];
  ctx: RenderContext;
  anchorOf: (entry: Evidence) => string | undefined;
}) {
  const { input } = ctx;
  return (
    <ul className="ee-quotes" role="list">
      {entries.map((entry, index) => {
        const cite = entry.source?.url !== undefined ? hrefFor(entry.source.url, input) : undefined;
        return (
          <li
            key={entry.id}
            id={anchorOf(entry)}
            lang={entry.lang}
            className={index === 0 ? 'ee-quote ee-quote--lead' : 'ee-quote'}
          >
            <figure>
              <blockquote
                cite={cite}
                className="ee-quote__text"
                data-type-role={index === 0 ? 'headline' : 'quote'}
              >
                {present(entry.statement) ? (
                  <RichText source={entry.statement} input={input} />
                ) : null}
              </blockquote>
              <figcaption className="ee-attrib" data-type-role="body-compact">
                {entry.source ? (
                  <b>
                    <MaybeLink url={entry.source.url} ctx={ctx}>
                      {entry.source.name}
                    </MaybeLink>
                  </b>
                ) : null}
                {[entry.source?.role, entry.source?.organization]
                  .filter(present)
                  .map((part) => `, ${part}`)
                  .join('')}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceBody({ section, input, level, env }: EvidenceProps) {
  const ctx = renderContext(input, section, level);
  const entries = evidenceOf(section, input);
  const anchorOf = (entry: Evidence) => recordAnchor(section, entry, input);
  if (isFigureTable(entries)) {
    return (
      <FigureTable
        entries={entries}
        ctx={ctx}
        number={env.model.figures.get(figureKey(section.id))}
        anchorOf={anchorOf}
      />
    );
  }
  if (entries.every((entry) => entry.type === 'testimonial')) {
    return <Quotations entries={entries} ctx={ctx} anchorOf={anchorOf} />;
  }
  return (
    <Rows>
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} ctx={ctx} anchor={anchorOf(entry)} />
      ))}
    </Rows>
  );
}
