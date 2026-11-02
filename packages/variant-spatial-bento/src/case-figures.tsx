import type { Evidence } from '@portfolio/schema';
import { formatFigure, present, RichText, type RenderContext } from '@portfolio/kit/sections';
import type { Change } from './figures';
import { Out } from './parts';

// The case sheet's figures (SPA-1), in the right track beside the words they
// draw: a change the case states in numbers (two bars on one scale: a
// share's is the whole, a figure's the larger side) and an award the work
// cites, as a seal.
// One caption system: each figure is numbered down the sheet, and its
// caption carries everything the drawing shows, in words and figures, so
// nothing is the graphic's alone. The drawings are ink only (currentColor:
// filled for the amount, outlined for the rest of the scale, the before side
// a tint and the after side solid), so they hold in dark, in forced colors,
// and in print, and nothing in them moves.

/** Each drawing's box: twenty units across and one deep, scaled to its track, at every width. */
const ACROSS = 20;
const INSET = 0.12;

/** One side of a change as its row reads: the figure and its unit, or the share in the owner's words. */
function sideWords(change: Change, side: 'from' | 'to', ctx: RenderContext): string {
  const { words, value } = change[side];
  if (change.kind === 'share') return words;
  const figure = formatFigure(value, ctx);
  if (!present(change.unit)) return figure;
  // "1 minute", not "1 minutes": the unit as written, singular for one.
  const unit = value === 1 ? change.unit.replace(/s$/i, '') : change.unit;
  return `${figure} ${unit}`;
}

/** How much of the ink the before side's fill takes: a tint under its outline, so the after side carries the weight. */
const BEFORE = 0.4;

/** A row's drawing: a bar on the change's scale, outlined to its whole. */
function Drawing({ change, side }: { change: Change; side: 'from' | 'to' }) {
  const value = change[side].value;
  const tint = side === 'from' ? BEFORE : undefined;
  const scale = change.kind === 'share' ? 100 : Math.max(change.from.value, change.to.value);
  // Its length on the box, to four places, so the markup holds no float noise.
  const length = Number(((value * ACROSS) / scale).toFixed(4));
  const bar = { y: INSET, height: 1 - 2 * INSET };
  const line = { stroke: 'currentColor', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      display="block"
      overflow="visible"
      width="100%"
      viewBox={`0 0 ${ACROSS} 1`}
    >
      {value > 0 ? <rect width={length} {...bar} fill="currentColor" fillOpacity={tint} /> : null}
      <rect width={ACROSS} {...bar} fill="none" {...line} />
    </svg>
  );
}

/** A figure's caption lead, in the composition's words: "Figure 2." */
function Lead({ number, uiLang }: { number: number; uiLang: string | undefined }) {
  return <b lang={uiLang}>Figure {number}.</b>;
}

/**
 * A change the case reports, drawn: what changed, where it was and where it
 * went, a row each, then a caption that says how it's drawn and both sides,
 * in the owner's words and figures, not the sentence beside it over again.
 */
export function ChangeFigure({
  change,
  number,
  ctx,
  lang,
}: {
  readonly change: Change;
  readonly number: number;
  readonly ctx: RenderContext;
  readonly lang: string | undefined;
}) {
  // How it's drawn: a share against its whole, a figure in its unit when the sentence names one.
  const how =
    change.kind === 'share'
      ? 'in percent of the whole'
      : present(change.unit)
        ? `in ${change.unit}`
        : undefined;
  const side = (which: 'from' | 'to') =>
    change.kind === 'share' ? change[which].words : formatFigure(change[which].value, ctx);
  return (
    <figure className="sb-fig" lang={lang}>
      <p className="sb-strong">{change.measure}</p>
      {(['from', 'to'] as const).map((which) => (
        <div key={which} className="sb-dated__body">
          <p className="sb-label">
            <span lang={ctx.uiLang}>{which === 'from' ? 'From' : 'To'}</span>{' '}
            <span className="sb-strong">{sideWords(change, which, ctx)}</span>
          </p>
          <Drawing change={change} side={which} />
        </div>
      ))}
      <figcaption className="sb-quiet">
        <Lead number={number} uiLang={ctx.uiLang} /> {change.measure}
        {how !== undefined ? (
          <>
            , <span lang={ctx.uiLang}>{how}</span>:
          </>
        ) : (
          ','
        )}{' '}
        <span lang={ctx.uiLang}>from</span> {side('from')} <span lang={ctx.uiLang}>to</span>{' '}
        {side('to')}.
      </figcaption>
    </figure>
  );
}

/** The year of a loose date. */
const yearOf = (raw: string | undefined) =>
  raw === undefined ? undefined : /^\d{4}/.exec(raw)?.[0];

/** A seal's edge: a ring of teeth around its centre, for the award's mark. */
const SEAL_EDGE = Array.from({ length: 48 }, (_, index) => {
  const radius = index % 2 === 0 ? 21.5 : 19.5;
  const angle = (index * Math.PI) / 24 - Math.PI / 2;
  return `${(22 + radius * Math.cos(angle)).toFixed(2)},${(22 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

/**
 * An award the work cites, as a seal with its year beside the caption:
 * what it is, who gave it and when, then, after the figure's number, what
 * it was for.
 */
export function AwardFigure({
  entry,
  number,
  ctx,
}: {
  readonly entry: Evidence;
  readonly number: number;
  readonly ctx: RenderContext;
}) {
  const year = yearOf(entry.receivedAt ?? entry.asOf ?? entry.publishedAt);
  const title = present(entry.title) ? entry.title : undefined;
  const facts = [entry.organization, entry.source?.name, year].filter(
    (part): part is string => typeof part === 'string' && present(part),
  );
  const words = present(entry.description) ? entry.description : entry.statement;
  return (
    <figure className="sb-fig sb-dated" lang={entry.lang}>
      <svg aria-hidden="true" focusable="false" width="44" height="44" viewBox="0 0 44 44">
        <polygon
          points={SEAL_EDGE}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        <circle cx={22} cy={22} r={16.5} fill="none" stroke="currentColor" strokeWidth={1} />
        {year !== undefined ? (
          <text
            x={22}
            y={22}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight={600}
            fill="currentColor"
          >
            {year}
          </text>
        ) : null}
      </svg>
      {/* The seal is the drawing; the caption beside it is the award whole, in words. */}
      <figcaption className="sb-dated__body">
        {title !== undefined ? (
          <p className="sb-strong">
            {present(entry.url) ? (
              <Out url={entry.url} ctx={ctx}>
                {title}
              </Out>
            ) : (
              title
            )}
          </p>
        ) : null}
        {facts.length > 0 ? <p className="sb-label">{facts.join(', ')}</p> : null}
        <p className="sb-quiet">
          <Lead number={number} uiLang={ctx.uiLang} />
          {present(words) ? (
            <>
              {' '}
              <RichText source={words} inline input={ctx.input} />
            </>
          ) : null}
        </p>
      </figcaption>
    </figure>
  );
}

/** Whether an award has anything to caption: a name, a giver, a date, or words. */
export const captionable = (entry: Evidence) =>
  present(entry.title) ||
  present(entry.organization) ||
  present(entry.source?.name) ||
  yearOf(entry.receivedAt ?? entry.asOf ?? entry.publishedAt) !== undefined ||
  present(entry.description) ||
  present(entry.statement);
