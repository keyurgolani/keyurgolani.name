import type { CSSProperties } from 'react';
import type { ChronologyEntry } from '@portfolio/schema';
import { anchorSection, chronologyOf, PeriodText, renderContext } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ownId, uiLang, Words } from './parts';
import { chapterSpan, homeScenes, isReservedAnchor, type PlacedScene } from './scenes';

// The Origins timeline (redesign): a figure of every dated chronology
// entry as a bar on its thread, across the years they span, with a line
// for now when something is ongoing. Each bar is a link to its entry's
// own place in the film, named with its title and its period, and the
// caption says in words what the figure shows, so nothing lives only in
// the drawing. The plot spans the years its chapter's card names (HOR-3):
// an entry that runs on past them is drawn to the plot's edge, open there,
// its own period in full; one that starts later stands apart past the
// plot's end, on its thread, so the figure never hides an entry.

type TimelineScene = Extract<PlacedScene, { kind: 'timeline' }>;

/** A raw date as a year with its month as a fraction, `2016.25` from `2016-04`. */
function pointOf(raw: string | undefined): number | undefined {
  const match = raw === undefined ? null : /^(\d{4})(?:-(\d{2}))?/.exec(String(raw));
  if (!match) return undefined;
  return Number(match[1]) + (match[2] ? (Number(match[2]) - 1) / 12 : 0);
}

/** What a thread is called when the entry doesn't name one, from its kind. */
const KIND_THREADS: Readonly<Record<string, string>> = {
  role: 'Work',
  project: 'Projects',
  study: 'Study',
};

/** A thread's name in words: `creative` reads Creative. */
const threadName = (entry: ChronologyEntry) =>
  entry.thread
    ? entry.thread.charAt(0).toUpperCase() + entry.thread.slice(1).replaceAll('-', ' ')
    : (KIND_THREADS[entry.kind] ?? 'Other');

/** The share of the plot a label needs beside a bar too short to hold it. */
const LABEL_SHARE = 0.14;

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A count in words up to nine, then in figures, with its noun: `two threads`, `Four entries`. */
function counted(count: number, one: string, many: string, leading = false): string {
  const word = SMALL[count] ?? String(count);
  const said = leading ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  return `${said} ${count === 1 ? one : many}`;
}

interface Bar {
  readonly entry: ChronologyEntry;
  readonly from: number;
  readonly to: number;
  readonly open: boolean;
  /** Whether it runs on past the plot's end, where its chapter's years stop. */
  readonly runsOn: boolean;
  /** Whether it starts after the plot's end, so it stands apart past it, not on the axis. */
  readonly later: boolean;
  /** Its row within the thread, so bars that overlap in time don't overlap on the page. */
  row: number;
}

