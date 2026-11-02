import type { Section, Work } from '@portfolio/schema';
import {
  DateText,
  hrefFor,
  isArchived,
  isSignature,
  placedImage,
  recordAnchor,
  renderContext,
  worksOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Img, readyImage } from '../media';
import {
  albumTotal,
  formatNumber,
  hasCaseStudy,
  listed,
  mediumWord,
  minutesSeconds,
  present,
  splitAside,
  workWhen,
} from '../model';
import { Out, Paren, Phrase, Prose, uiLang, When, Words } from '../parts';
import { workHref } from '../selected-index';
import { RuledTable, type Row } from './ruled-table';

// Works (brief §5.1, components 7, 8, 9 and 10): one image series is a
// butt-jointed contact sheet, one record an album, writing and episodes a
// ruled table, and everything else the works index, its signature work a
// spread with a large plate. Archived works sit in a disclosure.

type Works = Extract<Section, { kind: 'works' }>;

const WRITTEN = new Set(['writing', 'research']);

/** A "Made with" sentence from a work's tools, joined as the locale lists them. */
function madeWith(work: Work, locale: string): string | undefined {
  const tools = (work.tools ?? []).filter(present);
  return tools.length === 0 ? undefined : listed(tools, locale);
}

/** Who and where a work is credited to, after its role: its organization, artist, label, publication or show. */
const creditsOf = (work: Work) =>
  [work.organization, work.artist, work.label, work.publication, work.series].filter(present);

/** A piece of writing's excerpt, in quotation marks, in the quote role. */
function Excerpt({ work, input }: { work: Work; input: VariantRenderInput }) {
  return present(work.excerpt) ? (
    <span className="ss-sub ss-excerpt" data-type-role="quote">
      {'“'}
      <Phrase source={work.excerpt} input={input} />
      {'”'}
    </span>
  ) : null;
}

/** A record's tracks: a ruled table, its total computed. */
function Tracks({ work, input }: { work: Work; input: VariantRenderInput }) {
  if (!work.tracks?.length) return null;
  const total = albumTotal(work);
  return (
    <RuledTable
      caption={`${work.title}: tracks`}
      lang={uiLang(input.portfolio.locale)}
      columns={[
        { label: 'No.', span: 1 },
        { label: 'Track', span: 9 },
        { label: 'Length', span: 2, end: true },
      ]}
      rows={work.tracks.map((track, index) => ({
        key: String(index),
        cells: [
          <span key="n" className="ss-num">
            {formatNumber(index + 1, input.portfolio.locale)}
          </span>,
          track.url ? (
            <a key="t" href={track.url}>
              {track.title}
            </a>
          ) : (
            track.title
          ),
          track.durationSeconds ? (
            <span key="l" className="ss-num">
              {minutesSeconds(track.durationSeconds)}
            </span>
          ) : null,
        ],
      }))}
      foot={total ? { label: 'Total', value: total } : undefined}
    />
  );
}

/** A work's own links, each by the owner's label, else its platform, else its address. */
function WorkLinks({ work, input }: { work: Work; input: VariantRenderInput }) {
  if (!work.links?.length) return null;
  return (
    <p className="ss-links" data-type-role="body-compact">
      {work.links.map((link) => (
        <a key={link.url} href={hrefFor(link.url, input)}>
          {link.label ?? link.platform ?? link.url}
          <Out href={link.url} />
        </a>
      ))}
    </p>
  );
}

