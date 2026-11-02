import type { ReactNode } from 'react';
import {
  footerOutline,
  Heading,
  present,
  renderSection,
  RichText,
  sectionRenders,
  type HomePageProps,
  type SectionComposition,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { BoardLabel, Contents, FooterTile, Menu, menuId, Reach, uiLangOf } from './chrome';
import { Dock } from './dock';
import { RecordFolds } from './record-folds';
import { ReturnFocus } from './return-focus';
import { Settle } from './settle';
import { GroupFrame, tileFrame, type TileOptions } from './frames';
import {
  boardAnchor,
  boardsOf,
  boardTarget,
  fielded,
  overviewOf,
  splitThesis,
  statementClass,
  type Board,
  type Overview,
} from './model';
import { FullRecord, recordSpans } from './record';
import { RENDERERS } from './renderers';
import { IN_HERO, Now } from './renderers/identity';
import { ShowcaseWorks } from './renderers/works';

// Spatial Bento's home page: the overview, one composed field the height of
// the window, then a board a group of sections, each opened by its label on
// the ground, and the footer tile. The overview's top band is the hero
// plate, the Contents tile, and Now and the ledger; its bottom band is the
// showcase's works and the reach tile, its seams offset from the top's like
// brick bond. Every section is a tile through renderSection(), in a frame
// of the composition's own, so every one carries its anchor.

/** The composition renderSection() and the outline check read. */
export const SECTIONS: SectionComposition = { renderers: RENDERERS, Frame: tileFrame() };

const compose = (options: TileOptions): SectionComposition => ({
  renderers: RENDERERS,
  Frame: tileFrame(options),
});

/** Now's renderer with `lead` under its head, the phone's standfirst (S2). */
const nowLed = (lead: ReactNode) =>
  function NowLed(props: SectionRendererProps<SectionOf<'now'>>) {
    return <Now {...props} lead={lead} />;
  };

/** The hero plate when the portfolio has no hero: the name, and the thesis when there is one. */
function IdentityPlate({
  input,
  overview,
  menu,
}: {
  input: VariantRenderInput;
  overview: Overview;
  menu: ReactNode;
}) {
  const { identity } = input.portfolio;
  // With no statement at all, the name is the plate's display line, not a label over nothing.
  const named = !overview.thesis && !present(identity.tagline);
  return (
    <header className="sb-tile sb-tile--hero sb-tile--well sb-tile--large" data-area="hero">
      {menu}
      <div className="sb-hero__head">
        <Heading
          level={1}
          className={named ? `sb-hero__name ${statementClass(identity.name)}` : 'sb-hero__name'}
        >
          {identity.name}
        </Heading>
        {present(identity.tagline) && overview.thesis ? (
          <p className="sb-hero__role">{identity.tagline}</p>
        ) : null}
      </div>
      <div className="sb-hero__body">
        {overview.thesis ? (
          renderSection(overview.thesis, input, IN_HERO, { level: 2 })
        ) : present(identity.tagline) ? (
          // With no thesis, the tagline is the plate's statement (thesis first).
          <p className={statementClass(identity.tagline)}>{identity.tagline}</p>
        ) : null}
      </div>
    </header>
  );
}

/** Whether a tile's title only repeats its board's name, as an About section on the About board does. */
export function echoes(section: { readonly title?: string }, board: Pick<Board, 'name'>): boolean {
  const words = (text: string) => text.trim().toLocaleLowerCase();
  return section.title !== undefined && words(section.title) === words(board.name);
}

/**
 * The hero's standfirst and its now line, for a phone (E1): there the hero
 * is the thesis and one action, so the field's tiles read on the first
 * screen, and its standfirst sets in Now, under Now's own head, across the
 * phone's column (S2). Wider, this copy is out of the page and the hero
 * keeps them; on a phone the hero's are, so the words are on the page once
 * at every width. With no Now there's no copy, and the phone's hero keeps
 * its own.
 */
function PhoneLead({ input, overview }: { input: VariantRenderInput; overview: Overview }) {
  const thesis = input.portfolio.practice?.thesis;
  const rest = overview.thesis && present(thesis) ? splitThesis(thesis).rest : undefined;
  const now = overview.hero?.kind === 'hero' ? overview.hero.subtagline : undefined;
  if (!overview.now || (rest === undefined && !present(now))) return null;
  return (
    <div className="sb-lead">
      {rest !== undefined ? (
        <RichText source={rest} input={input} className="sb-lead__words" />
      ) : null}
      {present(now) ? <p className="sb-lead__now">{now}</p> : null}
    </div>
  );
}

function BoardSection({
  board,
  input,
  outline,
}: {
  board: Board;
  input: VariantRenderInput;
  outline: HomePageProps['outline'];
}) {
  const titleId = `${boardAnchor(input, board.id)}-title`;
  const spans = recordSpans(board);
  return (
    <section
      className="sb-board"
      data-board={board.id}
      id={boardAnchor(input, board.id)}
      aria-labelledby={titleId}
    >
      <div className="sb-field">
        <BoardLabel board={board} outline={outline} input={input} titleId={titleId} />
        {board.tiles.map((tile) =>
          renderSection(
            tile.section,
            input,
            compose({
              span: tile.span,
              spanMd: tile.spanMd,
              ...(tile.fixed ? { col: tile.col + 1 } : {}),
              ...(tile.rows === 2 ? { tall: true } : {}),
              tone: tile.inverse ? 'inverse' : tile.section.kind === 'cta' ? 'accent' : undefined,
              size: tile.span >= 7 ? 'large' : undefined,
              echo: echoes(tile.section, board),
            }),
            { level: 3 },
          ),
        )}
        <FullRecord board={board} input={input} span={spans.archive} />
      </div>
    </section>
  );
}

export function HomePage({ input, outline }: HomePageProps) {
  const { ids, portfolio } = input;
  const sections = portfolio.sections.filter((section) => sectionRenders(section, input));
  const overview = overviewOf(sections, input);
  const boards = boardsOf(sections, overview, input);
  const footer = footerOutline(input, SECTIONS);
  const uiLang = uiLangOf(input);
  // A field of the hero alone, no works, Now, ledger or board, has nothing to index: no
  // Contents and no Menu, and the hero takes the row.
  const indexless = boards.length === 0 && !overview.showcase && overview.top === 'none';
  const menu = indexless ? null : (
    <Menu input={input} overview={overview} boards={boards} outline={outline} />
  );
  const overviewId = boardAnchor(input, 'overview');
  const contact = boards.find((board) => board.id === 'contact');
  const lead = <PhoneLead input={input} overview={overview} />;
  // Now, with the phone's standfirst under its head; the ledger as it is.
  const tile = (section: Overview['now'], area: string) =>
    section
      ? renderSection(
          section,
          input,
          {
            renderers: area === 'now' ? { ...RENDERERS, now: nowLed(lead) } : RENDERERS,
            Frame: tileFrame({ area, size: 'dense' }),
          },
          { level: 2 },
        )
      : null;
  return (
    <>
      <Dock
        name={portfolio.identity.name}
        overview={overviewId}
        boards={boards.map((board) => ({
          anchor: boardTarget(input, board),
          label: board.name,
        }))}
        phone={{
          ...(overview.showcase ? { work: `${ids.prefix}${overview.showcase.id}` } : {}),
          ...(contact ? { contact: boardTarget(input, contact) } : {}),
          menu: menuId(portfolio),
        }}
        label="Boards"
        lang={uiLang}
      />
      <main id={ids.main} className="sb-page" tabIndex={-1}>
        <div className="sb-overview" id={overviewId}>
          <Settle field={overviewId} />
          <ReturnFocus />
          <RecordFolds within={ids.main} />
          {/*
           * One band, in reading order: the hero, then Selected work (E2), then
           * Contents, Now, the ledger and reach. Wider, the stylesheet sets the
           * works under the hero's row; on a phone they follow it, so the
           * flagship is the second tile.
           */}
          <div
            className="sb-band"
            data-layout={overview.top}
            data-works={overview.works}
            data-index={indexless ? 'none' : undefined}
          >
            {overview.hero ? (
              renderSection(
                overview.hero,
                input,
                compose({ area: 'hero', tone: 'well', size: 'large', before: menu }),
                { level: 1 },
              )
            ) : (
              <IdentityPlate input={input} overview={overview} menu={menu} />
            )}
            {overview.showcase
              ? renderSection(
                  overview.showcase,
                  input,
                  { renderers: { ...RENDERERS, works: ShowcaseWorks }, Frame: GroupFrame },
                  { level: 2 },
                )
              : null}
            {indexless ? null : <Contents input={input} overview={overview} boards={boards} />}
            {tile(overview.now, 'now')}
            {tile(overview.glance, 'glance')}
            <Reach input={input} footer={footer} />
          </div>
        </div>
        {boards.filter(fielded).map((board) => (
          <BoardSection key={board.id} board={board} input={input} outline={outline} />
        ))}
      </main>
      <FooterTile
        input={input}
        footer={footer}
        boards={boards.length}
        record={boards.some((board) => board.archive !== undefined)}
      />
    </>
  );
}
