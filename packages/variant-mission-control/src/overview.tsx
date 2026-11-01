import type { ReactElement } from 'react';
import { formatFigure, renderContext, RichText } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, dateText, type Board, type HomeModel } from './model';
import { Bar } from './wall/panel';
import { CountText, traceAttrs, Words } from './parts';

// The Overview board, the first view: one measured instrument. The anchor
// panel (the name at title size as the page's h1 in its bar, the role line,
// the thesis's first sentence at lede size, the hero's status line and its
// actions), the square readouts, and Latest. The owner's overviewTail, if
// any, follows as ordinary panels. The thesis's first sentence is the
// lede, and its rest the standfirst right under it: one statement,
// continued (MC-M1). The hero's tagline opens About's lede panel. The readouts and Latest summarise
// other boards (K-1's grouping is display only, so the metrics and the
// dated records stay where the map puts them): each links where its
// record is.

/** The boards that hold the sections named, in the wall's order. */
const boardsHolding = (model: HomeModel, sections: ReadonlySet<string>): readonly Board[] =>
  model.boards.filter((board) => board.sections.some((section) => sections.has(section.id)));

/** Links to each board, joined as a list in words: "Work, Writing and Record". */
function BoardLinks({ boards, uiLang }: { boards: readonly Board[]; uiLang: 'en' | undefined }) {
  return (
    <>
      {boards.map((board, index) => (
        <span key={board.id}>
          {index === 0 ? null : (
            <Words lang={uiLang}>{index === boards.length - 1 ? ' and ' : ', '}</Words>
          )}
          <a className="mc-link" href={board.href} lang={board.lang}>
            {board.label}
          </a>
        </span>
      ))}
    </>
  );
}

/** The anchor panel: its bar holds the h1; its body holds the thesis's and the hero's frames. */
export function Anchor({
  input,
  model,
  parts,
  span,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  parts: { thesis: ReactElement | null; hero: ReactElement | null };
  span: number;
}) {
  const ids = chromeIds(input.ids.prefix);
  const { identity } = input.portfolio;
  const meta = [identity.pronouns, identity.location].filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return (
    <div className="mc-panel mc-anchor" data-span={span}>
      <header className="mc-bar mc-anchor__bar">
        <h1 className="mc-name" id={ids.name}>
          {identity.name}
        </h1>
        {meta.length > 0 ? (
          <p className="mc-bar__meta">
            {meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </p>
        ) : null}
      </header>
      <div className="mc-anchor__body">
        {model.role ? (
          <p className="mc-role">
            <span>{model.role.title}</span>
            {model.role.organization ? (
              <>
                <Words lang={model.uiLang}>{' at '}</Words>
                <span className="mc-role__org">{model.role.organization}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {/* With no hero and no thesis on the Overview, no part draws the lede: the anchor does (N5). */}
        {!model.ledeInPart && model.lede ? (
          <p className="mc-lede">
            <RichText source={model.lede} inline input={input} />
          </p>
        ) : null}
        {parts.thesis}
        {parts.hero}
      </div>
    </div>
  );
}

/** The square readouts: each metric's figure and the first clause of what it counts, linking to its record. */
export function Readouts({
  input,
  model,
  span,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  span: number;
}) {
  const found = model.readouts;
  if (!found) return null;
  const ids = chromeIds(input.ids.prefix);
  const ctx = renderContext(input, { id: found.section.id, title: found.section.title }, 2);
  const [ledger] = boardsHolding(model, new Set([found.section.id]));
  return (
    <section
      className="mc-panel mc-readouts"
      data-span={span}
      aria-labelledby={ids.readoutsTitle}
      data-count={found.readouts.length}
    >
      {/* The squares summarise a metric section that renders in full on its own board, under
          the owner's title. So the title shows once, there: this bar is the readouts', and
          the panel's foot routes to that ledger, on the band's last line beside Latest's. */}
      <Bar
        level={2}
        id={ids.readoutsTitle}
        title={<Words lang={model.uiLang}>Readouts</Words>}
        meta={
          <CountText
            count={{ n: found.readouts.length, one: 'metric', many: 'metrics' }}
            uiLang={model.uiLang}
          />
        }
      />
      <ul className="mc-readouts__grid">
        {found.readouts.map((readout) => (
          <li
            key={readout.id}
            className="mc-readout"
            lang={readout.lang}
            {...traceAttrs(readout.id, model)}
          >
            <a className="mc-readout__link" href={readout.href}>
              {readout.label ? <span className="mc-readout__label">{readout.label}</span> : null}
              <span className="mc-readout__figure">
                {readout.value !== undefined ? (
                  <span className="mc-num">{formatFigure(readout.value, ctx)}</span>
                ) : null}
                {readout.unit ? <span className="mc-readout__unit">{readout.unit}</span> : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {ledger ? (
        <p className="mc-panel__foot">
          <a className="mc-link" href={`#${input.ids.prefix}${found.section.id}`}>
            <Words lang={model.uiLang}>Ledger on </Words>
            <span lang={ledger.lang}>{ledger.label}</span>
          </a>
        </p>
      ) : null}
    </section>
  );
}

/** Latest: the newest dated records, as many as the control allows, and how many there are in all. */
export function Latest({
  input,
  model,
  span,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  span: number;
}) {
  if (model.latestShown === 0) return null;
  const ids = chromeIds(input.ids.prefix);
  const shown = model.latest.slice(0, model.latestShown);
  // The rest are on whichever boards hold them, each linked: not one board for all.
  const rest = boardsHolding(
    model,
    new Set(model.latest.slice(shown.length).map((item) => item.section)),
  );
  return (
    <section className="mc-panel mc-latest" data-span={span} aria-labelledby={ids.latestTitle}>
      <Bar
        level={2}
        id={ids.latestTitle}
        title={<Words lang={model.uiLang}>Latest</Words>}
        meta={
          <span className="mc-count">
            <span className="mc-num">{shown.length}</span> <Words lang={model.uiLang}>of</Words>{' '}
            <span className="mc-num">{model.latest.length}</span>{' '}
            <Words lang={model.uiLang}>dated records</Words>
          </span>
        }
      />
      <ol className="mc-latest__list">
        {shown.map((item) => (
          <li key={item.id} className="mc-latest__item" {...traceAttrs(item.id, model)}>
            <p className="mc-latest__when">
              <time className="mc-num" dateTime={item.date}>
                {dateText(item.date, input.portfolio.locale)}
              </time>{' '}
              <Words lang={model.uiLang}>{item.kind}</Words>
            </p>
            <a className="mc-latest__title" href={item.href} lang={item.lang}>
              {item.title}
            </a>
          </li>
        ))}
      </ol>
      {rest.length > 0 ? (
        <p className="mc-panel__foot">
          <Words lang={model.uiLang}>The rest on </Words>
          <BoardLinks boards={rest} uiLang={model.uiLang} />
        </p>
      ) : null}
    </section>
  );
}
