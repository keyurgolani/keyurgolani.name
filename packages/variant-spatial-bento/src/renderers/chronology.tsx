import type { ChronologyEntry } from '@portfolio/schema';
import {
  chronologyOf,
  formatNames,
  Heading,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { allStudies } from '../model';
import { Facts, Out, TileHead } from '../parts';

// The chronology tiles. Roles, projects, and events are a Gantt chart: a
// row an entry on one axis of years, each bar where its period falls and
// colored by its thread, each row a native disclosure that opens onto its
// description and highlights. Studies alone are dated rows, the year large.

type ChronologyProps = SectionRendererProps<SectionOf<'chronology'>>;

/** A loose date as a fractional year: 2023-04 is 2023.25. Present, or none, is `now`. */
function yearsOf(raw: string | undefined, now: number): number {
  const match = raw === undefined ? null : /^(\d{4})(?:-(\d{2}))?/.exec(raw);
  if (!match) return now;
  const month = match[2] === undefined ? 0 : Number(match[2]) - 1;
  return Number(match[1]) + month / 12;
}

/** The render's time as a fractional year. */
function nowOf(iso: string): number {
  const at = new Date(iso);
  return at.getUTCFullYear() + at.getUTCMonth() / 12;
}

/** Where an entry's bar sits on the axis, as percentages of it. */
function barOf(entry: ChronologyEntry, axis: { start: number; end: number }, now: number) {
  const start = yearsOf(entry.period.start, now);
  const end = entry.period.end === undefined ? now : yearsOf(entry.period.end, now);
  const span = axis.end - axis.start;
  const from = ((start - axis.start) / span) * 100;
  const width = (Math.max(end - start, 1 / 12) / span) * 100;
  return { from: from.toFixed(2), width: width.toFixed(2), open: entry.period.end === undefined };
}

/** The axis's years: whole years either side, and a tick every one, two, or more, so there are at most seven. */
function axisOf(entries: readonly ChronologyEntry[], now: number) {
  const starts = entries.map((entry) => yearsOf(entry.period.start, now));
  const ends = entries.map((entry) =>
    entry.period.end === undefined ? now : yearsOf(entry.period.end, now),
  );
  const start = Math.floor(Math.min(...starts));
  const end = Math.ceil(Math.max(...ends, start + 1));
  const step = Math.max(1, Math.ceil((end - start) / 7));
  const ticks: number[] = [];
  for (let year = start; year <= end; year += step) ticks.push(year);
  return { start, end, ticks };
}

/** Who and where: the entry's title and its organization, a link when it has one. */
function Who({ entry, ctx }: { entry: ChronologyEntry; ctx: RenderContext }) {
  return (
    <span className="sb-gantt__who">
      <Heading level={ctx.itemLevel} className="sb-strong">
        {entry.title}
      </Heading>
      <Facts
        className="sb-label"
        parts={[
          present(entry.organization) && present(entry.organizationUrl) ? (
            <Out url={entry.organizationUrl} ctx={ctx}>
              {entry.organization}
            </Out>
          ) : (
            entry.organization
          ),
          entry.location,
        ]}
      />
    </span>
  );
}

/** What a row opens onto: its period, its words, its highlights, and its skills. */
function Detail({ entry, ctx }: { entry: ChronologyEntry; ctx: RenderContext }) {
  const highlights = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
  return (
    <div className="sb-gantt__detail">
      <p className="sb-label">
        <PeriodText period={entry.period} ctx={ctx} />
      </p>
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} className="sb-gantt__words" />
      ) : null}
      {highlights.length > 0 ? (
        <ul className="sb-checks" role="list">
          {highlights.map((highlight, index) => (
            <li key={index}>{highlight}</li>
          ))}
        </ul>
      ) : null}
      {entry.skills?.length ? (
        <p className="sb-label sb-gantt__skills">{formatNames(entry.skills, ctx)}</p>
      ) : null}
    </div>
  );
}

function Gantt({ section, input, level }: ChronologyProps) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  const now = nowOf(input.env.now);
  const axis = axisOf(entries, now);
  const threads = [...new Set(entries.map((entry) => entry.thread ?? entry.kind))];
  const series = (entry: ChronologyEntry) => threads.indexOf(entry.thread ?? entry.kind) + 1;
  const tickAt = (year: number) =>
    (((year - axis.start) / (axis.end - axis.start)) * 100).toFixed(2);
  return (
    <>
      <TileHead
        title={section.title}
        subtitle={section.subtitle}
        level={level}
        aside={
          threads.length > 1 ? (
            <ul className="sb-gantt__legend" role="list">
              {threads.map((thread, index) => (
                <li key={thread} data-series={index + 1}>
                  {thread}
                </li>
              ))}
            </ul>
          ) : undefined
        }
      />
      <div className="sb-gantt">
        <div className="sb-gantt__axis" aria-hidden="true">
          <span />
          <span className="sb-gantt__ticks">
            {axis.ticks.map((year, index) => (
              <span
                key={year}
                // The last year ends at its tick, so it never runs past the plot's edge.
                style={
                  index === axis.ticks.length - 1
                    ? { insetInlineEnd: `${(100 - Number(tickAt(year))).toFixed(2)}%` }
                    : { insetInlineStart: `${tickAt(year)}%` }
                }
              >
                {year}
              </span>
            ))}
          </span>
        </div>
        <ul className="sb-gantt__rows" role="list">
          {entries.map((entry, index) => {
            const bar = barOf(entry, axis, now);
            return (
              <li key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
                <details className="sb-gantt__row" open={index === 0}>
                  <summary>
                    <Who entry={entry} ctx={ctx} />
                    <span className="sb-gantt__track" aria-hidden="true">
                      <span
                        className="sb-gantt__bar"
                        data-series={series(entry)}
                        data-open={bar.open ? '' : undefined}
                        style={{ insetInlineStart: `${bar.from}%`, inlineSize: `${bar.width}%` }}
                      />
                    </span>
                  </summary>
                  <Detail entry={entry} ctx={ctx} />
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** The year a study ended, else began. */
const yearOf = (entry: ChronologyEntry) =>
  /^\d{4}/.exec(entry.period.end ?? entry.period.start)?.[0] ?? '';

function Studies({ section, input, level }: ChronologyProps) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <ul className="sb-ev sb-ev--award" role="list">
        {entries.map((entry) => {
          const notes = [...(entry.achievements ?? []), ...(entry.highlights ?? [])].filter(
            present,
          );
          return (
            <li
              key={entry.id}
              id={recordAnchor(section, entry, input)}
              className="sb-dated"
              lang={entry.lang}
            >
              <p className="sb-dated__year">{yearOf(entry)}</p>
              <div className="sb-dated__body">
                <Heading level={ctx.itemLevel} className="sb-strong">
                  {present(entry.field) ? `${entry.title}, ${entry.field}` : entry.title}
                </Heading>
                <Facts
                  className="sb-label"
                  parts={[
                    entry.organization,
                    <PeriodText key="p" period={entry.period} ctx={ctx} />,
                  ]}
                />
                {present(entry.description) ? (
                  <RichText source={entry.description} input={input} className="sb-quiet" />
                ) : null}
                {notes.length > 0 ? (
                  <ul className="sb-checks" role="list">
                    {notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Chronology(props: ChronologyProps) {
  return allStudies(props.section, props.input) ? <Studies {...props} /> : <Gantt {...props} />;
}
