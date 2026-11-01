import type { CSSProperties } from 'react';
import type { Placement, Section, Work } from '@portfolio/schema';
import {
  isArchived,
  recordAnchor,
  type PlacedImage,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { caseHref, plateTitleId } from '../hero';
import {
  formatNumber,
  hasCaseStudy,
  isShownAbove,
  present,
  rangeOf,
  squash,
  titleLink,
  workRuns,
  yearOf,
  type WorkForm,
} from '../model';
import {
  captionedImage,
  Fold,
  Img,
  More,
  Out,
  Phrase,
  Prose,
  readyImage,
  Tracks,
  uiLang,
  When,
  WorkLinks,
  Words,
} from '../parts';

// Works (brief §5.10): every work a card, its media poured into a drop
// with the tab's ink lip, its words beside it; writing and research a run
// of titled rows, newest first as the owner ordered them; audio, video and
// music rows with their length; image series and photography the gallery,
// each picture in a blob-masked frame. A mixed section shows each run of one
// medium in its own form, in order. The signature work shows once, in the
// opening's plate: here it's one line back to it (N6).

type Works = Extract<Section, { kind: 'works' }>;

/**
 * Where a work's title links: its own page, else its URL, else its first link when the owner gave
 * that link no name. A named one keeps its name, in the links line under the work's words.
 */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  return hasCaseStudy(work) ? caseHref(input)(work) : titleLink(work);
}

/** A work's when: its period's years, else the year it was published or released. */
export function workWhen(work: Work): string | undefined {
  return rangeOf(work.period)?.text ?? yearOf(work.publishedAt ?? work.releasedAt);
}

function Title({ work, input, role }: { work: Work; input: VariantRenderInput; role: string }) {
  const href = workHref(work, input);
  return (
    <h4 className="fx-item__title" data-type-role={role}>
      {href ? (
        <a href={href}>
          {work.title}
          <Out href={href} />
        </a>
      ) : (
        work.title
      )}
    </h4>
  );
}

/** A work's tools, one line, when it has no page of its own to list them. */
const toolsOf = (work: Work) => {
  const tools = (work.tools ?? []).filter(present);
  return tools.length > 0 && !hasCaseStudy(work) ? tools.join(', ') : undefined;
};

/** A work's tags, one line, when it has no page of its own to list them. */
const tagsOf = (work: Work) => {
  const tags = (work.tags ?? []).filter(present);
  return tags.length > 0 && !hasCaseStudy(work) ? tags.join(', ') : undefined;
};

/** A work's description beside its summary, folded: the summary leads, the description says more. */
function Description({ work, input }: { work: Work; input: VariantRenderInput }) {
  if (!present(work.summary) || !present(work.description) || hasCaseStudy(work)) return null;
  return (
    <Fold word="More" input={input}>
      <Prose source={work.description} input={input} className="fx-prose" />
    </Fold>
  );
}

/** Who made it and where it ran: the role, the organization, the publication or series, the artist and label. */
const creditsOf = (work: Work) => [
  ...new Set(
    [work.role, work.organization, work.publication, work.series, work.artist, work.label].filter(
      present,
    ),
  ),
];

