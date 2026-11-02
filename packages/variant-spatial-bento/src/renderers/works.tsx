import type { Work } from '@portfolio/schema';
import {
  DateText,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  isRoutedWork,
  MediaFigure,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  Ui,
  worksOf,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref } from '@portfolio/variant-contract';
import { showcaseOrder, worksMedium } from '../model';
import { AddressRow, Facts, LinkRow, Out, placed, TileHead } from '../parts';

// The works tiles. In the overview, the showcase's works are tiles of the
// field themselves: the first a media plate with its facts on an inset
// card, the second a dark tile under a band of its cover, and the rest a
// compact text tile. On a board, a works section is one tile shaped by
// what it holds: essays as entries, episodes with their running time drawn
// to scale, photographs as a mosaic, a release as a cover and a tracklist,
// and anything else as plates.

type WorksProps = SectionRendererProps<SectionOf<'works'>>;

/** A work's title, a link to its own address when it has one. */
function Title({ work, ctx, className }: { work: Work; ctx: RenderContext; className: string }) {
  return (
    <Heading level={ctx.itemLevel} className={className}>
      {present(work.url) ? (
        <Out url={work.url} ctx={ctx}>
          {work.title}
        </Out>
      ) : (
        work.title
      )}
    </Heading>
  );
}

/** The case study's link, under the kit's fixed label, when the work has its own page. */
function CaseLink({ work, ctx }: { work: Work; ctx: RenderContext }) {
  if (!isRoutedWork(work)) return null;
  return (
    <a
      className="sb-btn sb-btn--strong sb-btn--case"
      href={routeHref(ctx.input, { route: 'work', slug: work.slug })}
    >
      <Ui ctx={ctx}>Read the case study</Ui>
    </a>
  );
}

/** Who made it and when: its role and period, or its date. */
function WorkFacts({
  work,
  ctx,
  className,
}: {
  work: Work;
  ctx: RenderContext;
  className?: string;
}) {
  return (
    <Facts
      className={className}
      parts={[
        work.role,
        work.organization,
        work.period ? <PeriodText period={work.period} ctx={ctx} /> : null,
        work.publishedAt !== undefined && work.period === undefined ? (
          <DateText raw={work.publishedAt} ctx={ctx} field="publishedAt" />
        ) : null,
      ]}
    />
  );
}

/** A work's cover, else its first image. */
function coverOf(work: Work, ctx: RenderContext, eager = false, className?: string) {
  const image = placed(work.cover ?? work.media?.[0], ctx);
  return image ? (
    <MediaFigure
      placed={image}
      ctx={ctx}
      eager={eager}
      className={className}
      sizes="(min-width: 64rem) 40vw, 100vw"
    />
  ) : null;
}

/**
 * The first work: its cover is the tile, bled to the tile's edges, and under
 * it a caption row on the tile's own ground, the title and summary at the
 * start and the case study and links at the end. No card sits on the cover.
 */
function SignaturePlate({
  work,
  ctx,
  anchor,
}: {
  work: Work;
  ctx: RenderContext;
  anchor?: string;
}) {
  const cover = coverOf(work, ctx, true);
  return (
    <article
      id={anchor}
      className="sb-tile sb-tile--large sb-work sb-work--plate"
      data-area="lead"
      data-media={cover ? '' : undefined}
      data-work-id={work.id}
      lang={work.lang}
    >
      {cover ? <div className="sb-work__media">{cover}</div> : null}
      <div className="sb-work__caption">
        <div className="sb-work__words">
          <Title work={work} ctx={ctx} className="sb-title" />
          {present(work.summary) ? (
            <RichText source={work.summary} input={ctx.input} className="sb-work__summary" />
          ) : null}
          <Facts
            className="sb-label"
            parts={[
              work.role,
              work.period ? <PeriodText period={work.period} ctx={ctx} /> : null,
              work.highlights?.[0],
            ]}
          />
        </div>
        <div className="sb-work__actions">
          <CaseLink work={work} ctx={ctx} />
          <LinkRow links={work.links?.slice(0, 1)} ctx={ctx} />
        </div>
      </div>
    </article>
  );
}