function IndexRow({
  work,
  section,
  input,
  number,
  signature,
}: {
  work: Work;
  section: Works;
  input: VariantRenderInput;
  number: number;
  signature: boolean;
}) {
  const lang = uiLang(input.portfolio.locale);
  const href = workHref(work, input);
  const cover = readyImage(work.cover ?? work.media?.[0], input);
  const medium = mediumWord(work);
  const when = workWhen(work);
  const tools = madeWith(work, input.portfolio.locale);
  const summary = work.summary ?? work.description;
  // The description reads after the summary when the owner wrote both.
  const more = present(work.summary) && present(work.description) ? work.description : undefined;
  const highlights = (work.highlights ?? []).filter(present);
  return (
    <li
      className={`ss-row${signature ? ' ss-row--signature' : ''}${cover ? '' : ' ss-row--text'}`}
      id={recordAnchor(section, work, input)}
      lang={work.lang}
    >
      <span className="ss-row__no ss-num" data-type-role="numeric" aria-hidden="true">
        {formatNumber(number, input.portfolio.locale)}
      </span>
      <div className="ss-row__id">
        <h4 className="ss-row__title" data-type-role="title">
          {href ? (
            <a href={href}>
              {work.title}
              <Out href={href} />
            </a>
          ) : (
            work.title
          )}
        </h4>
        <p className="ss-row__meta" data-type-role="body-compact">
          {[
            medium ? (
              <Words key="m" lang={lang}>
                {medium}
              </Words>
            ) : null,
            present(work.role) ? <span key="r">{work.role}</span> : null,
            ...creditsOf(work).map((credit, index) => <span key={`c${index}`}>{credit}</span>),
            when ? (
              <span key="w" className="ss-num">
                {when.open ? <Words lang={lang}>{when.text}</Words> : when.text}
              </span>
            ) : null,
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index === 0 ? [part] : [', ', part]))}
        </p>
      </div>
      <div className="ss-row__text">
        {present(summary) ? <Prose source={summary} input={input} /> : null}
        {more ? <Prose source={more} input={input} role="body-compact" className="ss-sub" /> : null}
        <Excerpt work={work} input={input} />
        <Tracks work={work} input={input} />
        {highlights.length > 0 ? (
          <ul className="ss-ruled" data-type-role="body-compact">
            {highlights.map((item, index) => (
              <li key={index} className="ss-num">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        {tools ? (
          <p className="ss-row__made" data-type-role="body-compact">
            <Words lang={lang}>Made with</Words> {tools}.
          </p>
        ) : null}
        <WorkLinks work={work} input={input} />
        {signature && hasCaseStudy(work) && href ? (
          <p>
            <a className="ss-cta ss-row__cta" href={href} data-type-role="title">
              <Words lang={lang}>Read the case study</Words>
            </a>
          </p>
        ) : null}
      </div>
      {cover ? (
        <div className="ss-row__media">
          <Img
            placed={cover}
            input={input}
            sizes={signature ? '(min-width: 48rem) 50vw, 100vw' : '(min-width: 48rem) 25vw, 100vw'}
            eager={signature}
          />
        </div>
      ) : null}
    </li>
  );
}

function WorksIndex({ section, input }: { section: Works; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const works = worksOf(section, input);
  const live = works.filter((work) => !isArchived(work, input));
  const archived = works.filter((work) => isArchived(work, input));
  const row = (work: Work, index: number) => (
    <IndexRow
      key={work.id}
      work={work}
      section={section}
      input={input}
      number={index + 1}
      signature={isSignature(work, input)}
    />
  );
  return (
    <>
      {live.length > 0 ? <ol className="ss-rows">{live.map(row)}</ol> : null}
      {archived.length > 0 ? (
        <details className="ss-archive">
          <summary data-type-role="label">
            <Words lang={lang}>Archive</Words>{' '}
            <Paren>{formatNumber(archived.length, input.portfolio.locale)}</Paren>
          </summary>
          <ol className="ss-rows" start={live.length + 1}>
            {archived.map((work, index) => row(work, live.length + index))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

/** Writing and episodes: a ruled table, in the owner's order. */
function WritingTable({ section, input }: { section: Works; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  const works = worksOf(section, input);
  const minutes = (value: number | undefined) =>
    value ? <Words lang={lang}>{`${formatNumber(Math.round(value), locale)} min`}</Words> : null;
  const summaryOf = (work: Work) => {
    const summary = work.summary ?? work.description;
    return present(summary) ? (
      <span className="ss-sub">
        <Phrase source={summary} input={input} />
      </span>
    ) : null;
  };
  const tagsOf = (work: Work) => {
    const tags = (work.tags ?? []).filter(present);
    return tags.length > 0 ? (
      <span className="ss-sub ss-tags" data-type-role="caption">
        {tags.join(', ')}
      </span>
    ) : null;
  };
  // A show the section's own title already names isn't said again in every row.
  const heading = present(section.title) ? splitAside(section.title).text.trim() : undefined;
  const episodeCredits = (work: Work) => {
    const guests = (work.guests ?? []).filter(present);
    const series = present(work.series) && work.series.trim() !== heading ? work.series : undefined;
    if (!series && guests.length === 0) return null;
    return (
      <span className="ss-sub">
        {series}
        {series && guests.length > 0 ? ', ' : null}
        {guests.length > 0 ? (
          <>
            <Words lang={lang}>with</Words> {listed(guests, locale)}
          </>
        ) : null}
      </span>
    );
  };
  if (works.every((work) => work.medium === 'audio-video')) {
    const rows: Row[] = works.map((work, index) => {
      const href = work.audioUrl ?? work.videoUrl ?? work.url ?? work.links?.[0]?.url;
      const listen = href ? (
        <a href={hrefFor(href, input)}>
          <Words lang={lang}>{work.videoUrl && !work.audioUrl ? 'Watch' : 'Listen'}</Words>
          <Out href={href} />
        </a>
      ) : null;
      const date = work.publishedAt ?? work.releasedAt;
      return {
        key: work.id,
        id: recordAnchor(section, work, input),
        lang: work.lang,
        narrowAt: 1,
        cells: [
          <span key="n" className="ss-num">
            {formatNumber(work.number ?? index + 1, locale)}
          </span>,
          <>
            <span className="ss-strong" data-type-role="body">
              {work.title}
            </span>
            {summaryOf(work)}
            {episodeCredits(work)}
            {present(work.showNotes) ? (
              <details className="ss-more">
                <summary data-type-role="label">
                  <Words lang={lang}>Show notes</Words>
                </summary>
                <Prose source={work.showNotes} input={input} role="body-compact" />
              </details>
            ) : null}
            <WorkLinks work={work} input={input} />
          </>,
          <When key="d" raw={date} lang={lang} />,
          minutes(work.durationMinutes),
          listen,
        ],
        narrow: (
          <span className="ss-sub">
            <When raw={date} lang={lang} />
            {date && work.durationMinutes ? ', ' : null}
            {minutes(work.durationMinutes)}
            {listen ? <> {listen}</> : null}
          </span>
        ),
      };
    });
    return (
      <RuledTable
        caption={section.title ?? 'Episodes'}
        lang={lang}
        columns={[
          { label: 'No.', span: 1 },
          { label: 'Episode', span: 7 },
          { label: 'Released', span: 2, wide: true },
          { label: 'Length', span: 1, end: true, wide: true },
          { label: 'Listen', span: 1, end: true, wide: true },
        ]}
        rows={rows}
      />
    );
  }
  const rows: Row[] = works.map((work) => {
    const href = work.url ?? work.links?.[0]?.url;
    const date = work.publishedAt ?? work.releasedAt;
    const where = present(work.publication) ? work.publication : (work.organization ?? null);
    return {
      key: work.id,
      id: recordAnchor(section, work, input),
      lang: work.lang,
      narrowAt: 1,
      cells: [
        <When key="d" raw={date} lang={lang} />,
        <>
          <span className="ss-strong" data-type-role="body">
            {href ? (
              <a href={hrefFor(href, input)}>
                {work.title}
                <Out href={href} />
              </a>
            ) : (
              work.title
            )}
          </span>
          {summaryOf(work)}
          <Excerpt work={work} input={input} />
          {tagsOf(work)}
          <WorkLinks work={work} input={input} />
        </>,
        where,
        minutes(work.readingTimeMinutes),
      ],
      narrow: (
        <span className="ss-sub">
          <When raw={date} lang={lang} />
          {date && where ? ', ' : null}
          {where}
        </span>
      ),
    };
  });
  return (
    <RuledTable
      caption={section.title ?? 'Writing'}
      lang={lang}
      columns={[
        { label: 'Published', span: 2, wide: true },
        { label: 'Title', span: 6 },
        { label: 'Where', span: 3, wide: true },
        { label: 'Read', span: 1, end: true },
      ]}
      rows={rows}
    />
  );
}

/**
 * One image series: frames butt-jointed, one caption system (C7). The
 * frames are the work, so each keeps its place and its caption while its
 * image is unavailable, as the kit's box; where and when it was taken, and
 * its tags, sit under the caption.
 */
function ContactSheet({
  work,
  section,
  input,
}: {
  work: Work;
  section: Works;
  input: VariantRenderInput;
}) {
  const ctx = renderContext(input, section, 3);
  const frames = (work.media ?? []).flatMap((placement) => {
    const placed = placedImage(placement, input);
    return placed ? [{ placement, placed }] : [];
  });
  return (
    <ol
      className="ss-sheet"
      id={recordAnchor(section, work, input)}
      data-frames={Math.min(frames.length, 3)}
    >
      {frames.map(({ placement, placed }, index) => {
        const tags = (placement.tags ?? []).filter(present);
        return (
          <li key={index}>
            <figure>
              <Img placed={placed} input={input} sizes="(min-width: 48rem) 33vw, 100vw" eager />
              <figcaption data-type-role="caption">
                <span className="ss-sheet__no ss-num" aria-hidden="true">
                  {`${index + 1}/${frames.length}`}
                </span>
                <span>{placement.caption ?? placed.alt}</span>
                <span className="ss-sheet__where">
                  {[placement.location, placement.takenAt].filter(present).length > 0 ? (
                    <>
                      {placement.location}
                      {placement.location && placement.takenAt ? ', ' : null}
                      {placement.takenAt ? <DateText raw={placement.takenAt} ctx={ctx} /> : null}
                    </>
                  ) : null}
                </span>
                {tags.length > 0 ? (
                  <span className="ss-sheet__where">{tags.join(', ')}</span>
                ) : null}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ol>
  );
}

/** One record: a square cover and the track table with its computed total. */
function Album({
  work,
  section,
  input,
}: {
  work: Work;
  section: Works;
  input: VariantRenderInput;
}) {
  const cover = readyImage(work.cover, input);
  const ctx = renderContext(input, section, 3);
  const facts = [work.artist, work.label].filter(present);
  return (
    <div className="ss-album" id={recordAnchor(section, work, input)}>
      {cover ? (
        <div className="ss-album__cover">
          <Img placed={cover} input={input} sizes="(min-width: 48rem) 33vw, 100vw" eager />
        </div>
      ) : null}
      <div className="ss-album__body">
        <h4 className="ss-album__title" data-type-role="title">
          {work.title}
        </h4>
        <p className="ss-row__meta" data-type-role="body-compact">
          {facts.join(', ')}
          {facts.length && work.releasedAt ? ', ' : null}
          {work.releasedAt ? <DateText raw={work.releasedAt} ctx={ctx} /> : null}
          {/* The owner's role as the record's parenthetical: "Producer, composer" keeps its own comma. */}
          {present(work.role) ? (
            <>
              {' '}
              <Paren>{work.role}</Paren>
            </>
          ) : null}
        </p>
        {present(work.description) ? <Prose source={work.description} input={input} /> : null}
        <Tracks work={work} input={input} />
        <WorkLinks work={work} input={input} />
      </div>
    </div>
  );
}

export function WorksRenderer({ section, input }: SectionRendererProps<Works>) {
  const works = worksOf(section, input);
  const only = works.length === 1 ? works[0] : undefined;
  if (only?.medium === 'image-series' && only.media?.length) {
    return <ContactSheet work={only} section={section} input={input} />;
  }
  if (only?.medium === 'music') return <Album work={only} section={section} input={input} />;
  if (
    works.every((work) => WRITTEN.has(work.medium)) ||
    works.every((work) => work.medium === 'audio-video')
  ) {
    return <WritingTable section={section} input={input} />;
  }
  return <WorksIndex section={section} input={input} />;
}
