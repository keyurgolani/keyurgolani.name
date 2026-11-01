import type { CSSProperties, ReactNode } from 'react';
import type { ChronologyEntry, Work } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  DateText,
  Heading,
  hrefFor,
  isRoutedWork,
  LinkText,
  MaybeLink,
  MediaFigure,
  PeriodText,
  placedMedia,
  present,
  renderContext,
  RichText,
  worksByIds,
  worksOf,
  type Placement,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { mediumLabel } from './model';
import { ownId, uiLang, Words, yearOf } from './parts';
import { anchorOfScene, SceneFrame } from './scene';
import { SectionHead } from './words';
import {
  homeScenes,
  isReservedAnchor,
  recordId,
  recordItems,
  type PlacedScene,
  type ReelItem,
  type ReelSection,
} from './scenes';

// Reels (redesign): works and chronology, the sections that hold the most,
// as one frame whose records run over as many scenes as they need. Each
// part is a scene of the strip with its own bars, laid on the scene's
// columns by what it holds:
//
//   feature   a work's words in four columns, its still in five, and up to
//             two more works of words alone in the last three
//   release   the cover beside the words and the tracklist
//   gallery   the series' words over three pictures, each captioned
//   entries   up to three works of words alone, side by side
//   timeline  a chronology's entries side by side, each as wide as its
//             words need
//
// The signature work, which opens the film, is a line that points there.
// Every record keeps its anchor on the first section that lists it.

type ReelScene = Extract<PlacedScene, { kind: 'reel' }>;

/** A track's length, `5:12`. */
function trackLength(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The reel's parts, as the strip placed them, and the strip around them. */
function partsOf(section: ReelSection, input: VariantRenderInput) {
  const { scenes } = homeScenes(input);
  const parts = scenes.filter(
    (scene): scene is ReelScene => scene.kind === 'reel' && scene.section.id === section.id,
  );
  return { scenes, parts };
}

/** Whether a record's title says no more than its section's: it reads once, for assistive technology too. */
const repeats = (title: string | undefined, section: ReelSection) =>
  present(title) && title.trim().toLowerCase() === section.title?.trim().toLowerCase();

/** A picture's caption: its own words, else the work's title, then where and when. */
function captionOf(placement: Placement, work: Work | undefined, ctx: RenderContext): ReactNode {
  const words = present(placement.caption) ? placement.caption : work?.title;
  const where = present(placement.location) ? placement.location : undefined;
  const year = yearOf(work?.period?.start ?? work?.publishedAt ?? work?.releasedAt);
  return (
    <span className="hc-cap">
      <span className="hc-cap__words">
        {present(placement.caption) ? words : <strong>{words}</strong>}
        {where ? <span className="hc-cap__where">{`, ${where}`}</span> : null}
      </span>
      {placement.takenAt !== undefined ? (
        <DateText raw={placement.takenAt} ctx={ctx} field="takenAt" />
      ) : year ? (
        <span>{year}</span>
      ) : null}
    </span>
  );
}

/** A placement as a captioned still. */
function Still({
  placement,
  work,
  ctx,
  sizes,
}: {
  placement: Placement | undefined;
  /** The work it's the still of, whose title captions it when the placement has no words; none for one of a series. */
  work?: Work;
  ctx: RenderContext;
  sizes: string;
}) {
  const placed = placedMedia(placement, ctx);
  if (!placement || !placed || placed.decorative) return null;
  return (
    <div className="hc-work__still hc-still">
      <MediaFigure
        placed={{ ...placed, caption: captionOf(placement, work, ctx) }}
        ctx={ctx}
        sizes={sizes}
      />
    </div>
  );
}

/** A work's line of facts: what it is and when, in words, never a string of dots. */
function WorkFacts({
  work,
  ctx,
  lang,
}: {
  work: Work;
  ctx: RenderContext;
  lang: 'en' | undefined;
}) {
  const parts: ReactNode[] = [];
  if (work.number !== undefined)
    parts.push(<Words key="number" lang={lang}>{`Episode ${work.number}`}</Words>);
  else if (mediumLabel(work) && work.period) parts.push(mediumLabel(work));
  if (present(work.publication)) parts.push(work.publication);
  if (present(work.series) && work.number === undefined) parts.push(work.series);
  const when = work.publishedAt ?? work.releasedAt;
  if (when !== undefined) parts.push(<DateText key="when" raw={when} ctx={ctx} />);
  else if (work.period)
    parts.push(
      <span key="since">
        <Words lang={lang}>{work.period.end ? 'from' : 'since'}</Words>{' '}
        <DateText raw={work.period.start} ctx={ctx} />
      </span>,
    );
  if (work.readingTimeMinutes !== undefined)
    parts.push(
      <Words key="reading" lang={lang}>{`${work.readingTimeMinutes} minutes of reading`}</Words>,
    );
  if (work.durationMinutes !== undefined)
    parts.push(<Words key="duration" lang={lang}>{`${work.durationMinutes} minutes`}</Words>);
  if (parts.length === 0) return null;
  return (
    <p className="hc-work__facts" data-type-role="label">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          {part}
        </span>
      ))}
    </p>
  );
}

