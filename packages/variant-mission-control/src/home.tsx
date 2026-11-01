import {
  renderSection,
  RichText,
  type HomePageProps,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import type { Section } from '@portfolio/schema';
import { Enhancement } from '@portfolio/kit/enhancements';
import { BoardHead, Colophon, Rail, StatusLine } from './chrome';
import {
  chromeIds,
  folds,
  homeModel,
  pack,
  spanOf,
  type Board,
  type HomeModel,
  type Lamp,
  type Span,
} from './model';
import { Anchor, Latest, Readouts } from './overview';
import { renderersFor } from './renderers';
import { githubCount, headId, panelFrame, titleOf } from './wall/panel';

// Mission Control's home page, in the same order in the source, on screen,
// in print and with no JavaScript: the board rail, the status line, then
// the main wall: the Overview (the anchor panel, the square readouts,
// Latest, and its tail), then each board in the fixed order, its header
// band first and its panels packed first-fit on the 16 columns, then the
// colophon. It renders on the server from the render input alone: no
// fetch, no clock. Colour, type, materials and timing are #19's tokens; the
// rail, the status line, the measured wall, the panel and the lamps are
// its own.

/** The anchor's parts: the thesis's and the hero's own frames, inside the anchor panel. */
function anchorPart(props: SectionFrameProps) {
  const title = titleOf(props.section);
  return (
    <section
      {...props.frame}
      className="mc-anchor__part"
      data-part={props.section.kind}
      {...(title !== undefined && headId(props.frame)
        ? { 'aria-labelledby': headId(props.frame) }
        : {})}
    >
      {title !== undefined ? (
        <h2 className="mc-sr">
          <span id={headId(props.frame)}>{title}</span>
        </h2>
      ) : null}
      {props.children}
    </section>
  );
}

/** How many square modules a row of readouts holds, by how many there are. */
export const readoutColumns = (n: number) => (n <= 2 ? n : n === 4 ? 2 : 3);

/**
 * The Overview's first row on the 16 columns: the readouts take 2 columns a square, at least
 * 4 (a single metric's square would otherwise ask for a span the wall doesn't have), Latest
 * what's left past a 6-column anchor, at least 4, and the anchor the rest, so the row sums
 * to 16; with neither, the anchor spans the row.
 */
export function overviewSpans(readoutCount: number, latestShown: number) {
  const readouts = readoutCount > 0 ? Math.max(4, readoutColumns(readoutCount) * 2) : 0;
  const latest = latestShown > 0 ? Math.max(4, 16 - 6 - readouts) : 0;
  const anchor = 16 - readouts - latest;
  return { anchor, readouts, latest };
}

/** The bar lamps a section carries: a now section's as-of reading. */
function lampsFor(model: HomeModel) {
  const now = model.signals.find(({ key }) => key === 'now');
  return (section: Section): readonly Lamp[] =>
    section.kind === 'now' && now
      ? [{ tone: now.lamp === 'positive' ? 'positive' : 'neutral', text: now.text, date: now.date }]
      : [];
}

/** A panel's span when it rides in a stack: the stack's, so its own frame sets none. */
export const STACKED = 0;

/** One placed unit of a wall: a section, or a stack of short ones beside a long lede. */
export type WallUnit =
  | { readonly section: Section; readonly span: Span; readonly stack?: undefined }
  | { readonly section: Section; readonly span: Span; readonly stack: readonly Section[] };

/**
 * A wall's sections as the units it packs (G2): a lede panel at 10 columns takes, as one
 * 6-column stack beside it, up to four of the board's short panels that follow it (6 columns
 * each, or a now panel, open, at most 6 items), in their own order, so a long bio has its
 * partners beside it rather than canvas, and no short panel is left alone across a row. Two at
 * least make a stack. Everything else is its own unit, in reading order.
 */
export function stackUnits(
  sections: readonly Section[],
  of: {
    readonly span: (section: Section) => Span;
    readonly folded: (section: Section) => boolean;
    readonly count: (section: Section) => number;
  },
): WallUnit[] {
  const out: WallUnit[] = [];
  const taken = new Set<string>();
  sections.forEach((section, at) => {
    if (taken.has(section.id)) return;
    const span = of.span(section);
    if (section.kind === 'lede' && span === 10) {
      const partners = sections
        .slice(at + 1)
        .filter(
          (each) =>
            !taken.has(each.id) &&
            !of.folded(each) &&
            (of.span(each) === 6 || each.kind === 'now') &&
            of.count(each) <= 6,
        )
        .slice(0, 4);
      out.push({ section, span });
      if (partners.length >= 2) {
        for (const each of partners) taken.add(each.id);
        out.push({ section: partners[0]!, span: 6, stack: partners });
      }
      return;
    }
    out.push({ section, span });
  });
  return out;
}

export function HomePage({ input, outline }: HomePageProps) {
  const model = homeModel(input, outline);
  const ids = chromeIds(input.ids.prefix);
  const renderers = renderersFor(model);
  const entries = new Map(outline.sections.map((entry) => [entry.id, entry]));
  const spans = new Map<string, number>();
  const folded = (section: Section) => folds(section, input) && titleOf(section) !== undefined;
  const spanFor = (section: Section): Span => {
    const entry = entries.get(section.id);
    // The full record's closed panels are a stack of bars across the wall, at its board's end.
    if (!entry || folded(section)) return 16;
    if (section.kind === 'now') return 10;
    if (section.kind === 'focus') return 6;
    return spanOf(entry, section.id === model.firstWorks);
  };
  const units = (sections: readonly Section[]) =>
    stackUnits(sections, {
      span: spanFor,
      folded,
      count: (section) => entries.get(section.id)?.count ?? 0,
    });
  const placedOf = (sections: readonly Section[]) => {
    const placed = pack(units(sections).map((unit) => ({ item: unit, span: unit.span })));
    for (const { item, span } of placed) {
      if (item.stack) for (const section of item.stack) spans.set(section.id, STACKED);
      else spans.set(item.section.id, span);
    }
    return placed;
  };
  const Frame = panelFrame({
    spanOf: (section) => spans.get(section.id) ?? 16,
    entryOf: (section) => entries.get(section.id),
    lampsOf: lampsFor(model),
    standfirstOf: (section) =>
      model.tagline?.section === section.id ? (
        <p className="mc-panel__standfirst">
          <RichText source={model.tagline.text} inline input={input} />
        </p>
      ) : undefined,
    foldsOf: folded,
    countFor: (section) => githubCount(section, input),
    uiLang: model.uiLang,
  });
  const composition = { renderers, Frame };
  const panels = (sections: readonly Section[], level: 2 | 3) =>
    placedOf(sections).map(({ item, span }) =>
      item.stack ? (
        <div key={item.stack.map(({ id }) => id).join(' ')} className="mc-stack" data-span={span}>
          {item.stack.map((section) => renderSection(section, input, composition, { level }))}
        </div>
      ) : (
        renderSection(item.section, input, composition, { level })
      ),
    );

  const overview = model.boards.find(({ id }) => id === 'overview');
  const rest = model.boards.filter(({ id }) => id !== 'overview');
  const part = { renderers, Frame: anchorPart };
  const thesis = model.thesis ? renderSection(model.thesis, input, part, { level: 2 }) : null;
  const hero = model.hero ? renderSection(model.hero, input, part, { level: 2 }) : null;
  const tail = (overview?.sections ?? []).filter(
    (section) => section.id !== model.hero?.id && section.id !== model.thesis?.id,
  );
  const { anchor, readouts, latest } = overviewSpans(
    model.readouts?.readouts.length ?? 0,
    model.latestShown,
  );

  return (
    <div className="mc-root">
      <Rail input={input} model={model} />
      <StatusLine input={input} model={model} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="mc-main" tabIndex={-1}>
        <section
          className="mc-board mc-board--overview"
          id={ids.board('overview')}
          aria-labelledby={ids.name}
        >
          <div className="mc-wall">
            <Anchor input={input} model={model} parts={{ thesis, hero }} span={anchor} />
            <Readouts input={input} model={model} span={readouts} />
            <Latest input={input} model={model} span={latest} />
            {panels(tail, 2)}
          </div>
        </section>
        {rest.map((board: Board) => (
          <section
            key={board.id}
            className="mc-board"
            id={ids.board(board.id)}
            data-board={board.id}
            aria-labelledby={ids.boardTitle(board.id)}
          >
            <BoardHead board={board} input={input} model={model} />
            <div className="mc-wall">{panels(board.sections, 3)}</div>
          </section>
        ))}
      </main>
      <Colophon input={input} model={model} />
      {model.relations.names.size > 0 ? <Enhancement input={input} id="correlate" /> : null}
      {model.boards.some((board) => board.sections.some(folded)) ? (
        <Enhancement input={input} id="record" />
      ) : null}
    </div>
  );
}
