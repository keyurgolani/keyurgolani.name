import type { ReactNode } from 'react';
import type { CaseStudy, Work } from '@portfolio/schema';
import {
  DateText,
  formatFigure,
  hrefFor,
  isRoutedWork,
  PeriodText,
  present,
  renderContext,
  RichText,
  type RenderContext,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Hang, WallLabel } from './hang';
import { mediumLabel, roman, type AtelierModel, type Room } from './model';
import { numbers, ownId, Words } from './parts';

// A room (redesign, stream C): one work, its medium's own way, on the
// canvas between walls.
//
//   reading   Room I: the signature already hangs on the entrance wall, so
//             its room is the reading, a head rail that stays beside the
//             analytical column as it scrolls.
//   wall      a wall standing on one side of the room with the work hung
//             on it, the reading beside it on the canvas; sides alternate.
//   vitrine   writing: its own title page as one plate hung on a wall,
//             its wall label beside it (C5).
//
// Each room says where it is, "No. 2, Room II of III", links its title to
// the work's own page when it has one, and ends on plain previous and next
// links by catalogue number. Unfold the case is a native details, closed
// on the server: the challenge, the decisions, and what changed.

const ROOM_SIZES = '(min-width: 64rem) 50vw, 100vw';

/** The work's own page, when it has one. */
function casePage(work: Work, input: VariantRenderInput): string | undefined {
  return isRoutedWork(work) ? routeHref(input, { route: 'work', slug: work.slug }) : undefined;
}

/** What Unfold the case holds: the challenge, the decisions, and what changed, else the first parts there are. */
const UNFOLD: readonly (readonly [keyof CaseStudy, string])[] = [
  ['challenge', 'The challenge'],
  ['decisions', 'Decisions'],
  ['outcomes', 'What changed'],
];
const FALLBACK: readonly (readonly [keyof CaseStudy, string])[] = [
  ['context', 'Context'],
  ['role', 'Role'],
  ['constraints', 'Constraints'],
  ['evidence', 'Evidence'],
  ['reflection', 'Reflection'],
];

function unfolded(study: CaseStudy | undefined): (readonly [keyof CaseStudy, string])[] {
  if (!study) return [];
  const has = ([key]: readonly [keyof CaseStudy, string]) =>
    key === 'decisions' ? Boolean(study.decisions?.length) : present(study[key] as string);
  const main = UNFOLD.filter(has);
  return main.length > 0 ? main : FALLBACK.filter(has).slice(0, 3);
}