export function Timeline({ scene, input }: { scene: TimelineScene; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const prefix = input.ids.prefix;
  const ctx = renderContext(input, { id: 'timeline', title: 'Timeline' }, 3);
  const now = pointOf(input.env.now.slice(0, 7)) ?? new Date(input.env.now).getUTCFullYear();
  const seen = new Set<string>();
  const bars: Bar[] = [];
  for (const section of scene.sections) {
    for (const entry of chronologyOf(section, input)) {
      if (seen.has(entry.id) || !entry.period) continue;
      seen.add(entry.id);
      const from = pointOf(entry.period.start);
      if (from === undefined) continue;
      const end = pointOf(entry.period.end);
      bars.push({
        entry,
        from,
        to: Math.max(from + 1 / 12, end ?? now),
        open: end === undefined,
        runsOn: false,
        later: false,
        row: 0,
      });
    }
  }
  if (bars.length === 0) return null;
  const first = Math.floor(Math.min(...bars.map((bar) => bar.from)));
  // The chapter's own years, as its card prints them: a closed span ends the plot at its last year's end.
  const years = chapterSpan(homeScenes(input).scenes, scene.chapter, input);
  const cropped = years !== undefined && !years.open && years.last + 1 > first;
  const last = cropped ? years.last + 1 : Math.ceil(Math.max(...bars.map((bar) => bar.to), now));
  const shown = bars
    .filter((bar) => bar.from < last)
    .map((bar) => (bar.to > last ? { ...bar, to: last, runsOn: true } : bar));
  const later = bars.filter((bar) => bar.from >= last).map((bar) => ({ ...bar, later: true }));
  const span = Math.max(1, last - first);
  /** Where a year falls along the plot, from 0 at its start to 1 at its end. */
  const at = (year: number) => (year - first) / span;
  /** The years a label beside a bar takes. */
  const room = LABEL_SHARE * span;
  /** Whether a bar is too short to hold its label, so it sets it beside it: one rule, here, for every width. */
  const short = (bar: Bar) => !bar.later && bar.to - bar.from < room;
  /** Whether a short bar near the plot's end sets its label before it, so it never crosses the end. */
  const flips = (bar: Bar) => short(bar) && bar.from + room > last;
  /**
   * The stretch of the plot a bar holds in its row: its years, or for a
   * short bar the room its label takes beside it, after it or, near the
   * end, before it, so a label set outside a bar never lands on another.
   */
  const held = (bar: Bar): readonly [number, number] =>
    flips(bar)
      ? [Math.min(bar.from, bar.to - room), bar.to]
      : [bar.from, Math.max(bar.to, bar.from + room)];
  // Threads in the order they first appear, each with its bars stacked where they overlap,
  // and the later entries stacked on their own past the plot's end.
  const threads = new Map<string, Bar[]>();
  for (const bar of [...shown, ...later].sort((a, b) => a.from - b.from)) {
    const name = threadName(bar.entry);
    const lane = threads.get(name) ?? [];
    let row = 0;
    while (
      lane.some(
        (other) =>
          other.row === row &&
          other.later === bar.later &&
          (bar.later || (held(other)[0] < held(bar)[1] && held(bar)[0] < held(other)[1])),
      )
    )
      row++;
    bar.row = row;
    lane.push(bar);
    threads.set(name, lane);
  }
  const step = span > 10 ? 2 : 1;
  const ticks: number[] = [];
  // A cropped plot's end is the start of the year after its chapter: no tick there names a year it doesn't show.
  for (let year = first; cropped ? year < last : year <= last; year += step) ticks.push(year);
  const ongoing = !cropped && shown.some((bar) => bar.open);
  const captionId = ownId(prefix, 'timeline-caption');
  const until = cropped ? last - 1 : ongoing ? 'now' : last;
  const running = shown.filter((bar) => bar.runsOn).length;
  const word = (count: number) => SMALL[count] ?? String(count);
  const all = `${counted(bars.length, 'entry', 'entries', true)} on ${counted(threads.size, 'thread', 'threads')}`;
  const summary =
    later.length > 0
      ? `${all}: ${word(shown.length)} from ${first} to ${until}${running > 0 ? ` (${running === 1 ? 'one of them' : `${word(running)} of them`} running on past it)` : ''} and ${word(later.length)} that start after ${until}.`
      : `${all}, from ${first} to ${until}${running > 0 ? `; ${counted(running, 'runs', 'run')} on past ${until}` : ''}.`;
  return (
    <figure
      className="hc-timeline-figure"
      aria-labelledby={captionId}
      data-later={later.length > 0 ? '' : undefined}
    >
      <h3 className="hc-visually-hidden">
        <Words lang={lang}>Timeline</Words>
      </h3>
      <div className="hc-timeline-figure__plot">
        <ol className="hc-timeline-figure__axis" aria-hidden="true" data-type-role="label">
          {ticks.map((year) => (
            <li key={year} style={{ '--layout-at': at(year) } as CSSProperties}>
              {year}
            </li>
          ))}
        </ol>
        {ongoing ? (
          <span
            className="hc-timeline-figure__now"
            aria-hidden="true"
            data-type-role="label"
            style={{ '--layout-at': at(now) } as CSSProperties}
          >
            <Words lang={lang}>Now</Words>
          </span>
        ) : null}
        {later.length > 0 ? (
          <span className="hc-timeline-figure__later" aria-hidden="true" data-type-role="label">
            <Words lang={lang}>{`After ${until}`}</Words>
          </span>
        ) : null}
        <ul className="hc-timeline-figure__threads" role="list">
          {[...threads].map(([name, lane]) => (
            <li key={name}>
              <span className="hc-timeline-figure__thread" data-type-role="label">
                {/* A thread named from its kind is the composition's word; an authored one is the owner's. */}
                {lane.every((bar) => !bar.entry.thread) ? <Words lang={lang}>{name}</Words> : name}
              </span>
              <ul className="hc-timeline-figure__bars" role="list">
                {lane.map((bar) => {
                  const label = (
                    <span className="hc-timeline-figure__label">
                      <span className="hc-timeline-figure__title">{bar.entry.title}</span>
                      <span className="hc-visually-hidden">{', '}</span>
                      <span className="hc-timeline-figure__years">
                        <PeriodText period={bar.entry.period} ctx={ctx} />
                      </span>
                    </span>
                  );
                  return (
                    <li
                      key={bar.entry.id}
                      data-open={bar.open ? '' : undefined}
                      data-runs-on={bar.runsOn ? '' : undefined}
                      data-later={bar.later ? '' : undefined}
                      data-short={short(bar) ? '' : undefined}
                      data-label-before={flips(bar) ? '' : undefined}
                      style={
                        (bar.later
                          ? { '--layout-row': bar.row + 1 }
                          : {
                              '--layout-from': at(bar.from),
                              '--layout-size': at(bar.to) - at(bar.from),
                              '--layout-row': bar.row + 1,
                              // The label's room beside the bar, in the bar's own widths.
                              '--layout-room': Math.max(
                                1,
                                (room - (bar.to - bar.from)) / Math.max(bar.to - bar.from, 1 / 12),
                              ),
                            }) as unknown as CSSProperties
                      }
                    >
                      {anchorSection(bar.entry, input) !== undefined &&
                      !isReservedAnchor(bar.entry.id) ? (
                        <a href={`#${prefix}${bar.entry.id}`} data-type-role="caption">
                          {label}
                        </a>
                      ) : (
                        <span data-type-role="caption">{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <figcaption
        id={captionId}
        className="hc-timeline-figure__caption"
        data-type-role="body-compact"
      >
        <Words lang={lang}>{summary}</Words>
      </figcaption>
    </figure>
  );
}
