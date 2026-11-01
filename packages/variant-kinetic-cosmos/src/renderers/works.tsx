import type { Work } from '@portfolio/schema';
import { formatEpisodeDuration, formatTrackDuration } from '@portfolio/kit';
import {
  DateText,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  isArchived,
  isRoutedWork,
  isSignature,
  MaybeLink,
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
import { ArcBodies } from '../bodies';
import { FoldOnPhone } from '../fold';
import { Facts, LinkRow, Phrase, RuledList, UrlRow, placedPhoto } from '../parts';

// Works in Kinetic Cosmos (redesign, stream E). A section's works take the
// shape their medium has: the signature work is a body with its moons, its
// cover in an orbit and its highlights hung from it on leaders; other works
// are plates or, archived, typographic bodies; writing is a set of display
// rows; episodes are columns, each with a bar its length; a photo series is
// a hang of its pictures; and a release is its sleeve beside its tracklist.
// Every word is the owner's or one of the kit's fixed labels, and nothing
// the shared renderer shows is dropped but the tags.

type Shape = 'showcase' | 'rows' | 'episodes' | 'gallery' | 'record';

const WRITTEN = new Set(['writing', 'research']);

/** The shape a section's works take, from their mediums. */
function shapeOf(works: readonly Work[]): Shape {
  if (works.every((work) => WRITTEN.has(work.medium))) return 'rows';
  if (works.every((work) => work.medium === 'audio-video')) return 'episodes';
  const only = works.length === 1 ? works[0]! : undefined;
  if (only?.tracks?.length) return 'record';
  if (only && (only.media?.length ?? 0) > 1) return 'gallery';
  return 'showcase';
}

/** The link to a work's own page, under its fixed label. */
function CaseLink({ work, ctx, emphasis }: { work: Work; ctx: RenderContext; emphasis?: boolean }) {
  if (!isRoutedWork(work)) return null;
  return (
    <a
      className={emphasis ? 'kc-button kc-button--solid' : 'kc-link-action'}
      href={routeHref(ctx.input, { route: 'work', slug: work.slug })}
    >
      <Ui ctx={ctx}>Read the case study</Ui>
    </a>
  );
}

/** When a work was: its period, else when it was published or released. */
function When({ work, ctx }: { work: Work; ctx: RenderContext }) {
  if (work.period) return <PeriodText period={work.period} ctx={ctx} />;
  if (work.publishedAt) return <DateText raw={work.publishedAt} ctx={ctx} field="publishedAt" />;
  if (work.releasedAt) return <DateText raw={work.releasedAt} ctx={ctx} field="releasedAt" />;
  return null;
}

function hasWhen(work: Work): boolean {
  return Boolean(work.period ?? work.publishedAt ?? work.releasedAt);
}

/** The facts of a work as ruled rows, labelled with the kit's words. */
function WorkFacts({ work, ctx }: { work: Work; ctx: RenderContext }) {
  return (
    <Facts
      rows={[
        [
          <Ui key="l" ctx={ctx}>
            Role
          </Ui>,
          work.role,
          'role',
        ],
        [
          <Ui key="l" ctx={ctx}>
            Organization
          </Ui>,
          work.organization,
          'organization',
        ],
        [
          <Ui key="l" ctx={ctx}>
            When
          </Ui>,
          hasWhen(work) ? <When key="v" work={work} ctx={ctx} /> : null,
          'when',
        ],
        [
          <Ui key="l" ctx={ctx}>
            Built with
          </Ui>,
          work.tools?.length ? formatNames(work.tools, ctx) : undefined,
          'tools',
        ],
      ]}
    />
  );
}

/** The work's words: summary, excerpt, and description, in that order. */
function Words({
  work,
  ctx,
  lede,
  fold,
}: {
  work: Work;
  ctx: RenderContext;
  lede?: boolean;
  /** Fold the long description under a disclosure on a phone (KC-S6). */
  fold?: boolean;
}) {
  const { input } = ctx;
  const hasLong = present(work.description) || present(work.showNotes);
  const long = hasLong ? (
    <>
      {present(work.description) ? (
        <RichText source={work.description} className="kc-prose" input={input} />
      ) : null}
      {present(work.showNotes) ? (
        <RichText source={work.showNotes} className="kc-prose" input={input} />
      ) : null}
    </>
  ) : null;
  return (
    <>
      {present(work.summary) ? (
        <RichText source={work.summary} className={lede ? 'kc-lede' : 'kc-summary'} input={input} />
      ) : null}
      {present(work.excerpt) ? (
        <blockquote className="kc-excerpt">
          <RichText source={work.excerpt} input={input} />
        </blockquote>
      ) : null}
      {long && fold ? (
        <FoldOnPhone className="kc-fold--inline" summary={<Ui ctx={ctx}>More about it</Ui>}>
          {long}
        </FoldOnPhone>
      ) : (
        long
      )}
    </>
  );
}

/** The work's own links, and its audio and video by address. */
function Outbound({ work, ctx }: { work: Work; ctx: RenderContext }) {
  // An episode's links say which episode they open.
  const subject =
    work.number !== undefined ? `episode ${formatFigure(work.number, ctx)}` : undefined;
  return (
    <>
      <UrlRow
        urls={[
          ['audioUrl', work.audioUrl],
          ['videoUrl', work.videoUrl],
        ]}
        ctx={ctx}
        {...(subject !== undefined ? { subject } : {})}
      />
      <LinkRow links={work.links} ctx={ctx} />
    </>
  );
}

/**
 * The signature work: its cover inside an orbit whose back arc passes
 * behind it and whose front arc runs before it, and its highlights as moons
 * on that arc, each hung on a leader above its plate.
 */
/** The signature body itself: the cover in its orbit, and the first highlights as its moons. */
export function SignatureSystem({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const cover = placedPhoto(work.cover ?? work.media?.[0], ctx);
  const moons = (work.highlights ?? []).filter(present).slice(0, 3);
  return (
    <div className="kc-signature__system">
      {cover ? (
        <MediaFigure
          placed={cover}
          ctx={ctx}
          className="kc-cover"
          eager
          sizes="(min-width: 64rem) 52vw, 100vw"
        />
      ) : (
        <span className="kc-signature__core" aria-hidden="true" />
      )}
      <ArcBodies items={moons.map((moon, index) => ({ key: String(index), plate: moon }))} />
    </div>
  );
}

function SignatureBody({ work, ctx, anchor }: { work: Work; ctx: RenderContext; anchor?: string }) {
  const rest = (work.highlights ?? []).filter(present).slice(3);
  return (
    <li
      id={anchor}
      className="kc-work kc-work--signature"
      data-medium={work.medium}
      lang={work.lang}
    >
      <SignatureSystem work={work} ctx={ctx} />
      <div className="kc-work__text">
        <Heading level={ctx.itemLevel} className="kc-work__title">
          <MaybeLink url={work.url} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </Heading>
        <Words work={work} ctx={ctx} fold />
        <WorkFacts work={work} ctx={ctx} />
        <RuledList items={rest} />
        <div className="kc-actions">
          <CaseLink work={work} ctx={ctx} emphasis />
          <Outbound work={work} ctx={ctx} />
        </div>
      </div>
    </li>
  );
}

/** Any other work: a plate with its cover, or with none, a typographic body. */
function WorkBody({ work, ctx, anchor }: { work: Work; ctx: RenderContext; anchor?: string }) {
  const cover = placedPhoto(work.cover ?? work.media?.[0], ctx);
  const archived = isArchived(work, ctx.input);
  const plate = cover !== undefined && !archived;
  return (
    <li
      id={anchor}
      className={plate ? 'kc-work kc-work--plate' : 'kc-work kc-work--type'}
      data-medium={work.medium}
      lang={work.lang}
    >
      {plate ? (
        <div className="kc-work__media">
          <MediaFigure
            placed={cover}
            ctx={ctx}
            className="kc-cover"
            sizes="(min-width: 64rem) 40vw, 100vw"
          />
          <Phrase
            className="kc-caption"
            role="label"
            parts={[work.organization ?? work.role, <When key="when" work={work} ctx={ctx} />]}
          />
        </div>
      ) : null}
      <div className="kc-work__text">
        {archived ? (
          <p className="kc-work__label" data-type-role="label">
            <Ui ctx={ctx}>Archive</Ui>
          </p>
        ) : null}
        <Heading level={ctx.itemLevel} className="kc-work__title">
          <MaybeLink url={work.url} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </Heading>
        <Words work={work} ctx={ctx} lede={!plate} />
        {plate ? null : <WorkFacts work={work} ctx={ctx} />}
        <RuledList items={work.highlights} />
        <div className="kc-actions">
          <CaseLink work={work} ctx={ctx} />
          <Outbound work={work} ctx={ctx} />
        </div>
      </div>
    </li>
  );
}

/**
 * Writing as display rows: a body on the row's line, the title at display
 * size, and its facts as one phrase under it, then its standfirst.
 */
function WritingRow({ work, ctx, anchor }: { work: Work; ctx: RenderContext; anchor?: string }) {
  return (
    <li id={anchor} className="kc-row" data-medium={work.medium} lang={work.lang}>
      <span className="kc-row__body" aria-hidden="true" />
      <div className="kc-row__main">
        <Heading level={ctx.itemLevel} className="kc-row__title">
          <MaybeLink url={work.url} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </Heading>
        <Phrase
          className="kc-row__facts"
          role="label"
          parts={[
            work.publication,
            work.publishedAt !== undefined && (
              <DateText key="published" raw={work.publishedAt} ctx={ctx} field="publishedAt" />
            ),
            work.period && <PeriodText key="period" period={work.period} ctx={ctx} />,
            work.readingTimeMinutes !== undefined && (
              <span key="reading" data-field="readingTimeMinutes">
                {formatMinutes(work.readingTimeMinutes, ctx)}
              </span>
            ),
          ]}
        />
        {/* Its words in a part of their own, so a wide ring hangs them beside the title (KIN-6). */}
        <div className="kc-row__words">
          <Words work={work} ctx={ctx} />
          <div className="kc-actions">
            <CaseLink work={work} ctx={ctx} />
            <Outbound work={work} ctx={ctx} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** An episode: its number and date, a bar its length against the longest, its title and notes. */
function Episode({
  work,
  ctx,
  anchor,
  longest,
}: {
  work: Work;
  ctx: RenderContext;
  anchor?: string;
  longest: number;
}) {
  const share =
    work.durationMinutes !== undefined && longest > 0 ? work.durationMinutes / longest : undefined;
  return (
    <li id={anchor} className="kc-episode" data-medium={work.medium} lang={work.lang}>
      <p className="kc-episode__head" data-type-role="label">
        <span>
          {present(work.series) ? <>{work.series} </> : null}
          {work.number !== undefined ? (
            <data value={work.number}>{formatFigure(work.number, ctx)}</data>
          ) : null}
        </span>
        <When work={work} ctx={ctx} />
      </p>
      {share !== undefined ? (
        <span className="kc-episode__bar" aria-hidden="true">
          <span
            className="kc-episode__fill"
            style={{ inlineSize: `${(share * 100).toFixed(1)}%` }}
          />
        </span>
      ) : null}
      <Heading level={ctx.itemLevel} className="kc-episode__title">
        <MaybeLink url={work.url} ctx={ctx}>
          {work.title}
        </MaybeLink>
      </Heading>
      <Words work={work} ctx={ctx} />
      <Phrase
        className="kc-episode__meta"
        role="label"
        parts={[
          work.durationMinutes !== undefined && (
            <Ui key="duration" ctx={ctx}>
              {formatEpisodeDuration(work.durationMinutes)}
            </Ui>
          ),
          work.guests?.length ? (
            <span key="guests" data-field="guests">
              {formatNames(work.guests, ctx)}
            </span>
          ) : null,
        ]}
      />
      <div className="kc-actions">
        <CaseLink work={work} ctx={ctx} />
        <Outbound work={work} ctx={ctx} />
      </div>
    </li>
  );
}

/** A photo series: its pictures hung in one row, the first wider, each with its caption. */
function Gallery({
  work,
  ctx,
  anchor,
  sectionTitle,
}: {
  work: Work;
  ctx: RenderContext;
  anchor?: string;
  sectionTitle?: string;
}) {
  const repeats = sectionTitle?.trim().toLowerCase() === work.title.trim().toLowerCase();
  const placed = (work.media ?? []).flatMap((placement) => {
    const image = placedPhoto(placement, ctx);
    return image ? [image] : [];
  });
  return (
    <li id={anchor} className="kc-series" data-medium={work.medium} lang={work.lang}>
      {repeats ? null : (
        <Heading level={ctx.itemLevel} className="kc-series__title">
          <MaybeLink url={work.url} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </Heading>
      )}
      <Words work={work} ctx={ctx} />
      <ul className="kc-hang" role="list" data-count={Math.min(placed.length, 4)}>
        {placed.map((image, index) => (
          <li key={`${image.asset}-${index}`} className="kc-hang__item">
            <MediaFigure
              placed={image}
              ctx={ctx}
              className="kc-hang__image"
              sizes="(min-width: 64rem) 33vw, 100vw"
            />
          </li>
        ))}
      </ul>
      <Outbound work={work} ctx={ctx} />
    </li>
  );
}

/** A release: its sleeve, then its title, words, and tracklist with tabular lengths. */
function Release({ work, ctx, anchor }: { work: Work; ctx: RenderContext; anchor?: string }) {
  const cover = placedPhoto(work.cover ?? work.media?.[0], ctx);
  return (
    <li id={anchor} className="kc-release" data-medium={work.medium} lang={work.lang}>
      {cover ? (
        <div className="kc-release__sleeve">
          <MediaFigure
            placed={cover}
            ctx={ctx}
            className="kc-cover"
            sizes="(min-width: 64rem) 30vw, 100vw"
          />
        </div>
      ) : null}
      <div className="kc-release__text">
        <Heading level={ctx.itemLevel} className="kc-work__title">
          <MaybeLink url={work.url} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </Heading>
        <Words work={work} ctx={ctx} />
        <Phrase
          className="kc-caption"
          role="label"
          parts={[work.artist, work.label, <When key="when" work={work} ctx={ctx} />]}
        />
        <FoldOnPhone
          className="kc-fold--inline"
          summary={<Ui ctx={ctx}>{`${work.tracks!.length} tracks`}</Ui>}
        >
          <ol className="kc-tracks">
            {work.tracks!.map((track, index) => (
              <li key={index} className="kc-track">
                <span className="kc-track__number" aria-hidden="true">
                  {formatFigure(index + 1, ctx)}
                </span>
                <span className="kc-track__title">
                  <MaybeLink url={track.url} ctx={ctx}>
                    {track.title}
                  </MaybeLink>
                </span>
                {track.durationSeconds !== undefined ? (
                  <span className="kc-track__length">
                    {formatTrackDuration(track.durationSeconds)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </FoldOnPhone>
        <Outbound work={work} ctx={ctx} />
      </div>
    </li>
  );
}

export function WorksBodies({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const ctx = renderContext(input, section, level);
  const works = worksOf(section, input);
  const shape = shapeOf(works);
  const anchor = (work: Work) => recordAnchor(section, work, input);
  if (shape === 'rows') {
    return (
      <ul className="kc-rows" role="list">
        {works.map((work) => (
          <WritingRow key={work.id} work={work} ctx={ctx} anchor={anchor(work)} />
        ))}
      </ul>
    );
  }
  if (shape === 'episodes') {
    const longest = Math.max(0, ...works.map((work) => work.durationMinutes ?? 0));
    return (
      <ul className="kc-episodes" role="list">
        {works.map((work) => (
          <Episode key={work.id} work={work} ctx={ctx} anchor={anchor(work)} longest={longest} />
        ))}
      </ul>
    );
  }
  if (shape === 'gallery' || shape === 'record') {
    const work = works[0]!;
    return (
      <ul className="kc-single" role="list">
        {shape === 'gallery' ? (
          <Gallery work={work} ctx={ctx} anchor={anchor(work)} sectionTitle={section.title} />
        ) : (
          <Release work={work} ctx={ctx} anchor={anchor(work)} />
        )}
      </ul>
    );
  }
  return (
    <ul className="kc-works" role="list">
      {works.map((work) =>
        isSignature(work, input) ? (
          <SignatureBody key={work.id} work={work} ctx={ctx} anchor={anchor(work)} />
        ) : (
          <WorkBody key={work.id} work={work} ctx={ctx} anchor={anchor(work)} />
        ),
      )}
    </ul>
  );
}
