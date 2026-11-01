import type { CSSProperties } from 'react';
import type { ChronologyEntry } from '@portfolio/schema';
import { laneCount, threadLanes, type ThreadLane } from '@portfolio/kit/timeline';
import {
  anchorSection,
  chronologyOf,
  formatNames,
  DateText,
  Heading,
  MaybeLink,
  MediaFigure,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  Ui,
  worksByIds,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { FoldOnPhone } from '../fold';
import { Phrase, RuledList, placedPhoto } from '../parts';

// The chronology in Kinetic Cosmos (redesign, stream E): one ordered list,
// newest first under a playhead at today, beside its threads drawn as
// lanes, like a version history. Each entry's lane is its authored thread's,
// from the kit's threadLanes(), never a guess; a lane's rail runs from its
// first entry to its last, its node sits on the entry's row, filled while
// the entry runs to the present, and an entry that branches from another
// lane bends out of it. The lanes are decoration over the list: every fact
// they draw is in the entry's own words beside them. On a narrow screen the
// rails close up beside the same list, with nothing clipped. Under the
// playhead the current entry on each running thread shows, and a long
// history's finished entries fold away, one tap or link from view.

/** The most lanes it draws, the trunk included. */
const MAX_LANES = 4;

/** A history this short shows whole, with nothing to fold (design review P2, M3). */
const WHOLE = 2;

/** Whether an entry runs to the present. */
const running = (entry: ChronologyEntry) =>
  entry.period.end === undefined || /^present$/i.test(entry.period.end);

/**
 * The entries in view under the playhead, and the earlier ones that fold
 * away (the home outline, item 8; KIN-5): the current entry on each thread
 * still running, newest first, so a later side project never hides the
 * current role; the newest alone when nothing runs. Only finished entries,
 * and a thread's older running ones, fold. A short history shows whole.
 */
export function atPlayhead<T extends { readonly entry: ChronologyEntry; readonly lane: number }>(
  rows: readonly T[],
): { shown: T[]; earlier: T[] } {
  if (rows.length <= WHOLE) return { shown: [...rows], earlier: [] };
  const lanes = new Set<number>();
  const shown = rows.filter(({ entry, lane }) => {
    if (!running(entry) || lanes.has(lane)) return false;
    lanes.add(lane);
    return true;
  });
  if (shown.length === 0) shown.push(rows[0]!);
  return { shown, earlier: rows.filter((row) => !shown.includes(row)) };
}

/** Newest first, by when each began; the section's order breaks a tie. */
function newestFirst(entries: readonly ChronologyEntry[]): ChronologyEntry[] {
  const key = (entry: ChronologyEntry) => (entry.period.start ?? '').padEnd(10, '0');
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      key(a.entry) < key(b.entry) ? 1 : key(a.entry) > key(b.entry) ? -1 : a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/** The threads in lane order, each with its lane, for the legend. */
function threadsOf(
  lanes: readonly ThreadLane<ChronologyEntry>[],
): { lane: number; thread: string }[] {
  const seen = new Map<number, string>();
  for (const { lane, entry } of lanes) {
    if (!seen.has(lane) && present(entry.thread)) seen.set(lane, entry.thread);
  }
  return [...seen].sort((a, b) => a[0] - b[0]).map(([lane, thread]) => ({ lane, thread }));
}

/** The works an entry produced: each a link to its place on the page, else its title alone. */
function Produced({ entry, ctx }: { entry: ChronologyEntry; ctx: RenderContext }) {
  const works = worksByIds(entry.works, ctx.input);
  if (works.length === 0) return null;
  return (
    <div className="kc-entry__aside-group">
      <p className="kc-entry__aside-label" data-type-role="label">
        <Ui ctx={ctx}>Produced</Ui>
      </p>
      <ul className="kc-entry__produced" role="list">
        {works.map((work) => (
          <li key={work.id}>
            <MaybeLink url={anchorSection(work, ctx.input) ? `#${work.id}` : undefined} ctx={ctx}>
              {work.title}
            </MaybeLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The rails beside one entry: every lane alive across its row, its own node, and its fork. */
function Rails({
  lane,
  lanes,
  alive,
  open,
}: {
  lane: ThreadLane<ChronologyEntry>;
  lanes: number;
  alive: readonly boolean[];
  open: boolean;
}) {
  return (
    <span
      className="kc-rails"
      aria-hidden="true"
      style={{ '--layout-lanes': lanes } as CSSProperties}
    >
      {alive.map((on, index) =>
        on ? (
          <span
            key={index}
            className="kc-rails__rail"
            data-lane={index}
            style={{ '--layout-lane': index } as CSSProperties}
          />
        ) : null,
      )}
      {lane.branchesFromLane !== undefined ? (
        <span
          className="kc-rails__fork"
          data-lane={lane.lane}
          data-from={lane.branchesFromLane}
          style={
            {
              '--layout-lane': Math.min(lane.lane, lane.branchesFromLane),
              '--layout-span': Math.abs(lane.lane - lane.branchesFromLane),
            } as CSSProperties
          }
          data-direction={lane.lane > lane.branchesFromLane ? 'out' : 'in'}
        />
      ) : null}
      <span
        className="kc-rails__node"
        data-lane={lane.lane}
        data-open={open ? '' : undefined}
        style={{ '--layout-lane': lane.lane } as CSSProperties}
      />
    </span>
  );
}

function Entry({
  lane,
  ctx,
  anchor,
  lanes,
  alive,
}: {
  lane: ThreadLane<ChronologyEntry>;
  ctx: RenderContext;
  anchor?: string;
  lanes: number;
  alive: readonly boolean[];
}) {
  const { entry } = lane;
  const logo = placedPhoto(entry.logo, ctx);
  const open = entry.period.end === undefined || /^present$/i.test(entry.period.end);
  const highlights = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
  return (
    <li
      id={anchor}
      className="kc-entry"
      data-chronology-kind={entry.kind}
      data-thread={entry.thread}
      data-lane={lane.lane}
      data-branches-from={entry.branchesFrom}
      data-merges-into={entry.mergesInto}
      lang={entry.lang}
    >
      <Rails lane={lane} lanes={lanes} alive={alive} open={open} />
      <div className="kc-entry__when">
        <p className="kc-entry__period">
          <PeriodText period={entry.period} ctx={ctx} />
        </p>
        <Phrase className="kc-entry__thread" role="label" parts={[entry.thread, entry.field]} />
      </div>
      <div className="kc-entry__main">
        <Heading level={ctx.itemLevel} className="kc-entry__title">
          {entry.title}
        </Heading>
        <Phrase
          className="kc-entry__where"
          parts={[
            present(entry.organization) && (
              <MaybeLink key="organization" url={entry.organizationUrl} ctx={ctx}>
                {entry.organization}
              </MaybeLink>
            ),
            entry.location,
          ]}
        />
        {present(entry.description) ? (
          <RichText source={entry.description} className="kc-prose" input={ctx.input} />
        ) : null}
        {/* On a phone the highlights fold under a disclosure, so a long record stays a few screens (KC-S6). */}
        {highlights.length > 0 ? (
          <FoldOnPhone
            className="kc-fold--inline"
            summary={<Ui ctx={ctx}>{`${highlights.length} highlights`}</Ui>}
          >
            <RuledList items={highlights} />
          </FoldOnPhone>
        ) : null}
      </div>
      <div className="kc-entry__aside">
        {logo ? (
          <MediaFigure placed={logo} ctx={ctx} className="kc-logo" sizes="3rem" inline />
        ) : null}
        <Produced entry={entry} ctx={ctx} />
        {entry.skills?.length ? (
          <div className="kc-entry__aside-group">
            <p className="kc-entry__aside-label" data-type-role="label">
              <Ui ctx={ctx}>Practice</Ui>
            </p>
            <p className="kc-entry__skills">{formatNames(entry.skills, ctx)}</p>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function ChronologyBodies({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  // Lanes from the owner's order, so the first thread is the trunk; then shown newest first.
  const authored = chronologyOf(section, input);
  const order = new Map(newestFirst(authored).map((entry, row) => [entry.id, row]));
  // The entries in view first, then the earlier ones, so the rails run down the rows as they show.
  const { shown: inView, earlier } = atPlayhead(
    [...threadLanes(authored, { maxLanes: MAX_LANES })].sort(
      (a, b) => order.get(a.entry.id)! - order.get(b.entry.id)!,
    ),
  );
  const lanes = [...inView, ...earlier];
  const shown = inView.length;
  const count = laneCount(lanes);
  // Each lane is alive from its first entry's row to its last's.
  const span = Array.from({ length: count }, (_, lane) => {
    const rows = lanes.flatMap((each, row) => (each.lane === lane ? [row] : []));
    return { first: Math.min(...rows), last: Math.max(...rows) };
  });
  const threads = threadsOf(lanes);
  const entryAt = (lane: ThreadLane<ChronologyEntry>, row: number) => (
    <Entry
      key={lane.entry.id}
      lane={lane}
      ctx={ctx}
      anchor={recordAnchor(section, lane.entry, input)}
      lanes={count}
      alive={span.map(({ first, last }) => row >= first && row <= last)}
    />
  );
  return (
    <div className="kc-chronology" data-lanes={count}>
      {threads.length > 1 ? (
        <ul className="kc-legend" role="list" data-type-role="label">
          {threads.map(({ lane, thread }) => (
            <li key={lane} data-lane={lane}>
              {thread}
            </li>
          ))}
        </ul>
      ) : null}
      {/* The playhead: today, where the newest entries begin. */}
      <p className="kc-playhead" data-type-role="label">
        <span>
          <Ui ctx={ctx}>Now</Ui>, <DateText raw={input.env.now.slice(0, 7)} ctx={ctx} />
        </span>
      </p>
      <ol className="kc-entries" role="list">
        {lanes.slice(0, shown).map(entryAt)}
      </ol>
      {/* The earlier entries, one tap away; a link that names one opens them. */}
      {shown < lanes.length ? (
        <FoldOnPhone
          className="kc-fold--inline kc-fold--earlier"
          closed
          summary={
            <Ui ctx={ctx}>
              {lanes.length - shown === 1
                ? '1 earlier entry'
                : `${lanes.length - shown} earlier entries`}
            </Ui>
          }
        >
          <ol className="kc-entries" role="list" start={shown + 1}>
            {lanes.slice(shown).map((lane, index) => entryAt(lane, shown + index))}
          </ol>
        </FoldOnPhone>
      ) : null}
    </div>
  );
}