/** Who made it, with what, and where to go next: the case study and the work's own links. */
function WorkLinks({
  work,
  ctx,
  lang,
  site = false,
}: {
  work: Work;
  ctx: RenderContext;
  lang: 'en' | undefined;
  /** The work's own address, which its heading doesn't carry when the heading reads for assistive technology alone. */
  site?: boolean;
}) {
  const study = isRoutedWork(work)
    ? routeHref(ctx.input, { route: 'work', slug: work.slug })
    : undefined;
  const links = work.links ?? [];
  const own =
    site && present(work.url) && !links.some((link) => link.url === work.url)
      ? work.url
      : undefined;
  const audio = present(work.audioUrl) ? work.audioUrl : undefined;
  const video = present(work.videoUrl) ? work.videoUrl : undefined;
  const by = [work.role, work.artist, work.organization].filter(present).join(', ');
  const tools = work.tools?.length ? work.tools.join(', ') : undefined;
  if (!study && !own && links.length === 0 && !audio && !video && !by && !tools) return null;
  return (
    <div className="hc-work__links" data-type-role="body-compact">
      {by || tools ? (
        <p className="hc-work__by">
          {by}
          {by && tools ? '. ' : null}
          {tools ? <Words lang={lang}>{`In ${tools}`}</Words> : null}
        </p>
      ) : null}
      {study || own || links.length > 0 || audio || video ? (
        <p className="hc-work__go">
          {own ? (
            <a href={hrefFor(own, ctx.input)}>
              <Words lang={lang}>Project site</Words>
            </a>
          ) : null}
          {study ? (
            <a href={study}>
              <Words lang={lang}>Read the case study</Words>
              <span className="hc-visually-hidden">{`: ${work.title}`}</span>
            </a>
          ) : null}
          {audio ? (
            <a href={audio}>
              <Words lang={lang}>Listen</Words>
            </a>
          ) : null}
          {video ? (
            <a href={video}>
              <Words lang={lang}>Watch</Words>
            </a>
          ) : null}
          {links.map((link, index) => (
            <LinkText key={index} link={link} ctx={ctx} />
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** A work's words: its facts, its title, its summary, and for a feature or a release its description. */
function WorkWords({
  work,
  ctx,
  section,
  full,
  lang,
}: {
  work: Work;
  ctx: RenderContext;
  section: ReelSection;
  full: boolean;
  lang: 'en' | undefined;
}) {
  const hidden = repeats(work.title, section);
  const summary = present(work.summary) ? work.summary : undefined;
  const body = present(work.description) ? work.description : undefined;
  return (
    <div className="hc-work__words">
      <WorkFacts work={work} ctx={ctx} lang={lang} />
      <Heading level={ctx.itemLevel} className={hidden ? 'hc-visually-hidden' : 'hc-work__title'}>
        <span data-type-role={full ? 'headline' : 'title'}>
          {/* A heading that reads for assistive technology alone holds no link to tab to. */}
          <MaybeLink url={!hidden && present(work.url) ? work.url : undefined} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </span>
      </Heading>
      {summary ? (
        <RichText
          source={summary}
          className={full ? 'hc-work__summary' : 'hc-work__body'}
          input={ctx.input}
        />
      ) : null}
      {present(work.excerpt) ? (
        <blockquote className="hc-work__excerpt" data-type-role="title">
          <RichText source={work.excerpt} input={ctx.input} />
        </blockquote>
      ) : null}
      {body && (full || !summary) ? (
        <RichText source={body} className="hc-work__body" input={ctx.input} />
      ) : null}
      <WorkLinks work={work} ctx={ctx} lang={lang} site={hidden} />
    </div>
  );
}

/** One record of a works part, by its role there. */
function WorkPiece({
  item,
  work,
  section,
  ctx,
  scenes,
  lang,
}: {
  item: ReelItem;
  work: Work;
  section: ReelSection;
  ctx: RenderContext;
  scenes: readonly PlacedScene[];
  lang: 'en' | undefined;
}) {
  const anchor = recordId(section, work, ctx.input);
  const common = {
    id: anchor,
    className: 'hc-work',
    'data-role': item.role,
    'data-work-id': work.id,
    'data-medium': work.medium,
    lang: work.lang,
  };
  if (item.role === 'note') {
    const lead = scenes.find((scene) => scene.kind === 'lead');
    const href = lead ? `#${ctx.input.ids.prefix}${anchorOfScene(lead, scenes)}` : undefined;
    return (
      <li {...common}>
        <Heading level={ctx.itemLevel} className="hc-visually-hidden">
          {work.title}
        </Heading>
        <p className="hc-work__note" data-type-role="body-compact">
          {href ? <a href={href}>{work.title}</a> : work.title}
          <Words lang={lang}>
            {lead ? `, the signature work, opens the film in scene ${lead.number}.` : ''}
          </Words>
        </p>
      </li>
    );
  }
  if (item.role === 'gallery') {
    const [from, to] = item.media ?? [0, work.media?.length ?? 0];
    const first = from === 0;
    return (
      <li {...common} id={first ? anchor : undefined}>
        {first ? (
          <WorkWords work={work} ctx={ctx} section={section} full={false} lang={lang} />
        ) : null}
        <ul className="hc-work__gallery" role="list">
          {(work.media ?? []).slice(from, to).map((placement, index) => (
            <li key={`${placement.asset}-${from + index}`}>
              <Still placement={placement} ctx={ctx} sizes="(min-width: 64rem) 30vw, 100vw" />
            </li>
          ))}
        </ul>
      </li>
    );
  }
  const still = item.role === 'entry' ? undefined : (work.cover ?? work.media?.[0]);
  return (
    <li {...common}>
      <WorkWords work={work} ctx={ctx} section={section} full={item.role !== 'entry'} lang={lang} />
      {still ? (
        <Still
          placement={still}
          work={work}
          ctx={ctx}
          sizes={
            item.role === 'release'
              ? '(min-width: 64rem) 30vw, 100vw'
              : '(min-width: 64rem) 40vw, 100vw'
          }
        />
      ) : null}
      {item.role === 'release' && work.tracks?.length ? (
        <ol className="hc-tracks" data-type-role="body-compact">
          {work.tracks.map((track, index) => (
            <li key={index}>
              <span>
                <MaybeLink url={present(track.url) ? track.url : undefined} ctx={ctx}>
                  {track.title}
                </MaybeLink>
              </span>
              {track.durationSeconds !== undefined ? (
                <span className="hc-tracks__length">{trackLength(track.durationSeconds)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** How a works part lays out, from what it holds. */
function layoutOf(items: readonly ReelItem[]): string {
  if (items.some((item) => item.role === 'feature')) return 'feature';
  if (items.some((item) => item.role === 'release')) return 'release';
  if (items.some((item) => item.role === 'gallery')) return 'gallery';
  return 'entries';
}

export function WorksReel({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const ctx = renderContext(input, section, level);
  const lang = uiLang(input.portfolio.locale);
  const { scenes, parts } = partsOf(section, input);
  const creditsId = ownId(input.ids.prefix, 'credits');
  const works = new Map(worksOf(section, input).map((work) => [work.id, work]));
  // In the full record, after the film, the section has no scenes: its works read as one list.
  if (parts.length === 0) {
    const items = recordItems([...works.values()], homeScenes(input).lead);
    return (
      <>
        <SectionHead section={section} level={ctx.level} subtitleRole="title" />
        <ul className="hc-reel hc-record__entries" role="list" data-count={items.length}>
          {items.map((item) => (
            <WorkPiece
              key={item.id}
              item={item}
              work={works.get(item.id)!}
              section={section}
              ctx={ctx}
              scenes={scenes}
              lang={lang}
            />
          ))}
        </ul>
      </>
    );
  }
  return (
    <>
      {parts.map((part) => (
        <SceneFrame
          key={part.number}
          scene={part}
          scenes={scenes}
          input={input}
          creditsId={creditsId}
        >
          {part.part === 0 ? (
            <SectionHead section={section} level={ctx.level} subtitleRole="title" />
          ) : null}
          <ul
            className="hc-reel"
            role="list"
            data-layout={layoutOf(part.items)}
            data-count={part.items.filter((item) => item.role !== 'note').length}
          >
            {part.items.map((item, index) => {
              const work = works.get(item.id) ?? worksByIds([item.id], input)[0];
              return work ? (
                <WorkPiece
                  key={`${item.id}-${index}`}
                  item={item}
                  work={work}
                  section={section}
                  ctx={ctx}
                  scenes={scenes}
                  lang={lang}
                />
              ) : null;
            })}
          </ul>
        </SceneFrame>
      ))}
    </>
  );
}

/** One chronology entry, a column of the timeline. */
function EntryColumn({
  entry,
  section,
  ctx,
  columns,
}: {
  entry: ChronologyEntry;
  section: ReelSection;
  ctx: RenderContext;
  columns: number;
}) {
  const notes = [...(entry.highlights ?? []), ...(entry.achievements ?? [])];
  // The works it produced, each that has a place on the page.
  const produced = worksByIds(entry.works, ctx.input).filter(
    (work) => anchorSection(work, ctx.input) !== undefined && !isReservedAnchor(work.id),
  );
  return (
    <li
      id={recordId(section, entry, ctx.input)}
      className="hc-entry"
      style={{ '--layout-span': columns } as CSSProperties}
      data-chronology-kind={entry.kind}
      data-thread={entry.thread}
      data-branches-from={entry.branchesFrom}
      data-merges-into={entry.mergesInto}
      lang={entry.lang}
    >
      <p className="hc-entry__when" data-type-role="label">
        <PeriodText period={entry.period} ctx={ctx} />
        {present(entry.location) ? `, ${entry.location}` : null}
      </p>
      <Heading level={ctx.itemLevel} className="hc-entry__title">
        <span data-type-role="title">{entry.title}</span>
      </Heading>
      {present(entry.organization) || present(entry.field) ? (
        <p className="hc-entry__org" data-type-role="body-compact">
          {present(entry.organization) ? (
            <MaybeLink
              url={present(entry.organizationUrl) ? entry.organizationUrl : undefined}
              ctx={ctx}
            >
              {entry.organization}
            </MaybeLink>
          ) : null}
          {present(entry.organization) && present(entry.field) ? ', ' : null}
          {present(entry.field) ? entry.field : null}
        </p>
      ) : null}
      {present(entry.description) ? (
        <RichText source={entry.description} className="hc-entry__body" input={ctx.input} />
      ) : null}
      {notes.length > 0 ? (
        <ul className="hc-rules hc-entry__notes" role="list" data-type-role="body-compact">
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      {entry.skills?.length ? (
        <p className="hc-entry__skills" data-type-role="body-compact">
          {entry.skills.join(', ')}
        </p>
      ) : null}
      {produced.length > 0 ? (
        <p className="hc-entry__works" data-type-role="body-compact">
          {produced.map((work, index) => (
            <span key={work.id}>
              {index > 0 ? ', ' : null}
              <a href={`#${ctx.input.ids.prefix}${work.id}`}>{work.title}</a>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export function ChronologyReel({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  const { scenes, parts } = partsOf(section, input);
  const creditsId = ownId(input.ids.prefix, 'credits');
  const entries = new Map(chronologyOf(section, input).map((entry) => [entry.id, entry]));
  // In the full record, after the film, the section has no scenes: its entries read as one list.
  if (parts.length === 0) {
    return (
      <>
        <SectionHead section={section} level={ctx.level} subtitleRole="title" />
        <ol className="hc-reel hc-timeline hc-record__entries" role="list">
          {[...entries.values()].map((entry) => (
            <EntryColumn key={entry.id} entry={entry} section={section} ctx={ctx} columns={1} />
          ))}
        </ol>
      </>
    );
  }
  return (
    <>
      {parts.map((part) => (
        <SceneFrame
          key={part.number}
          scene={part}
          scenes={scenes}
          input={input}
          creditsId={creditsId}
        >
          {part.part === 0 ? (
            <SectionHead section={section} level={ctx.level} subtitleRole="title" />
          ) : null}
          <ol
            className="hc-reel hc-timeline"
            role="list"
            style={
              {
                '--layout-slots': part.items.reduce((sum, item) => sum + (item.columns ?? 1), 0),
              } as CSSProperties
            }
          >
            {part.items.map((item) => {
              const entry = entries.get(item.id);
              return entry ? (
                <EntryColumn
                  key={item.id}
                  entry={entry}
                  section={section}
                  ctx={ctx}
                  columns={item.columns ?? 1}
                />
              ) : null;
            })}
          </ol>
        </SceneFrame>
      ))}
    </>
  );
}
