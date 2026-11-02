import {
  PeriodText,
  present,
  renderContext,
  renderSection,
  type SectionComposition,
} from '@portfolio/kit/sections';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { uiLangOf } from './chrome';
import { archiveFrame } from './frames';
import { BOARD_NAMES, boardOf, type Board } from './model';
import { Facts } from './parts';
import { RENDERERS } from './renderers';

// The Record board's own tile (design gate 8): the full record, its head
// the summary of the chronology, the latest role, and under it every board's
// long reference sections, each a closed disclosure that opens in place.
// Home carries the summary; the record is a tap away, and each of its
// sections keeps its frame, its id, and its place in the dock, the Menu and
// Contents. The latest role sits in the tile, not beside it, so the row
// closes (M2): a short tile beside a long one left a hole under it.

/** How the Record board sets its own tile on its field, after its packed tiles. */
export function recordSpans(board: Pick<Board, 'tiles'>) {
  // A board with no packed tiles has its label in its first row, nine columns beside it.
  return { archive: board.tiles.length === 0 ? 9 : 12 };
}

/** The latest role: who for, where, since when, and the way to every role, its section's part (N3). */
export function LatestRole({
  board,
  input,
}: {
  readonly board: Board;
  readonly input: VariantRenderInput;
}) {
  if (!board.latest) return null;
  const { entry, section } = board.latest;
  const ctx = renderContext(input, section, 4);
  const uiLang = uiLangOf(input);
  const id = `${input.ids.prefix}sb--latest-role`;
  return (
    <section className="sb-latest" aria-labelledby={id} lang={section.lang}>
      <h4 className="sb-label" id={id} lang={uiLang}>
        Latest role
      </h4>
      <p className="sb-latest__role">{entry.title}</p>
      <Facts className="sb-latest__where" parts={[entry.organization, entry.location]} />
      <p className="sb-label">
        <PeriodText period={entry.period} ctx={ctx} />
      </p>
      <a className="sb-latest__more" href={`#${input.ids.prefix}${section.id}`} lang={uiLang}>
        Every role
      </a>
    </section>
  );
}

/** A section's name on its disclosure: its title, else its board's. */
const nameOf = (section: Section, input: VariantRenderInput) =>
  present(section.title) ? section.title : BOARD_NAMES[boardOf(section, input)];

/** The full record: one tile, a closed disclosure a section, each opening in place. */
export function FullRecord({
  board,
  input,
  span,
}: {
  readonly board: Board;
  readonly input: VariantRenderInput;
  readonly span: number;
}) {
  const archive = board.archive ?? [];
  if (archive.length === 0 && !board.latest) return null;
  const uiLang = uiLangOf(input);
  const id = `${input.ids.prefix}sb--full-record`;
  return (
    <section className="sb-tile sb-archive" data-span={span} data-span-md={6} aria-labelledby={id}>
      <h3 className="sb-title" id={id} lang={uiLang}>
        The full record
      </h3>
      <LatestRole board={board} input={input} />
      <div className="sb-archive__items">
        {archive.map((section) => {
          const home = boardOf(section, input);
          // Its board is named where it isn't Record's own, so "Publications" says it's Writing's.
          const where = home === 'record' ? '' : BOARD_NAMES[home];
          const composition: SectionComposition = {
            renderers: RENDERERS,
            Frame: archiveFrame(nameOf(section, input), where),
          };
          return renderSection(section, input, composition, { level: 4 });
        })}
      </div>
    </section>
  );
}
