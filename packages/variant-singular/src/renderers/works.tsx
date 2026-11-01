import {
  MediaFigure,
  placedImage,
  renderContext,
  worksOf,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { Work } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  backPointer,
  formatNumber,
  linkText,
  listAnd,
  minutesSeconds,
  PANEL_WORDS,
  planOf,
  present,
  squash,
  workLink,
} from '../model';
import { WorkMeta } from '../panels/more-work';
import { hrefOf, ownId, Phrase, Prose, uiLang, urlHref, When, Words } from '../parts';
import { Entries, Entry, Facts } from './entry';

// The record's works (brief §5.7, step 5): a works section whose works the
// panels already show is one back-pointer line ("… are above, in Best work
// and More work"); a single photo series is a gallery of its frames under
// one caption system; a single album is its cover and its tracklist; any
// other is a list of entries, each title linking to the work's own page or
// address.

const deeper = (level: number) => Math.min(6, level + 1) as 3 | 4 | 5 | 6;

function BackPointer({
  input,
  works,
  where,
}: {
  input: VariantRenderInput;
  works: readonly Work[];
  where: readonly ('best' | 'more')[];
}) {
  const lang = uiLang(input.portfolio.locale);
  const { panels } = planOf(input);
  const anchorOf = (key: 'best' | 'more') => panels.find((panel) => panel.key === key)!.anchor;
  return (
    <p className="sg-rec__line sg-rec__back">
      {listAnd(works.map((work) => squash(work.title)))}{' '}
      <Words lang={lang}>{works.length > 1 ? 'are above, in' : 'is above, in'}</Words>{' '}
      {where.map((key, i) => (
        <span key={key}>
          {i > 0 ? <Words lang={lang}> and </Words> : null}
          <a href={`#${ownId(input.ids.prefix, anchorOf(key))}`}>
            <Words lang={lang}>{PANEL_WORDS[key]}</Words>
          </a>
        </span>
      ))}
      .
    </p>
  );
}