function Unfold({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { input } = ctx;
  const study = work.caseStudy;
  const parts = unfolded(study);
  if (!study || parts.length === 0) return null;
  const count = study.decisions?.length ?? 0;
  const label = ([key, words]: readonly [keyof CaseStudy, string]) =>
    key === 'decisions' && count === 2 ? 'Two decisions' : words;
  return (
    // A native details of the composition's own: the case opens with no script.
    <details className="oa-unfold">
      <summary className="oa-summary">
        <span className="oa-plus" aria-hidden="true" />
        <span className="oa-unfold__verb oa-unfold__verb--open">
          <Words input={input}>Unfold the case</Words>
        </span>
        <span className="oa-unfold__verb oa-unfold__verb--close">
          <Words input={input}>Fold the case</Words>
        </span>
        <span className="oa-visually-hidden" lang={work.lang}>
          {`: ${work.title}`}
        </span>
      </summary>
      <dl className="oa-unfold__case" lang={work.lang}>
        {parts.map((part) => (
          <div key={part[0]}>
            <dt>
              <Words input={input}>{label(part)}</Words>
            </dt>
            <dd>
              {part[0] === 'decisions' ? (
                <ol className="oa-decisions">
                  {study.decisions!.map((decision, index) => (
                    <li key={index}>
                      <RichText source={decision.decision} input={input} />
                      {present(decision.rationale) ? (
                        <RichText source={decision.rationale} className="oa-quiet" input={input} />
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <RichText source={study[part[0]] as string} input={input} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The links a room ends its reading on: the whole case first, then the owner's. */
function Links({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { input } = ctx;
  const page = casePage(work, input);
  const own: { href: string; text: ReactNode }[] = [
    ...(page ? [{ href: page, text: <Words input={input}>Read the whole case</Words> }] : []),
    ...(present(work.url) && work.medium === 'writing'
      ? [{ href: hrefFor(work.url, input), text: <Words input={input}>Read the essay</Words> }]
      : present(work.url)
        ? [{ href: hrefFor(work.url, input), text: <Words input={input}>Visit</Words> }]
        : []),
    ...(work.links ?? []).map((link) => ({
      href: hrefFor(link.url, input),
      text: <>{[link.label, link.platform].find(present) ?? link.url}</>,
    })),
    ...(present(work.audioUrl)
      ? [{ href: hrefFor(work.audioUrl, input), text: <Words input={input}>Listen</Words> }]
      : []),
    ...(present(work.videoUrl)
      ? [{ href: hrefFor(work.videoUrl, input), text: <Words input={input}>Watch</Words> }]
      : []),
  ];
  if (own.length === 0) return null;
  return (
    <ul className="oa-links" role="list">
      {own.map((link, index) => (
        <li key={index}>
          <a href={link.href}>{link.text}</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * A wall's floor: what the view is, "Installation view, Room II". The way
 * on is the pager's, after the room's words, so on a phone the room's head
 * comes before any way out of it (P1-7), and a room has one next link.
 */
function WallFloor({ room, input }: { room: Room; input: VariantRenderInput }) {
  return (
    <p className="oa-wallfloor" data-type-role="label">
      <span>
        <Words input={input}>{`Installation view, Room ${room.numeral}`}</Words>
      </span>
    </p>
  );
}

/** Previous and next room by catalogue number; after the last, the collection, or the first gallery. */
function Pager({
  room,
  model,
  input,
}: {
  room: Room;
  model: AtelierModel;
  input: VariantRenderInput;
}) {
  const previous = model.rooms[room.number - 2];
  const next = model.rooms[room.number];
  const then = next
    ? undefined
    : model.hangs
      ? {
          href: `#${ownId(input, 'collection')}`,
          text: `The collection, ${numbers(model.hangs.first, model.hangs.last)}`,
        }
      : model.galleries[0]
        ? { href: `#${ownId(input, model.galleries[0].key)}`, text: model.galleries[0].label }
        : undefined;
  const step = (rel: string, target: Room) => (
    <li>
      <a href={`#${target.anchor}`}>
        <span className="oa-pager__rel" data-type-role="label">
          <Words input={input}>{rel}</Words>
        </span>
        <span className="oa-pager__title">
          <Words input={input}>{`No. ${target.number}, `}</Words>
          <span lang={target.work.lang}>{target.work.title}</span>
        </span>
      </a>
    </li>
  );
  if (!previous && !next && !then) return null;
  return (
    <ul className="oa-pager" role="list">
      {previous ? step('Previous room', previous) : null}
      {next ? step('Next room', next) : null}
      {then ? (
        <li>
          <a href={then.href}>
            <span className="oa-pager__rel" data-type-role="label">
              <Words input={input}>Then</Words>
            </span>
            <span className="oa-pager__title">
              <Words input={input}>{then.text}</Words>
            </span>
          </a>
        </li>
      ) : null}
    </ul>
  );
}

/** Where the room is, its title, and when: the head every layout opens with. */
function Head({
  room,
  ctx,
  total,
  linked = true,
  children,
}: {
  room: Room;
  ctx: RenderContext;
  total: number;
  /** Whether the title links to the case page: not where the title page beside it carries the link. */
  linked?: boolean;
  children?: ReactNode;
}) {
  const { work } = room;
  const { input } = ctx;
  const page = linked ? casePage(work, input) : undefined;
  const medium = mediumLabel(work);
  const of = total > 0 ? ` of ${roman(total)}` : '';
  return (
    <div className="oa-room__head">
      <p className="oa-no" data-type-role="label">
        <Words input={input}>{`Room ${room.numeral}${of}`}</Words>
      </p>
      <h2
        id={ownId(input, `room-${work.id}`)}
        className="oa-roomtitle"
        data-type-role="headline"
        lang={work.lang}
      >
        {page ? <a href={page}>{work.title}</a> : work.title}
      </h2>
      {work.period || medium ? (
        <p className="oa-quiet">
          {medium ? <Words input={input}>{medium}</Words> : null}
          {medium && work.period ? ', ' : null}
          {work.period ? <PeriodText period={work.period} ctx={ctx} /> : null}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** The work's own words: its premise, then its description. */
function Reading({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <>
      {present(work.summary) ? (
        <RichText source={work.summary} className="oa-premise" input={input} />
      ) : null}
      {present(work.description) ? (
        <RichText source={work.description} className="oa-prose" input={input} />
      ) : null}
    </>
  );
}

function Highlights({ work }: { work: Work }) {
  const items = (work.highlights ?? []).filter(present);
  if (items.length === 0) return null;
  return (
    <ul className="oa-highlights" role="list" lang={work.lang}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Writing's own title page: where it ran, its title, its excerpt, and when and how long. */
function Folio({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { input } = ctx;
  const page = casePage(work, input);
  return (
    <div className="oa-folio" lang={work.lang}>
      {present(work.publication) ? (
        <p className="oa-quiet" data-type-role="label">
          {work.publication}
        </p>
      ) : null}
      <p className="oa-folio__title">{page ? <a href={page}>{work.title}</a> : work.title}</p>
      {present(work.excerpt) ? (
        <blockquote className="oa-folio__excerpt">
          <RichText source={work.excerpt} input={input} />
        </blockquote>
      ) : null}
      {work.publishedAt !== undefined || work.readingTimeMinutes !== undefined ? (
        <p className="oa-folio__meta" data-type-role="label">
          {work.publishedAt !== undefined ? <DateText raw={work.publishedAt} ctx={ctx} /> : null}
          {work.readingTimeMinutes !== undefined ? (
            <span>
              <Words input={input}>{`${formatFigure(work.readingTimeMinutes, ctx)} minutes`}</Words>
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function RoomView({
  room,
  model,
  input,
}: {
  room: Room;
  model: AtelierModel;
  input: VariantRenderInput;
}) {
  const { work } = room;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 2);
  const total = model.roomCount;
  const pager = <Pager room={room} model={model} input={input} />;
  const place = `Room ${room.numeral} of ${roman(total)}`;
  const shared = {
    id: room.anchor,
    'data-layout': room.layout,
    'data-side': room.side,
    'data-medium': work.medium,
    'data-oa-place': place,
    'aria-labelledby': ownId(input, `room-${work.id}`),
  };
  if (room.layout === 'reading') {
    return (
      <article className="oa-room oa-room--reading" {...shared}>
        <div className="oa-reading__head">
          <Head room={room} ctx={ctx} total={total} />
        </div>
        <div className="oa-reading__body">
          <Reading work={work} ctx={ctx} />
          <Unfold work={work} ctx={ctx} />
          <Links work={work} ctx={ctx} />
        </div>
        {/* The room's facts and its way on, in the declared track beside the reading. */}
        <div className="oa-reading__aside">
          <Highlights work={work} />
          {pager}
        </div>
      </article>
    );
  }
  if (room.layout === 'vitrine') {
    return (
      <article className="oa-room oa-room--vitrine" {...shared}>
        <div className="oa-side">
          <Head room={room} ctx={ctx} total={total} linked={false} />
          <Reading work={work} ctx={ctx} />
          <Highlights work={work} />
          <Unfold work={work} ctx={ctx} />
          <Links work={work} ctx={ctx} />
          {pager}
        </div>
        {/* The essay's title page, hung on its wall as one plate, its label beside it naming no title again. */}
        <figure className="oa-vitrine oa-wall" aria-labelledby={ownId(input, `label-${work.id}`)}>
          <Folio work={work} ctx={ctx} />
          <WallLabel room={room} ctx={ctx} untitled />
        </figure>
      </article>
    );
  }
  return (
    <article className="oa-room oa-room--wall" {...shared}>
      <div className="oa-room__wall oa-wall">
        <Hang room={room} ctx={ctx} sizes={ROOM_SIZES} />
        <WallFloor room={room} input={input} />
      </div>
      <div className="oa-side">
        <Head room={room} ctx={ctx} total={total} />
        <Reading work={work} ctx={ctx} />
        <Highlights work={work} />
        <Unfold work={work} ctx={ctx} />
        <Links work={work} ctx={ctx} />
        {pager}
      </div>
    </article>
  );
}
