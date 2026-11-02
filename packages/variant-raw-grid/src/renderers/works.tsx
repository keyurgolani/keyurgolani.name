import { Fragment, type CSSProperties } from 'react';
import type { Work } from '@portfolio/schema';
import {
  DateText,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  hrefFor,
  MediaFigure,
  PeriodText,
  placedImage,
  placedMedia,
  present,
  recordAnchor,
  renderContext,
  RichText,
  worksOf,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { chromeIds, keepTail, longestToken, workHref } from '../model';
import { caseOf, Checks, Chips, Fit, Line, linkText, Links, Out, Words } from '../parts';
import { shapeOf } from '../shapes';
import { RuledTable } from './ruled-table';
import type { Env } from './env';

// Works, by medium: writing as dated rows with a pull quote beside each,
// audio and video as an episode table, photographs as butt-jointed frames
// with white caption cells, music as a cover beside its tracklist, and
// everything else as the sticker board, where every work is the same
// sticker card and the board's spans are unequal. The pinned work, already
// in the opening, is a one-line back-reference where its section lists it
// (RG-S6), keeping its anchor.

type Props = SectionRendererProps<SectionOf<'works'>> & { readonly env: Env };

/** Where a work's title goes: its own page, else its own address. */
const titleHref = (work: Work, ctx: RenderContext) =>
  workHref(work, ctx.input) ?? (work.url ? hrefFor(work.url, ctx.input) : undefined);

/** The work's links in a line: its own, then its audio or video. */
function workLinks(work: Work) {
  return [
    ...(work.links ?? []).map((link) => ({ url: link.url, text: linkText(link) })),
    ...(work.audioUrl ? [{ url: work.audioUrl, text: 'Listen' }] : []),
    ...(work.videoUrl ? [{ url: work.videoUrl, text: 'Watch' }] : []),
  ];
}

/**
 * What a card or the pin says of the work: its summary, and its description after it, as one
 * text, unless the work has a page of its own, which the listing links straight to, and a
 * summary the listing shows: then the description is on that page (the lead's ruling on the
 * content sweep, 2(c)).
 */
export function cardText(work: Work, input: RenderContext['input']): string | undefined {
  const onItsPage = workHref(work, input) !== undefined && present(work.summary);
  const text = [work.summary, onItsPage ? undefined : work.description].filter(present);
  return text.length > 0 ? text.map((part) => part.trim()).join('\n\n') : undefined;
}

/** When the work is from. */
function When({ work, ctx }: { work: Work; ctx: RenderContext }) {
  if (work.publishedAt !== undefined) return <DateText raw={work.publishedAt} ctx={ctx} />;
  if (work.releasedAt !== undefined) return <DateText raw={work.releasedAt} ctx={ctx} />;
  if (work.period) return <PeriodText period={work.period} ctx={ctx} />;
  return null;
}

/** A pair's one fit, by the longest piece across their titles, so both set at one size. */
export const peerFit = (titles: readonly string[]) =>
  ({
    '--layout-name-chars': Math.max(...titles.map((title) => longestToken(keepTail(title)))),
  }) as CSSProperties;

/** One sticker card: the template every work, offer, and repository shares. */
function Card({
  work,
  ctx,
  size,
  anchor,
  peers,
}: {
  work: Work;
  ctx: RenderContext;
  size: 'l' | 's';
  anchor?: string;
  /** One of a pair, whose shared fit its board sets. */
  peers?: boolean;
}) {
  const { input } = ctx;
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  const href = titleHref(work, ctx);
  const routed = workHref(work, input);
  return (
    <li className="rg-slot" data-size={size} id={anchor} lang={work.lang}>
      <article
        className="rg-card"
        data-tone={
          size === 'l' && input.portfolio.featured.includes(work.id) ? 'prominent' : undefined
        }
      >
        {cover ? (
          <div className="rg-card__media">
            <MediaFigure placed={cover} ctx={ctx} inline sizes="(min-width: 48rem) 40vw, 100vw" />
          </div>
        ) : null}
        <div className="rg-card__body">
          <Line
            className="rg-meta"
            parts={[work.role, work.organization, <When key="w" work={work} ctx={ctx} />]}
          />
          <Heading level={ctx.itemLevel} className="rg-card__title">
            {/* The name's fit, by the title's longest piece kept whole: no word breaks. */}
            <span
              className="rg-name"
              {...caseOf(work.title)}
              {...(peers
                ? {}
                : {
                    style: {
                      '--layout-name-chars': longestToken(keepTail(work.title)),
                    } as CSSProperties,
                  })}
            >
              {href ? (
                <a className="rg-stretch" href={href}>
                  {keepTail(work.title)}
                </a>
              ) : (
                keepTail(work.title)
              )}
            </span>
          </Heading>
          {cardText(work, input) !== undefined ? (
            <RichText source={cardText(work, input)!} className="rg-card__sum" input={input} />
          ) : null}
          <Checks items={work.highlights?.slice(0, 3)} />
          <Chips items={work.tools} label="Built with" />
          <div className="rg-card__links">
            {routed ? (
              <a className="rg-case" href={routed}>
                <Words lang={ctx.uiLang}>Open the case</Words>
              </a>
            ) : null}
            <Links
              links={workLinks(work).filter((link) => hrefFor(link.url, input) !== href)}
              input={input}
            />
          </div>
        </div>
      </article>
    </li>
  );
}

/**
 * The board: sticker cards on the bare board, the first larger (or two as
 * an equal pair, filling the field), the pinned work a back-reference.
 */
function Board({
  section,
  ctx,
  env,
  works,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  env: Env;
  works: readonly Work[];
}) {
  const { input } = ctx;
  const pinned = works.find((work) => work.id === env.model.pinned?.id);
  const cards = works.filter((work) => work !== pinned);
  // A pair where one card has a cover and the other none can't stand side by
  // side without one card holding blank: both run the field's width, the
  // covered one with its cover beside its text, the other a short strip.
  const covered = cards.filter((work) => placedImage(work.cover ?? work.media?.[0], input));
  const strip = cards.length === 2 && covered.length === 1;
  return (
    <div className="rg-bay">
      {pinned ? (
        <p className="rg-ref" id={recordAnchor(section, pinned, input)} lang={pinned.lang}>
          <Words lang={ctx.uiLang}>Pinned above:</Words>{' '}
          <a href={`#${chromeIds(input.ids.prefix).pin}`}>{pinned.title}</a>
        </p>
      ) : null}
      {cards.length > 0 ? (
        <ul
          className="rg-board"
          role="list"
          data-count={Math.min(cards.length, 4)}
          data-pair={strip ? 'strip' : undefined}
          // A pair shares one fit, by the longest piece across both titles.
          {...(cards.length === 2 ? { style: peerFit(cards.map((work) => work.title)) } : {})}
        >
          {cards.map((work, index) => (
            <Card
              key={work.id}
              work={work}
              ctx={ctx}
              // Two left after the pin are an equal pair; otherwise the first is larger.
              size={index === 0 && cards.length !== 2 ? 'l' : 's'}
              anchor={recordAnchor(section, work, input)}
              peers={cards.length === 2}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Writing: each work a dated row, its excerpt pulled beside it. */
function Rows({
  section,
  ctx,
  works,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  works: readonly Work[];
}) {
  const { input } = ctx;
  return (
    <>
      {works.map((work) => {
        const href = titleHref(work, ctx);
        return (
          <article
            key={work.id}
            className="rg-row"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            <div className="rg-cell rg-row__when">
              <p className="rg-num">
                <When work={work} ctx={ctx} />
              </p>
              {work.readingTimeMinutes !== undefined ? (
                <p className="rg-meta">{formatMinutes(work.readingTimeMinutes, ctx)}</p>
              ) : null}
            </div>
            <div className="rg-cell rg-row__main">
              <Heading level={ctx.itemLevel} className="rg-row__title">
                <Fit text={work.title}>
                  {href ? <Out href={href}>{work.title}</Out> : work.title}
                </Fit>
              </Heading>
              {present(work.summary) ? (
                <RichText source={work.summary} className="rg-row__sum" input={input} />
              ) : null}
              <Line className="rg-meta" parts={[work.publication, work.role]} />
              <Chips items={work.tags} />
            </div>
            {present(work.excerpt) ? (
              <blockquote className="rg-cell rg-row__quote">
                <RichText source={work.excerpt} input={input} />
              </blockquote>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

/** Audio and video: the episode table. */
function Episodes({
  section,
  ctx,
  works,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  works: readonly Work[];
}) {
  const { input } = ctx;
  return (
    <RuledTable
      rows={works}
      variant="episodes"
      caption={section.title ?? 'Episodes'}
      uiLang={ctx.uiLang}
      rowId={(work) => recordAnchor(section, work, input)}
      rowLang={(work) => work.lang}
      columns={[
        {
          key: 'no',
          head: 'No.',
          className: 'rg-t-no',
          cell: (work) =>
            work.number !== undefined ? (
              <span className="rg-num">{formatFigure(work.number, ctx)}</span>
            ) : null,
        },
        {
          key: 'title',
          head: 'Title',
          cell: (work) => {
            const href = titleHref(work, ctx);
            return (
              <>
                <Heading level={ctx.itemLevel} className="rg-t-title">
                  {href ? <a href={href}>{work.title}</a> : work.title}
                </Heading>
                {present(work.description) ? (
                  <RichText source={work.description} className="rg-t-desc" input={input} />
                ) : null}
                {present(work.showNotes) ? (
                  <RichText source={work.showNotes} className="rg-t-desc" input={input} />
                ) : null}
                <Line
                  className="rg-meta"
                  parts={[
                    // The series the table is titled by isn't said again on every row.
                    work.series !== section.title ? work.series : undefined,
                    work.guests?.length ? (
                      <Fragment key="g">
                        <Words lang={ctx.uiLang}>With</Words> {formatNames(work.guests, ctx)}
                      </Fragment>
                    ) : null,
                  ]}
                />
                {/* Its own links under its words: the date line keeps to Listen. */}
                <Links
                  links={(work.links ?? []).map((link) => ({
                    url: link.url,
                    text: linkText(link),
                  }))}
                  input={input}
                />
              </>
            );
          },
        },
        {
          key: 'date',
          head: 'Published',
          className: 'rg-t-date',
          cell: (work) =>
            work.publishedAt !== undefined ? <DateText raw={work.publishedAt} ctx={ctx} /> : null,
        },
        {
          key: 'length',
          head: 'Length',
          className: 'rg-t-date',
          cell: (work) =>
            work.durationMinutes !== undefined ? formatMinutes(work.durationMinutes, ctx) : null,
        },
        {
          key: 'link',
          head: 'Link',
          hiddenHead: true,
          cell: (work) => {
            const link = work.audioUrl ?? work.videoUrl;
            return link ? (
              <Out href={hrefFor(link, input)}>
                <Words lang={ctx.uiLang}>{work.audioUrl ? 'Listen' : 'Watch'}</Words>
              </Out>
            ) : null;
          },
        },
      ]}
    />
  );
}

/** Photographs: each frame a cell of the grid, captioned in a white cell beneath it. */
function Frames({
  section,
  ctx,
  works,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  works: readonly Work[];
}) {
  const { input } = ctx;
  return (
    <>
      {works.map((work) => {
        const frames = work.media ?? [];
        return (
          <div
            key={work.id}
            className="rg-frames"
            id={recordAnchor(section, work, input)}
            role="group"
            aria-label={work.title}
            lang={work.lang}
          >
            {frames.map((placement, index) => {
              const placed = placedMedia(placement, ctx);
              if (!placed) return null;
              return (
                <figure key={index} className="rg-cell rg-photo">
                  <div className="rg-photo__mat">
                    <MediaFigure
                      placed={{ ...placed, caption: undefined }}
                      ctx={ctx}
                      inline
                      sizes="(min-width: 48rem) 30vw, 100vw"
                    />
                  </div>
                  <figcaption className="rg-photo__cap">
                    {present(placement.caption) ? (
                      <span className="rg-photo__title">
                        <Fit text={placement.caption!} />
                      </span>
                    ) : null}
                    <Line
                      className="rg-meta"
                      parts={[
                        placement.location,
                        placement.takenAt !== undefined ? (
                          <DateText key="t" raw={placement.takenAt} ctx={ctx} />
                        ) : null,
                        ...(placement.tags ?? []),
                      ]}
                    />
                    <span className="rg-photo__n rg-num">
                      {index + 1}
                      <Words lang={ctx.uiLang}> of </Words>
                      {frames.length}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/** A track's length as minutes and seconds. */
const trackTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Music: the cover in one cell, the record and its tracklist beside it. */
function Album({
  section,
  ctx,
  works,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  works: readonly Work[];
}) {
  const { input } = ctx;
  return (
    <>
      {works.map((work) => {
        const cover = placedImage(work.cover ?? work.media?.[0], input);
        const tracks = work.tracks ?? [];
        const total = tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0);
        return (
          <article
            key={work.id}
            className="rg-album"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            {cover ? (
              <div className="rg-cell rg-album__cover">
                <MediaFigure
                  placed={cover}
                  ctx={ctx}
                  inline
                  sizes="(min-width: 48rem) 30vw, 100vw"
                />
              </div>
            ) : null}
            <div className="rg-cell rg-album__body">
              <Heading level={ctx.itemLevel} className="rg-album__title">
                <span
                  className="rg-name"
                  style={
                    { '--layout-name-chars': longestToken(keepTail(work.title)) } as CSSProperties
                  }
                >
                  {titleHref(work, ctx) ? (
                    <a href={titleHref(work, ctx)}>{keepTail(work.title)}</a>
                  ) : (
                    keepTail(work.title)
                  )}
                </span>
              </Heading>
              <Line
                className="rg-meta"
                parts={[work.artist, work.label, <When key="w" work={work} ctx={ctx} />, work.role]}
              />
              {present(work.description) ? (
                <RichText source={work.description} className="rg-album__desc" input={input} />
              ) : null}
              {tracks.length > 0 ? (
                <ol
                  className="rg-tracks"
                  style={{ '--layout-track-rows': Math.ceil(tracks.length / 2) } as CSSProperties}
                >
                  {tracks.map((track, index) => (
                    <li key={index}>
                      <span className="rg-tracks__t">
                        <Fit text={track.title}>
                          {track.url ? (
                            <Out href={hrefFor(track.url, input)}>{track.title}</Out>
                          ) : (
                            track.title
                          )}
                        </Fit>
                      </span>
                      {track.durationSeconds !== undefined ? (
                        <span className="rg-num">{trackTime(track.durationSeconds)}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="rg-card__links">
                {total > 0 ? (
                  <span className="rg-num">{formatMinutes(Math.round(total / 60), ctx)}</span>
                ) : null}
                <Links links={workLinks(work)} input={input} />
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}

export function WorksBody({ section, input, level, env }: Props) {
  const ctx = renderContext(input, section, level);
  const works = worksOf(section, input);
  switch (shapeOf(section, input)) {
    case 'rows':
      return <Rows section={section} ctx={ctx} works={works} />;
    case 'table':
      return <Episodes section={section} ctx={ctx} works={works} />;
    case 'frames':
      return <Frames section={section} ctx={ctx} works={works} />;
    case 'album':
      return <Album section={section} ctx={ctx} works={works} />;
    default:
      return <Board section={section} ctx={ctx} env={env} works={works} />;
  }
}