/** The second: a dark tile under a band of its cover. */
function BandPlate({ work, ctx, anchor }: { work: Work; ctx: RenderContext; anchor?: string }) {
  const cover = coverOf(work, ctx);
  return (
    <article
      id={anchor}
      className="sb-tile sb-tile--large sb-tile--inverse sb-work sb-work--band"
      data-area="second"
      data-ui-surface="inverse"
      data-media={cover ? '' : undefined}
      data-work-id={work.id}
      lang={work.lang}
    >
      {cover ? <div className="sb-work__band">{cover}</div> : null}
      <Title work={work} ctx={ctx} className="sb-title" />
      {present(work.summary) ? (
        <RichText source={work.summary} input={ctx.input} className="sb-work__summary" />
      ) : null}
      <div className="sb-work__foot">
        <CaseLink work={work} ctx={ctx} />
        <LinkRow links={work.links} ctx={ctx} />
        <WorkFacts work={work} ctx={ctx} className="sb-label" />
      </div>
    </article>
  );
}

/** The rest: one work as a compact text tile, or several as a ruled list. */
function RestTile({
  works,
  ctx,
  anchor,
}: {
  works: readonly Work[];
  ctx: RenderContext;
  anchor: (work: Work) => string | undefined;
}) {
  if (works.length === 1) {
    const work = works[0]!;
    return (
      <article
        id={anchor(work)}
        className="sb-tile sb-tile--dense sb-work sb-work--note"
        data-area="rest"
        data-work-id={work.id}
        lang={work.lang}
      >
        <Title work={work} ctx={ctx} className="sb-title" />
        {present(work.summary) ? (
          <RichText source={work.summary} input={ctx.input} className="sb-work__summary" />
        ) : null}
        <div className="sb-work__foot">
          <CaseLink work={work} ctx={ctx} />
          <LinkRow links={work.links} ctx={ctx} />
        </div>
      </article>
    );
  }
  return (
    <div className="sb-tile sb-tile--dense sb-work sb-work--list" data-area="rest">
      <ul className="sb-ruled" role="list">
        {works.map((work) => (
          <li key={work.id} id={anchor(work)} data-work-id={work.id} lang={work.lang}>
            <Title work={work} ctx={ctx} className="sb-strong" />
            {present(work.summary) ? (
              <RichText source={work.summary} input={ctx.input} className="sb-quiet" />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The showcase in the overview: its works as tiles of the field, its title for assistive technology. */
export function ShowcaseWorks({ section, input, level }: WorksProps) {
  const ctx = renderContext(input, section, level);
  const works = showcaseOrder(worksOf(section, input), input.portfolio.signature);
  const anchor = (work: Work) => recordAnchor(section, work, input);
  const [lead, second, ...rest] = works;
  return (
    <>
      {present(section.title) ? (
        <Heading level={level} className="sb-hidden">
          {section.title}
        </Heading>
      ) : null}
      {lead ? <SignaturePlate work={lead} ctx={ctx} anchor={anchor(lead)} /> : null}
      {second ? <BandPlate work={second} ctx={ctx} anchor={anchor(second)} /> : null}
      {rest.length > 0 ? <RestTile works={rest} ctx={ctx} anchor={anchor} /> : null}
    </>
  );
}

/** Essays: a title, its excerpt in quotes, and when and where it ran. */
function Entries({ works, ctx, section, input }: ListProps) {
  return (
    <ul className="sb-entries sb-ruled" role="list">
      {works.map((work) => (
        <li key={work.id} id={recordAnchor(section, work, input)} lang={work.lang}>
          <Title work={work} ctx={ctx} className="sb-title sb-entries__title" />
          {present(work.excerpt) ? (
            <blockquote className="sb-entries__excerpt">
              <RichText source={work.excerpt} input={input} />
            </blockquote>
          ) : present(work.summary) ? (
            <RichText source={work.summary} input={input} className="sb-quiet" />
          ) : null}
          <Facts
            className="sb-label"
            parts={[
              work.publishedAt !== undefined ? (
                <DateText raw={work.publishedAt} ctx={ctx} field="publishedAt" />
              ) : null,
              work.readingTimeMinutes !== undefined
                ? formatMinutes(work.readingTimeMinutes, ctx)
                : null,
              work.publication,
            ]}
          />
        </li>
      ))}
    </ul>
  );
}

/** Episodes: their number, title, date, and their running time drawn to the longest's scale. */
function Episodes({ works, ctx, section, input }: ListProps) {
  const longest = Math.max(...works.map((work) => work.durationMinutes ?? 0));
  return (
    <ul className="sb-episodes sb-ruled" role="list">
      {works.map((work) => {
        const listen = work.audioUrl ?? work.videoUrl ?? work.url;
        return (
          <li key={work.id} id={recordAnchor(section, work, input)} lang={work.lang}>
            <div className="sb-episodes__top">
              <Facts
                className="sb-label"
                parts={[
                  work.number !== undefined ? (
                    <>
                      {present(work.series) ? `${work.series} ` : null}
                      <data value={work.number}>{formatFigure(work.number, ctx)}</data>
                    </>
                  ) : (
                    work.series
                  ),
                  work.guests?.length ? formatNames(work.guests, ctx) : null,
                ]}
              />
              {work.publishedAt !== undefined ? (
                <span className="sb-label">
                  <DateText raw={work.publishedAt} ctx={ctx} field="publishedAt" />
                </span>
              ) : null}
            </div>
            <Heading level={ctx.itemLevel} className="sb-strong">
              {present(listen) ? (
                <Out url={listen} ctx={ctx}>
                  {work.title}
                </Out>
              ) : (
                work.title
              )}
            </Heading>
            {present(work.description) ? (
              <RichText source={work.description} input={input} className="sb-quiet" />
            ) : null}
            {work.durationMinutes !== undefined && longest > 0 ? (
              <p className="sb-episodes__length">
                <span className="sb-bar" aria-hidden="true">
                  <span
                    className="sb-bar__fill"
                    style={{
                      inlineSize: `${((work.durationMinutes / longest) * 100).toFixed(1)}%`,
                    }}
                  />
                </span>
                <span className="sb-label">{formatMinutes(work.durationMinutes, ctx)}</span>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Photographs: every image the works place, the first large, each with its caption. */
function Photos({ works, ctx, section, input }: ListProps) {
  return (
    <div className="sb-photos">
      {works.map((work) => {
        const images = [work.cover, ...(work.media ?? [])].flatMap((placement) => {
          const image = placed(placement, ctx);
          return image ? [image] : [];
        });
        const named = !(works.length === 1 && work.title === section.title);
        return (
          <div key={work.id} id={recordAnchor(section, work, input)} lang={work.lang}>
            <Title work={work} ctx={ctx} className={named ? 'sb-strong' : 'sb-hidden'} />
            <ul className="sb-photos__grid" role="list">
              {images.map((image, index) => (
                <li key={`${image.asset}-${index}`}>
                  <MediaFigure placed={image} ctx={ctx} sizes="(min-width: 64rem) 30vw, 100vw" />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A track's length as m:ss. */
const trackTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** A release: its cover, its facts, and its tracklist in order. */
/** How many tracks a release shows before the rest fold away. */
export const TRACKS_SHOWN = 3;

/** A release's track count and, when every track says its length, the total: "6 tracks, 29:37". */
export function tracksWords(tracks: readonly { readonly durationSeconds?: number }[]): string {
  const count = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
  if (tracks.length === 0 || tracks.some((track) => track.durationSeconds === undefined))
    return count;
  return `${count}, ${trackTime(tracks.reduce((sum, track) => sum + track.durationSeconds!, 0))}`;
}

/**
 * Releases, as Bento's compact player: the cover beside the title, who made
 * it, its count and length, the first tracks, the rest behind a closed
 * disclosure, and its link.
 */
function Albums({ works, ctx, section, input }: ListProps) {
  const track = (item: NonNullable<(typeof works)[number]['tracks']>[number], index: number) => (
    <li key={index}>
      <span className="sb-tracks__title">
        {present(item.url) ? (
          <Out url={item.url} ctx={ctx}>
            {item.title}
          </Out>
        ) : (
          item.title
        )}
      </span>
      {item.durationSeconds !== undefined ? (
        <span className="sb-tracks__time">{trackTime(item.durationSeconds)}</span>
      ) : null}
    </li>
  );
  return (
    <ul className="sb-albums" role="list">
      {works.map((work) => {
        const cover = coverOf(work, ctx, false, 'sb-album__cover');
        return (
          <li
            key={work.id}
            id={recordAnchor(section, work, input)}
            className="sb-album"
            lang={work.lang}
          >
            {cover ? <div className="sb-album__media">{cover}</div> : null}
            <div className="sb-album__body">
              <Title work={work} ctx={ctx} className="sb-strong" />
              <Facts
                className="sb-label"
                parts={[
                  work.artist,
                  work.label,
                  work.releasedAt !== undefined ? (
                    <DateText raw={work.releasedAt} ctx={ctx} field="releasedAt" />
                  ) : null,
                ]}
              />
              {work.tracks?.length ? (
                <>
                  <p className="sb-label" lang={ctx.uiLang}>
                    {tracksWords(work.tracks)}
                  </p>
                  <ol className="sb-tracks">{work.tracks.slice(0, TRACKS_SHOWN).map(track)}</ol>
                  {work.tracks.length > TRACKS_SHOWN ? (
                    <details className="sb-album__more">
                      <summary className="sb-label" lang={ctx.uiLang}>
                        {work.tracks.length - TRACKS_SHOWN} more
                      </summary>
                      <ol className="sb-tracks" start={TRACKS_SHOWN + 1}>
                        {work.tracks
                          .slice(TRACKS_SHOWN)
                          .map((item, index) => track(item, index + TRACKS_SHOWN))}
                      </ol>
                    </details>
                  ) : null}
                </>
              ) : null}
              {present(work.description) ? (
                <RichText source={work.description} input={input} className="sb-quiet" />
              ) : null}
              <LinkRow links={work.links} ctx={ctx} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Anything else: a plate a work, its cover, title, summary, and links. */
function Plates({ works, ctx, section, input }: ListProps) {
  return (
    <ul className="sb-plates" role="list">
      {works.map((work) => (
        <li
          key={work.id}
          id={recordAnchor(section, work, input)}
          className="sb-plate"
          lang={work.lang}
        >
          {coverOf(work, ctx, false, 'sb-plate__cover')}
          <WorkFacts work={work} ctx={ctx} className="sb-label" />
          <Title work={work} ctx={ctx} className="sb-strong" />
          {present(work.summary) ? (
            <RichText source={work.summary} input={input} className="sb-quiet" />
          ) : present(work.description) ? (
            <RichText source={work.description} input={input} className="sb-quiet" />
          ) : null}
          <div className="sb-work__foot">
            <CaseLink work={work} ctx={ctx} />
            <LinkRow links={work.links} ctx={ctx} />
            <AddressRow
              items={[
                [work.audioUrl, 'Listen'],
                [work.videoUrl, 'Watch'],
              ]}
              ctx={ctx}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

interface ListProps {
  readonly works: readonly Work[];
  readonly ctx: RenderContext;
  readonly section: SectionOf<'works'>;
  readonly input: WorksProps['input'];
}

/** A works section on a board: one tile, shaped by what it mostly holds. */
export function Works({ section, input, level }: WorksProps) {
  const ctx = renderContext(input, section, level);
  const works = worksOf(section, input);
  const medium = worksMedium(section, input);
  const List =
    medium === 'writing'
      ? Entries
      : medium === 'audio-video'
        ? Episodes
        : medium === 'image-series' || medium === 'photography'
          ? Photos
          : medium === 'music'
            ? Albums
            : Plates;
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <List works={works} ctx={ctx} section={section} input={input} />
    </>
  );
}
