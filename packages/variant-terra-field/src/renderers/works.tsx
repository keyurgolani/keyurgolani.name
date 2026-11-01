import type { Work } from '@portfolio/schema';
import {
  DateText,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  hrefFor,
  MediaFigure,
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
import { chromeIds, idOf, MEDIUM_WORDS, said, workHref, worksForm } from '../model';
import { Line, linkText, Links, Out, Words } from '../parts';
import type { Env } from './env';

// Works, by medium (brief §5.5): every work in a mixed section takes the
// one series template (S5: one form, no labelled works hung on walls), an
// audio and video section is an episode log, photographs a gallery under
// one caption system, music a sleeve and its tracks, and writing three
// reading columns. The signature work, already a plate in the anchor band,
// is a one-line back-reference where its section lists it (TF-M8, N6),
// keeping its anchor.

type Props = SectionRendererProps<SectionOf<'works'>> & { readonly env: Env };

/** Where a work's title goes: its own page, else its own address. */
const titleHref = (work: Work, ctx: RenderContext) =>
  workHref(work, ctx.input) ?? (work.url ? hrefFor(work.url, ctx.input) : undefined);

/** The work's links: its own, then its audio or video. */
function workLinks(work: Work) {
  return [
    ...(work.links ?? []).map((link) => ({ url: link.url, text: linkText(link) })),
    ...(work.audioUrl ? [{ url: work.audioUrl, text: 'Listen' }] : []),
    ...(work.videoUrl ? [{ url: work.videoUrl, text: 'Watch' }] : []),
  ];
}

/** When the work is from: its date, or since its period's start. */
export function When({
  work,
  ctx,
  since = false,
}: {
  work: Work;
  ctx: RenderContext;
  since?: boolean;
}) {
  if (work.publishedAt !== undefined) return <DateText raw={work.publishedAt} ctx={ctx} />;
  if (work.releasedAt !== undefined) return <DateText raw={work.releasedAt} ctx={ctx} />;
  if (work.period?.start !== undefined) {
    return since && work.period.end === undefined ? (
      <>
        <Words lang={ctx.uiLang}>since</Words> <DateText raw={work.period.start} ctx={ctx} />
      </>
    ) : (
      <DateText raw={work.period.start} ctx={ctx} />
    );
  }
  return null;
}

/** A work's one kicker (S1): its curation word, its medium, since when, in one line. */
function Kicker({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { portfolio } = ctx.input;
  const curated = portfolio.featured.includes(work.id)
    ? 'Featured'
    : portfolio.archive.includes(work.id)
      ? 'From the archive'
      : undefined;
  const medium = MEDIUM_WORDS[work.medium];
  const when = <When work={work} ctx={ctx} since />;
  return (
    <p className="tf-kicker tf-label">
      {curated ? (
        <strong>
          <Words lang={ctx.uiLang}>{curated}</Words>
        </strong>
      ) : null}
      {curated && (medium || work.period || work.publishedAt) ? ', ' : null}
      {medium ? <Words lang={ctx.uiLang}>{curated ? medium.toLowerCase() : medium}</Words> : null}
      {medium && (work.period?.start || work.publishedAt || work.releasedAt) ? ', ' : null}
      {when}
    </p>
  );
}

/** The signature work's line where its section lists it: a reference back to its plate. */
function BackReference({
  work,
  section,
  ctx,
  plate,
}: {
  work: Work;
  section: SectionOf<'works'>;
  ctx: RenderContext;
  plate?: string;
}) {
  const href = plate ?? workHref(work, ctx.input);
  return (
    <p
      className="tf-backref tf-compact"
      id={recordAnchor(section, work, ctx.input)}
      lang={work.lang}
    >
      <Words lang={ctx.uiLang}>The signature work, in the opening:</Words>{' '}
      {href ? <a href={href}>{work.title}</a> : work.title}
    </p>
  );
}

/** The series template: one form every work in a mixed section takes. */
function Entry({
  work,
  section,
  ctx,
}: {
  work: Work;
  section: SectionOf<'works'>;
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  const href = titleHref(work, ctx);
  const routed = workHref(work, input);
  const standfirst = work.excerpt ?? (cover ? undefined : work.description);
  const facts: [string, string][] = [
    ...(said(work.role) ? ([['Role', work.role]] as [string, string][]) : []),
    ...(said(work.organization) ? ([['With', work.organization]] as [string, string][]) : []),
    ...(work.tools?.length ? ([['Tools', work.tools.join(', ')]] as [string, string][]) : []),
  ];
  return (
    <article
      className="tf-entry"
      id={recordAnchor(section, work, input)}
      lang={work.lang}
      data-lead={cover ? 'media' : present(standfirst) ? 'words' : 'none'}
    >
      <div className="tf-entry__text">
        <Kicker work={work} ctx={ctx} />
        <Heading level={ctx.itemLevel} className="tf-headline tf-entry__title">
          {href ? <a href={href}>{work.title}</a> : work.title}
        </Heading>
        {present(work.summary) ? (
          <RichText source={work.summary} className="tf-entry__sum" input={input} />
        ) : null}
        {work.highlights?.length ? (
          <ul className="tf-ruled tf-compact" role="list">
            {work.highlights
              .filter(present)
              .slice(0, 3)
              .map((item, index) => (
                <li key={index}>{item}</li>
              ))}
          </ul>
        ) : null}
        {facts.length > 0 ? (
          <dl className="tf-facts tf-compact">
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt>
                  <Words lang={ctx.uiLang}>{term}</Words>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="tf-entry__links tf-compact">
          {routed ? (
            <a href={routed}>
              <Words lang={ctx.uiLang}>Read the case study</Words>
            </a>
          ) : null}
          <Links
            links={workLinks(work).filter((link) => hrefFor(link.url, input) !== href)}
            input={input}
          />
        </div>
      </div>
      {cover ? (
        <div className="tf-entry__lead tf-frame">
          <MediaFigure placed={cover} ctx={ctx} inline sizes="(min-width: 48rem) 45vw, 100vw" />
        </div>
      ) : present(standfirst) ? (
        <blockquote className="tf-entry__lead tf-standfirst">
          <RichText source={standfirst} className="tf-quote" input={input} />
        </blockquote>
      ) : null}
    </article>
  );
}

function Series({
  section,
  ctx,
  env,
}: {
  section: SectionOf<'works'>;
  ctx: RenderContext;
  env: Env;
}) {
  const works = worksOf(section, ctx.input);
  const signature = ctx.input.portfolio.signature;
  // The signature is a plate in the band when the band shows it, as companion or photograph.
  const plated = env.model.band.companions.findIndex((companion) => idOf(companion) === signature);
  const inBand = plated !== -1 || env.model.band.photo?.work.id === signature;
  const plate =
    plated !== -1
      ? `#${chromeIds(ctx.input.ids.prefix).companion(plated)}`
      : env.model.band.photo?.work.id === signature
        ? `#${chromeIds(ctx.input.ids.prefix).band}`
        : undefined;
  return (
    <div className="tf-series">
      {works.map((work) =>
        work.id === signature && inBand ? (
          <BackReference key={work.id} work={work} section={section} ctx={ctx} plate={plate} />
        ) : (
          <Entry key={work.id} work={work} section={section} ctx={ctx} />
        ),
      )}
    </div>
  );
}

/** Audio and video: the episode log, one ruled row a recording. */
function Episodes({ section, ctx }: { section: SectionOf<'works'>; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ol className="tf-log" role="list">
      {worksOf(section, input).map((work) => {
        const href = titleHref(work, ctx);
        const listen = work.audioUrl ?? work.videoUrl;
        return (
          <li key={work.id} id={recordAnchor(section, work, input)} lang={work.lang}>
            <p className="tf-log__no tf-title tf-num">
              {work.number !== undefined ? (
                <>
                  <Words lang={ctx.uiLang}>No.</Words> {formatFigure(work.number, ctx)}
                </>
              ) : null}
            </p>
            <div className="tf-log__main">
              <Heading level={ctx.itemLevel} className="tf-title tf-log__title">
                {href ? <Out href={href}>{work.title}</Out> : work.title}
              </Heading>
              {present(work.description) ? (
                <RichText
                  source={work.description}
                  className="tf-compact tf-second"
                  input={input}
                />
              ) : present(work.summary) ? (
                <RichText source={work.summary} className="tf-compact tf-second" input={input} />
              ) : null}
              {work.guests?.length ? (
                <p className="tf-compact tf-muted">
                  <Words lang={ctx.uiLang}>With</Words> {formatNames(work.guests, ctx)}
                </p>
              ) : null}
            </div>
            <p className="tf-log__date tf-compact">
              {work.publishedAt !== undefined ? (
                <DateText raw={work.publishedAt} ctx={ctx} />
              ) : null}
            </p>
            <p className="tf-log__len tf-compact">
              {work.durationMinutes !== undefined ? (
                <span className="tf-num">{formatMinutes(work.durationMinutes, ctx)}</span>
              ) : null}
              {listen && hrefFor(listen, input) !== href ? (
                <Out href={hrefFor(listen, input)}>
                  <Words lang={ctx.uiLang}>{work.audioUrl ? 'Listen' : 'Watch'}</Words>
                </Out>
              ) : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Photographs: one large and its companions, every frame under the one caption system. */
function Gallery({ section, ctx }: { section: SectionOf<'works'>; ctx: RenderContext }) {
  const { input } = ctx;
  const works = worksOf(section, input);
  const titled = works.length > 1 || works.some((work) => work.title !== section.title);
  return (
    <>
      {works.map((work) => {
        const frames = (work.media ?? []).filter((placement) => placedMedia(placement, ctx));
        return (
          <div
            key={work.id}
            className="tf-gallery"
            id={recordAnchor(section, work, input)}
            role="group"
            aria-label={work.title}
            lang={work.lang}
            data-count={Math.min(frames.length, 4)}
          >
            {titled ? (
              <Heading level={ctx.itemLevel} className="tf-title tf-gallery__title">
                {titleHref(work, ctx) ? (
                  <Out href={titleHref(work, ctx)!}>{work.title}</Out>
                ) : (
                  work.title
                )}
              </Heading>
            ) : null}
            {frames.map((placement, index) => {
              const placed = placedMedia(placement, ctx)!;
              return (
                <figure key={index} className="tf-gallery__frame">
                  <div className="tf-frame">
                    <MediaFigure
                      placed={{ ...placed, caption: undefined }}
                      ctx={ctx}
                      inline
                      sizes={
                        index === 0
                          ? '(min-width: 48rem) 60vw, 100vw'
                          : '(min-width: 48rem) 30vw, 50vw'
                      }
                    />
                  </div>
                  <figcaption className="tf-cap">
                    {present(placement.caption) ? (
                      <span className="tf-caption">{placement.caption}</span>
                    ) : null}
                    <Line
                      className="tf-compact tf-muted"
                      parts={[
                        placement.location,
                        placement.takenAt !== undefined ? (
                          <DateText key="t" raw={placement.takenAt} ctx={ctx} />
                        ) : null,
                      ]}
                    />
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

/** Music: the sleeve, and its record and tracks beside it. */
function Sleeve({ section, ctx }: { section: SectionOf<'works'>; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <>
      {worksOf(section, input).map((work) => {
        const cover = placedImage(work.cover ?? work.media?.[0], input);
        const tracks = work.tracks ?? [];
        const href = titleHref(work, ctx);
        return (
          <article
            key={work.id}
            className="tf-sleeve"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
            data-cover={cover ? undefined : 'none'}
          >
            {cover ? (
              <div className="tf-sleeve__cover tf-frame">
                <MediaFigure
                  placed={cover}
                  ctx={ctx}
                  inline
                  sizes="(min-width: 48rem) 30vw, 60vw"
                />
              </div>
            ) : null}
            <div className="tf-sleeve__text">
              <Heading level={ctx.itemLevel} className="tf-headline">
                {href ? <Out href={href}>{work.title}</Out> : work.title}
              </Heading>
              <Line
                className="tf-compact tf-second"
                parts={[work.artist, work.label, <When key="w" work={work} ctx={ctx} />, work.role]}
              />
              {present(work.description) ? (
                <RichText source={work.description} className="tf-sleeve__desc" input={input} />
              ) : present(work.summary) ? (
                <RichText source={work.summary} className="tf-sleeve__desc" input={input} />
              ) : null}
              {tracks.length > 0 ? (
                <ol className="tf-tracks tf-ruled tf-compact">
                  {tracks.map((track, index) => (
                    <li key={index}>
                      <span>
                        {track.url ? (
                          <Out href={hrefFor(track.url, input)}>{track.title}</Out>
                        ) : (
                          track.title
                        )}
                      </span>
                      {track.durationSeconds !== undefined ? (
                        <span className="tf-num">{trackTime(track.durationSeconds)}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <Links
                links={workLinks(work).filter((link) => hrefFor(link.url, input) !== href)}
                input={input}
              />
            </div>
          </article>
        );
      })}
    </>
  );
}

/** Writing: reading columns with hairlines between them, each its date, title, and pulled line. */
function Essays({ section, ctx }: { section: SectionOf<'works'>; ctx: RenderContext }) {
  const { input } = ctx;
  const works = worksOf(section, input);
  return (
    <div className="tf-essays" data-count={Math.min(works.length, 3)}>
      {works.map((work) => {
        const href = titleHref(work, ctx);
        return (
          <article
            key={work.id}
            className="tf-essay"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            <p className="tf-label tf-muted">
              <When work={work} ctx={ctx} />
              {work.readingTimeMinutes !== undefined ? (
                <>
                  {', '}
                  <Words
                    lang={ctx.uiLang}
                  >{`${formatFigure(work.readingTimeMinutes, ctx)} min read`}</Words>
                </>
              ) : null}
            </p>
            <Heading level={ctx.itemLevel} className="tf-title tf-essay__title">
              {href ? <Out href={href}>{work.title}</Out> : work.title}
            </Heading>
            {present(work.excerpt) ? (
              <blockquote className="tf-essay__pull">
                <RichText source={work.excerpt} className="tf-quote" input={input} />
              </blockquote>
            ) : null}
            {present(work.summary) ? (
              <RichText source={work.summary} className="tf-compact tf-second" input={input} />
            ) : null}
            {said(work.publication) ? (
              <p className="tf-compact tf-muted">{work.publication}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function WorksBody({ section, input, level, env }: Props) {
  const ctx = renderContext(input, section, level);
  switch (worksForm(section, input)) {
    case 'episodes':
      return <Episodes section={section} ctx={ctx} />;
    case 'gallery':
      return <Gallery section={section} ctx={ctx} />;
    case 'sleeve':
      return <Sleeve section={section} ctx={ctx} />;
    case 'essays':
      return <Essays section={section} ctx={ctx} />;
    default:
      return <Series section={section} ctx={ctx} env={env} />;
  }
}