function Card({ work, section, input }: { work: Work; section: Works; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const media = readyImage(work.cover ?? work.media?.[0], input);
  const summary = work.summary ?? work.description;
  const when = workWhen(work);
  const highlights = (work.highlights ?? []).filter(present).slice(0, 2);
  const credits = creditsOf(work);
  const tools = toolsOf(work);
  const tags = tagsOf(work);
  const archived = isArchived(work, input);
  return (
    <li
      className={media ? 'fx-card' : 'fx-card fx-card--text'}
      id={recordAnchor(section, work, input)}
      lang={work.lang}
    >
      {media ? (
        <div className="fx-card__drop">
          <Img
            placed={media}
            input={input}
            sizes="(min-width: 64rem) 24vw, 80vw"
            className="fx-card__img"
          />
        </div>
      ) : null}
      <div className="fx-card__words">
        <p className="fx-item__kicker" data-type-role="caption">
          {archived ? <Words lang={lang}>From the archive</Words> : null}
          {archived && when ? ', ' : null}
          {when ? <span className="fx-num">{when}</span> : null}
        </p>
        <Title work={work} input={input} role="headline" />
        {present(summary) ? (
          <p className="fx-card__sum" data-type-role="body">
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {credits.length > 0 || highlights.length > 0 ? (
          <ul className="fx-card__facts" role="list" data-type-role="body-compact">
            {credits.map((credit) => (
              <li key={credit}>{credit}</li>
            ))}
            {highlights.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : null}
        {tools || tags ? (
          <p className="fx-card__tools" data-type-role="caption">
            {[tools, tags].filter(present).join(' · ')}
          </p>
        ) : null}
        <Description work={work} input={input} />
        <WorkLinks work={work} input={input} />
      </div>
    </li>
  );
}

function Cards({
  works,
  section,
  input,
}: {
  works: Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  return (
    <ul className="fx-cards" role="list" data-count={String(works.length)}>
      {works.map((work) => (
        <Card key={work.id} work={work} section={section} input={input} />
      ))}
    </ul>
  );
}

/** Writing, research, audio, video and music: titled rows with when, where and how long. */
/** The longest listening or reading time in a run: each row's length tube fills to its share. */
const longestOf = (works: readonly Work[]) =>
  Math.max(0, ...works.map((work) => work.readingTimeMinutes ?? work.durationMinutes ?? 0));

function Rows({
  works,
  section,
  input,
  form,
  longest = longestOf(works),
}: {
  works: Work[];
  section: Works;
  input: VariantRenderInput;
  form: WorkForm;
  longest?: number;
}) {
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  return (
    <ol className="fx-rows" role="list" data-form={form}>
      {works.map((work) => {
        const summary = work.summary ?? work.description;
        const minutes = work.readingTimeMinutes ?? work.durationMinutes;
        const unit = work.readingTimeMinutes ? 'min read' : 'min';
        const credits = creditsOf(work);
        const date = work.publishedAt ?? work.releasedAt;
        const highlights = (work.highlights ?? []).filter(present).slice(0, 2);
        const tools = toolsOf(work);
        const tags = tagsOf(work);
        const guests = (work.guests ?? []).filter(present);
        return (
          <li
            key={work.id}
            className="fx-row"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            <Title work={work} input={input} role="title" />
            {present(summary) ? (
              <p className="fx-row__sum" data-type-role="body-compact">
                <Phrase source={summary} input={input} />
              </p>
            ) : null}
            {highlights.length > 0 ? (
              <ul className="fx-drops" role="list" data-type-role="body-compact">
                {highlights.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
            <Description work={work} input={input} />
            {present(work.showNotes) ? (
              <Fold word="Show notes" input={input}>
                <Prose source={work.showNotes} input={input} className="fx-prose" />
              </Fold>
            ) : null}
            <WorkLinks work={work} input={input} />
            {present(work.excerpt) ||
            work.tracks?.length ||
            credits.length > 0 ||
            guests.length > 0 ||
            tools ||
            tags ||
            date ||
            minutes ? (
              <div className="fx-row__aside">
                {present(work.excerpt) ? (
                  <p className="fx-row__excerpt" data-type-role="body-compact">
                    <Phrase source={work.excerpt} input={input} />
                  </p>
                ) : null}
                <Tracks work={work} input={input} />
                {tools || tags ? (
                  <p className="fx-card__tools" data-type-role="caption">
                    {[tools, tags].filter(present).join(' · ')}
                  </p>
                ) : null}
                {credits.length > 0 ||
                guests.length > 0 ||
                date ||
                minutes ||
                work.tracks?.length ? (
                  <p className="fx-row__foot" data-type-role="caption">
                    {credits.map((credit) => (
                      <span key={credit}>{credit}</span>
                    ))}
                    {guests.length > 0 ? (
                      <span>
                        <Words lang={lang}>With </Words>
                        {guests.join(', ')}
                      </span>
                    ) : null}
                    {date ? (
                      <span>
                        <When raw={date} lang={lang} />
                      </span>
                    ) : null}
                    {work.tracks?.length ? (
                      <span className="fx-num">
                        <Words
                          lang={lang}
                        >{`${formatNumber(work.tracks.length, locale)} ${work.tracks.length === 1 ? 'track' : 'tracks'}`}</Words>
                      </span>
                    ) : null}
                    {minutes ? (
                      <span className="fx-num fx-len">
                        <Words
                          lang={lang}
                        >{`${formatNumber(Math.round(minutes), locale)} ${unit}`}</Words>
                        {longest > 0 ? (
                          <span
                            className="fx-len__tube"
                            aria-hidden="true"
                            style={
                              {
                                '--layout-fx-len': Math.round((minutes / longest) * 100) / 100,
                              } as CSSProperties
                            }
                          />
                        ) : null}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Image series and photography: each picture in a blob-masked frame, the work's words before them. */
function Gallery({
  works,
  section,
  input,
}: {
  works: Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  return (
    <>
      {works.map((work) => {
        const placements = [work.cover, ...(work.media ?? [])].filter(
          (each, index, all): each is Placement =>
            each !== undefined && all.findIndex((other) => other?.asset === each.asset) === index,
        );
        // Every picture with what its author wrote about it; one not there yet keeps its box.
        const images = placements.flatMap((placement) => {
          const placed = captionedImage(placement, input);
          return placed ? [placed] : [];
        });
        const frames = (shown: readonly PlacedImage[], from: number) => (
          <ul
            className="fx-gallery__frames"
            role="list"
            data-count={String(Math.min(shown.length, 5))}
          >
            {shown.map((placed, index) => (
              <li key={placed.asset} className="fx-frame" data-shape={String((from + index) % 3)}>
                <Img
                  placed={placed}
                  input={input}
                  sizes="(min-width: 64rem) 28vw, 45vw"
                  inline={false}
                  className="fx-frame__img"
                />
              </li>
            ))}
          </ul>
        );
        const summary = work.summary ?? work.description;
        return (
          <div
            key={work.id}
            className="fx-gallery"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            <div className="fx-gallery__words">
              {present(section.title) &&
              !workHref(work, input) &&
              squash(section.title).toLocaleLowerCase() ===
                squash(work.title).toLocaleLowerCase() ? (
                <h4 className="fx-hidden">{work.title}</h4>
              ) : (
                <Title work={work} input={input} role="title" />
              )}
              {present(summary) ? (
                <p className="fx-row__sum" data-type-role="body-compact">
                  <Phrase source={summary} input={input} />
                </p>
              ) : null}
              <Description work={work} input={input} />
              <WorkLinks work={work} input={input} />
            </div>
            {images.length > 0 ? frames(images.slice(0, 5), 0) : null}
            {/* Past five, the rest behind one fold at every width (design gate item 7). */}
            {images.length > 5 ? (
              <Fold word="More" count={images.length - 5} input={input}>
                {frames(images.slice(5), 5)}
              </Fold>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * The signature work in a section that lists nothing else: one line, its own title, a link to the
 * plate (N6). No words of the composition's own.
 */
function PlateLink({ work, input }: { work: Work; input: VariantRenderInput }) {
  return (
    <p className="fx-plate-link" data-type-role="body">
      <a href={`#${plateTitleId(work, input)}`}>
        <span lang={work.lang}>{work.title}</span>
      </a>
    </p>
  );
}

export function WorksRenderer({ section, input }: SectionRendererProps<Works>) {
  const runs = workRuns(section, input);
  // The signature work shows once, in the opening's plate, on this same page: its sheet lists it
  // no second time (N6; the lead's SF14 ruling), and the plate's title holds its anchor. A
  // section that lists it alone keeps one line, a link to the plate.
  const rest = runs.flatMap((run) => run.items).filter((work) => !isShownAbove(work, input));
  if (rest.length === 0) {
    const signature = runs.flatMap((run) => run.items).find((work) => isShownAbove(work, input));
    return signature ? <PlateLink work={signature} input={input} /> : null;
  }
  return (
    <>
      {runs.flatMap((run, index) => {
        const key = `${run.form}-${index}`;
        const works = run.items.filter((work) => !isShownAbove(work, input));
        if (works.length === 0) return [];
        const body =
          run.form === 'card' ? (
            <Cards key={key} works={works} section={section} input={input} />
          ) : run.form === 'gallery' ? (
            <Gallery key={key} works={works} section={section} input={input} />
          ) : (run.form === 'essay' || run.form === 'episode') && works.length > 1 ? (
            // The latest, then the rest folded on a phone.
            <div key={key} className="fx-run-more">
              <Rows
                works={works.slice(0, 1)}
                section={section}
                input={input}
                form={run.form}
                longest={longestOf(works)}
              />
              <More count={works.length - 1} input={input}>
                <Rows
                  works={works.slice(1)}
                  section={section}
                  input={input}
                  form={run.form}
                  longest={longestOf(works)}
                />
              </More>
            </div>
          ) : (
            <Rows key={key} works={works} section={section} input={input} form={run.form} />
          );
        return [body];
      })}
    </>
  );
}
