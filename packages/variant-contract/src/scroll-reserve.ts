// A reserve at the window's block start or block end for a bar pinned there,
// a manifest opt-in under contract 2.1, as the view transitions are. A
// variant declares `scrollReserve: { blockEnd: '5rem', media: '(max-width: 39.99rem)' }`
// for a bar at the foot, `{ blockStart: 'calc(3.5rem + 1.25rem)' }` for a
// header row stuck at the top, or both lengths. The host then writes, into that
// variant's compiled stylesheet alone, after its layer and outside every
// cascade layer:
//
//   @media <media> {
//     :root:has([data-variant="<id>"]) {
//       scroll-padding-block-start: <blockStart>;
//       scroll-padding-block-end: <blockEnd>;
//     }
//   }
//
// each line only for a length it declares, as longhands so neither resets
// the other. The one media holds for both lengths; with none, the rule stands
// bare. A
// bar fixed or stuck at the window's edge covers what sits under it, and focus
// that lands there without scrolling stays under it: a control's scroll-margin
// acts only when focus scrolls, and the browser scrolls a focused control only
// when it isn't already inside the scrollport, less the scroller's
// scroll-padding. The scroller is the document's root, whose padding a
// variant's stylesheet can't reach: its rules sit under [data-variant]. So the
// host sets it. (Flux at 390: the #stats fold's summary sat 5.9px under the
// dock, and its focus ring with it, with no scroll at its stop. Raw Grid at
// 1440: a heading of its index took focus under the stuck header row, with no
// scroll at its stop.)
//
// The packs' tokens sit on the boundary, not the root, so the reserve is a
// length the root resolves: rem or px, alone or in one calc(), min(), or
// max() of them, more than 0 and at most MAX_SCROLL_RESERVE_PX at the
// initial 16px. rem follows the root's text size, as a bar sized in it does.
// The media is one width or height condition in rem, as a stylesheet's own
// queries are, or (hover: none).
//
// Compositions whose bars this fits, besides Flux's dock (.fx-bar, fixed
// under 40rem) and Mission Control's .mc-rail (fixed under 47.5rem), which
// declare it: Shell's .sh-tmux (fixed at the foot), Horizontal Cinema's
// .hc-board__map (stuck at the foot under 48rem), and Kinetic Cosmos's
// .kc-dock (stuck at the foot). Each relies on a scroll-margin of its bar's
// height today. At the top, Raw Grid's .rg-head header row sticks while
// the window is 32rem tall or more.

/** The contract minor that adds `scrollReserve`: 2.1. */
export const SCROLL_RESERVE_MINOR = 1;

/** The largest reserve, in px at the initial 16px root: 8rem. */
export const MAX_SCROLL_RESERVE_PX = 128;

/** The longest a reserve's length or media may be, in characters. */
export const MAX_SCROLL_RESERVE_LENGTH = 64;

const ROOT_PX = 16;
const LENGTH = /^(\d+(?:\.\d+)?)(rem|px)$/;
const FUNCTION = /^(calc|min|max)\(([^()]*)\)$/;
const MEDIA = /^\((?:max|min)-(?:width|height): \d+(?:\.\d+)?rem\)$/;

/** A plain rem or px length's size in px at the initial root, or undefined when it isn't one. */
function pxOf(text: string): number | undefined {
  const match = LENGTH.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === 'rem' ? ROOT_PX : 1);
}

/** A reserve length's size in px at the initial root, or undefined when it isn't one the root resolves. */
export function scrollReservePx(length: string): number | undefined {
  const plain = pxOf(length);
  if (plain !== undefined) return plain;
  const call = FUNCTION.exec(length.trim());
  if (!call) return undefined;
  const [, name, body] = call as unknown as [string, 'calc' | 'min' | 'max', string];
  if (name === 'calc') {
    const terms = body.trim().split(/\s+([+-])\s+/);
    let sum = pxOf(terms[0]!);
    if (sum === undefined) return undefined;
    for (let index = 1; index < terms.length; index += 2) {
      const term = pxOf(terms[index + 1] ?? '');
      if (term === undefined) return undefined;
      sum += terms[index] === '+' ? term : -term;
    }
    return terms.length > 1 ? sum : undefined;
  }
  const parts = body.split(',').map(pxOf);
  if (parts.length < 2 || parts.some((part) => part === undefined)) return undefined;
  return (name === 'min' ? Math.min : Math.max)(...(parts as number[]));
}

/** What's wrong with a reserve's blockStart or blockEnd, or undefined when it's fine. */
export function scrollReserveProblem(length: string): string | undefined {
  if (length.includes('var(')) {
    return "must be a length the root resolves: the packs' tokens sit on the boundary, not the root, so a var() there resolves to nothing and the padding to auto.";
  }
  const px = scrollReservePx(length);
  if (px === undefined) {
    return 'must be a length the root resolves: rem or px, alone or in one calc(), min(), or max() of them, such as 5rem or calc(4rem + 12px).';
  }
  if (px <= 0 || px > MAX_SCROLL_RESERVE_PX) {
    return `must be more than 0 and at most ${MAX_SCROLL_RESERVE_PX / ROOT_PX}rem (${MAX_SCROLL_RESERVE_PX}px at 16px); it comes to ${px}px.`;
  }
  return undefined;
}

/** What's wrong with a reserve's media, or undefined when it's fine. */
export function scrollReserveMediaProblem(media: string): string | undefined {
  if (MEDIA.test(media) || media === '(hover: none)') return undefined;
  return 'must be one width or height condition in rem, such as (max-width: 39.99rem) or (min-height: 32rem), or (hover: none).';
}

/** The reserve's lengths, in the order the host writes them. */
export const SCROLL_RESERVE_SIDES = Object.freeze(['blockStart', 'blockEnd'] as const);

/** A manifest's reserve: the length at the window's block start, at its block end, or both, and the media they hold in. */
export interface ScrollReserve {
  readonly blockStart?: string;
  readonly blockEnd?: string;
  readonly media?: string;
}

const PROPERTY = { blockStart: 'scroll-padding-block-start', blockEnd: 'scroll-padding-block-end' };

/** What the host writes after the layer of the variant `id`, which reserves `reserve`. */
export function hostScrollReserveCss(id: string, reserve: ScrollReserve): string {
  const rule = [
    `:root:has([data-variant="${id}"]) {`,
    ...SCROLL_RESERVE_SIDES.flatMap((side) =>
      reserve[side] === undefined ? [] : [`  ${PROPERTY[side]}: ${reserve[side]};`],
    ),
    '}',
  ];
  if (reserve.media === undefined) return rule.join('\n');
  return [`@media ${reserve.media} {`, ...rule.map((line) => `  ${line}`), '}'].join('\n');
}
