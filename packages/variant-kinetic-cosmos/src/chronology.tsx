import { laneCount, threadLanes } from '@portfolio/kit/timeline';
import {
  ChronologyItem,
  chronologyOf,
  recordAnchor,
  renderContext,
  SectionHeader,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';

// The branching chronology (#14): one ordered list, in the section's order
// or newest first, so the page's order, the reading order, and Tab's are
// one. Each entry's lane is its authored thread's, from the kit's
// threadLanes(), never a guess from its words. On a large screen the
// stylesheet sets each lane its own column of the list, draws the lanes'
// rails, and marks where an entry forks from or merges into another lane;
// on a small one the lanes fold into one vertical list, with nothing
// positioned off its axis and nothing clipped.

/** The most lanes the stylesheet draws, the trunk included. */
const MAX_LANES = 4;

export function BranchingChronology({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  const lanes = threadLanes(chronologyOf(section, input), { maxLanes: MAX_LANES });
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ol className="kc-chronology" role="list" data-lanes={laneCount(lanes)}>
        {lanes.map((lane) => (
          <ChronologyItem
            key={lane.entry.id}
            entry={lane.entry}
            ctx={ctx}
            anchor={recordAnchor(section, lane.entry, input)}
            lane={lane}
          />
        ))}
      </ol>
    </>
  );
}