function Gallery({ input, work, level }: { input: VariantRenderInput; work: Work; level: number }) {
  const ctx = renderContext(input, { id: work.id, title: work.title }, deeper(level - 1));
  const frames = (work.media ?? [])
    .map((placement) => ({ placement, image: placedImage(placement, input, placement.caption) }))
    .filter((frame) => frame.image !== undefined);
  return (
    <div className="sg-gallery">
      <p className="sg-rec__line">
        <b>{squash(work.title)}</b>
        {present(work.summary) ? (
          <>
            {' '}
            <Phrase source={work.summary} input={input} />
          </>
        ) : null}
      </p>
      <ul className="sg-gallery__frames" role="list">
        {frames.map(({ placement, image }) => (
          <li key={placement.asset}>
            <MediaFigure placed={image!} ctx={ctx} sizes="(min-width: 48rem) 30vw, 100vw" />
            {present(placement.location) ||
            placement.takenAt ||
            (placement.tags ?? []).some(present) ? (
              <p className="sg-gallery__where">
                <Facts
                  parts={[
                    present(placement.location) ? squash(placement.location) : null,
                    placement.takenAt ? <When raw={placement.takenAt} input={input} /> : null,
                    ...(placement.tags ?? []).filter(present).map(squash),
                  ]}
                />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Album({ input, work, level }: { input: VariantRenderInput; work: Work; level: number }) {
  const ctx = renderContext(input, { id: work.id, title: work.title }, deeper(level - 1));
  const cover = placedImage(work.cover, input);
  const link = workLink(work);
  const tracks = work.tracks ?? [];
  const Heading = `h${deeper(level)}` as 'h4';
  const lang = uiLang(input.portfolio.locale);
  return (
    <div className="sg-album" lang={work.lang}>
      {cover ? (
        <div className="sg-album__cover">
          <MediaFigure placed={cover} ctx={ctx} sizes="(min-width: 48rem) 15vw, 50vw" />
        </div>
      ) : null}
      <div className="sg-album__text">
        <Heading className="sg-entry__title">
          {link ? <a href={hrefOf(link, input)}>{squash(work.title)}</a> : squash(work.title)}
        </Heading>
        {present(work.description) || present(work.summary) ? (
          <p className="sg-rec__muted">
            <Phrase source={(work.description ?? work.summary)!} input={input} />
          </p>
        ) : null}
        <p className="sg-rec__muted">
          <Facts
            parts={[
              present(work.role) ? squash(work.role) : null,
              present(work.artist) ? squash(work.artist) : null,
              present(work.label) ? squash(work.label) : null,
              work.releasedAt ? <When raw={work.releasedAt} input={input} /> : null,
              tracks.length > 0 ? (
                <Words lang={lang}>
                  {`${formatNumber(tracks.length, input.portfolio.locale)} ${tracks.length === 1 ? 'track' : 'tracks'}`}
                </Words>
              ) : null,
            ]}
          />
        </p>
        {tracks.length > 0 ? (
          <ol className="sg-tracks">
            {tracks.map((track, i) => (
              <li key={`${i}-${track.title}`}>
                <span className="sg-num sg-tracks__n" aria-hidden="true">
                  {formatNumber(i + 1, input.portfolio.locale)}
                </span>
                <span className="sg-tracks__title">
                  {track.url ? (
                    <a href={urlHref(track.url, input)}>{squash(track.title)}</a>
                  ) : (
                    squash(track.title)
                  )}
                </span>
                {track.durationSeconds ? (
                  <span className="sg-num sg-tracks__time">
                    {minutesSeconds(track.durationSeconds)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {(work.links ?? []).some((each) => present(each.url)) ? (
          <p className="sg-rec__links">
            {(work.links ?? [])
              .filter((each) => present(each.url))
              .map((each, i) => (
                <span key={`${i}-${each.url}`}>
                  {i > 0 ? ', ' : null}
                  <a href={urlHref(each.url, input)}>{linkText(each)}</a>
                </span>
              ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What a record entry holds past its title, summary and facts (P2, the
 * content sweep: what the owner wrote that the panels and the case page
 * don't already carry): the role and organization, the publication and
 * series, the description, excerpt and show notes, who took part, the tags
 * and tools, the tracks, the pictures' captions, and the links. Inside a
 * closed row, so the page's length doesn't pay for it.
 */
export function WorkDetail({
  input,
  work,
  level,
  summary,
}: {
  input: VariantRenderInput;
  work: Work;
  level: number;
  /** The text the entry already shows as its summary, so it isn't shown twice. */
  summary?: string;
}) {
  const lang = uiLang(input.portfolio.locale);
  const ctx = renderContext(input, { id: work.id, title: work.title }, deeper(level));
  const words = [work.description, work.excerpt, work.showNotes].filter(
    (text): text is string => present(text) && text !== summary,
  );
  const facts = [
    work.role,
    work.organization,
    work.publication,
    work.series,
    work.artist,
    work.label,
  ]
    .filter(present)
    .map(squash);
  const guests = (work.guests ?? []).filter(present).map(squash);
  const tags = (work.tags ?? []).filter(present).map(squash);
  const tools = (work.tools ?? []).filter(present).map(squash);
  const tracks = (work.tracks ?? []).filter((track) => present(track.title));
  const media = (work.media ?? [])
    .map((placement) => ({ placement, image: placedImage(placement, input, placement.caption) }))
    .filter((frame) => frame.image !== undefined);
  const links = (work.links ?? []).filter((link) => present(link.url));
  return (
    <>
      {facts.length > 0 ? (
        <p className="sg-rec__muted">
          <Facts parts={facts} />
        </p>
      ) : null}
      {words.map((text, i) => (
        <Prose key={i} source={text} input={input} className="sg-rec__prose" />
      ))}
      {guests.length > 0 ? (
        <p className="sg-rec__muted">
          <Words lang={lang}>With</Words> {listAnd(guests)}
        </p>
      ) : null}
      {tools.length > 0 ? (
        <p className="sg-rec__muted">
          <Words lang={lang}>Made with</Words> {listAnd(tools)}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <p className="sg-rec__muted">
          <Words lang={lang}>On</Words> {listAnd(tags)}
        </p>
      ) : null}
      {tracks.length > 0 ? (
        <ol className="sg-tracks">
          {tracks.map((track, i) => (
            <li key={`${i}-${track.title}`}>
              <span className="sg-num sg-tracks__n" aria-hidden="true">
                {formatNumber(i + 1, input.portfolio.locale)}
              </span>
              <span className="sg-tracks__title">
                {track.url ? (
                  <a href={urlHref(track.url, input)}>{squash(track.title)}</a>
                ) : (
                  squash(track.title)
                )}
              </span>
              {track.durationSeconds ? (
                <span className="sg-num sg-tracks__time">
                  {minutesSeconds(track.durationSeconds)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {media.length > 0 ? (
        <ul className="sg-gallery__frames sg-gallery__frames--small" role="list">
          {media.map(({ placement, image }) => (
            <li key={placement.asset}>
              <MediaFigure placed={image!} ctx={ctx} sizes="(min-width: 48rem) 20vw, 50vw" />
              {(placement.tags ?? []).filter(present).length > 0 ? (
                <p className="sg-gallery__where">
                  {listAnd(placement.tags!.filter(present).map(squash))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {links.length > 0 ? (
        <p className="sg-rec__links">
          {links.map((link, i) => (
            <span key={`${i}-${link.url}`}>
              {i > 0 ? ', ' : null}
              <a href={urlHref(link.url, input)}>{linkText(link)}</a>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

export function WorkEntries({
  input,
  works,
  level,
}: {
  input: VariantRenderInput;
  works: readonly Work[];
  level: number;
}) {
  return (
    <Entries>
      {works.map((work) => {
        const link = workLink(work);
        const summary = [work.summary, work.excerpt, work.description].find(present);
        return (
          <Entry
            key={work.id}
            title={squash(work.title)}
            href={link ? hrefOf(link, input) : undefined}
            level={deeper(level)}
            lang={work.lang}
            meta={<WorkMeta work={work} input={input} />}
          >
            {summary ? (
              <p className="sg-rec__muted">
                <Phrase source={summary} input={input} />
              </p>
            ) : null}
            <WorkDetail input={input} work={work} level={level} summary={summary} />
          </Entry>
        );
      })}
    </Entries>
  );
}

export function WorksRenderer({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const pointer = backPointer(section, input);
  // The works the panels show: the line that points back, then each one's whole entry, inside the row's fold.
  if (pointer) {
    return (
      <>
        <BackPointer input={input} works={pointer.works} where={pointer.where} />
        <WorkEntries input={input} works={pointer.works} level={level} />
      </>
    );
  }
  const works = worksOf(section, input);
  if (works.length === 1 && works[0]!.medium === 'image-series' && works[0]!.media?.length) {
    return <Gallery input={input} work={works[0]!} level={level} />;
  }
  if (works.length === 1 && works[0]!.medium === 'music') {
    return <Album input={input} work={works[0]!} level={level} />;
  }
  return <WorkEntries input={input} works={works} level={level} />;
}
