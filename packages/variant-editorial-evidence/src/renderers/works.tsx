import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import { Disclosure, Surface } from '@portfolio/appearance/primitives';
import {
  anchorSection,
  DateText,
  evidenceByIds,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  hrefFor,
  MaybeLink,
  PeriodText,
  placedMedia,
  present,
  recordAnchor,
  renderContext,
  RichText,
  worksOf,
  type HeadingLevel,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { figureKey, workFigure, workImages } from '../figures';
import { archiveId, isRoutedWork, plateId, type HomeModel } from '../model';
import { Caption, Facts, Figure, homeRegion, joined, Row, Rows, Words } from '../parts';
import type { Env } from '../env';

// Works. The section that sets the curated run (the model's selection)
// opens on a ruled row that points back to Pl. 1 at the head of the page,
// then the featured works on unequal plates, then the rest of its
// own works as rows, then the archive behind a disclosure. Every other
// works section is a ruled run of rows, with a work that has photographs
// or tracks set as a numbered figure. A work on a plate is listed where the
// owner listed it, as a row pointing to its plate, so nothing shows twice.

type WorksProps = SectionRendererProps<SectionOf<'works'>> & { readonly env: Env };

/** A work's own page, when it has one. */
const pageOf = (work: Work, input: VariantRenderInput) =>
  isRoutedWork(work) ? routeHref(input, { route: 'work', slug: work.slug }) : undefined;

/** The work's title, a link to its page, else its own address. */
function WorkTitle({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const page = pageOf(work, ctx.input);
  if (page) return <a href={page}>{work.title}</a>;
  return (
    <MaybeLink url={work.url} ctx={ctx}>
      {work.title}
    </MaybeLink>
  );
}

/** When the work is from: its publication or release, else its period. */
function WorkDate({ work, ctx }: { work: Work; ctx: RenderContext }): ReactNode {
  if (work.publishedAt !== undefined) return <DateText raw={work.publishedAt} ctx={ctx} />;
  if (work.releasedAt !== undefined) return <DateText raw={work.releasedAt} ctx={ctx} />;
  if (work.period) return <PeriodText period={work.period} ctx={ctx} />;
  return null;
}

/** The short facts about a work, comma-joined. */
function workFacts(work: Work, ctx: RenderContext): ReactNode[] {
  return [
    work.number !== undefined ? (
      <>
        <Words input={ctx.input}>No.</Words> {formatFigure(work.number, ctx)}
      </>
    ) : null,
    work.publication,
    work.role,
    work.organization,
    work.artist,
    work.series,
    work.label,
    work.readingTimeMinutes !== undefined ? formatMinutes(work.readingTimeMinutes, ctx) : null,
    work.durationMinutes !== undefined ? formatMinutes(work.durationMinutes, ctx) : null,
    work.guests?.length ? formatNames(work.guests, ctx) : null,
  ].filter((part) => part !== null && part !== undefined && part !== '');
}

/** Whether the work has a link to show: its links, its audio, or its video. */
const hasLinks = (work: Work) =>
  (work.links?.length ?? 0) > 0 || Boolean(work.audioUrl) || Boolean(work.videoUrl);

/** The work's links, its audio and video among them, in a line. */
function WorkLinks({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const links = [
    ...(work.links ?? []).map((link) => ({
      url: link.url,
      text: [link.label, link.platform].find(present) ?? link.url,
    })),
    ...(work.audioUrl ? [{ url: work.audioUrl, text: 'Listen' }] : []),
    ...(work.videoUrl ? [{ url: work.videoUrl, text: 'Watch' }] : []),
  ];
  if (links.length === 0) return null;
  return (
    <ul className="ee-links" role="list">
      {links.map((link, index) => (
        <li key={index}>
          <a href={hrefFor(link.url, ctx.input)}>{link.text}</a>
        </li>
      ))}
    </ul>
  );
}

/** One featured work on its plate: media across the outset, an excerpt, or its words alone. */
function Plate({
  work,
  number,
  ctx,
  anchor,
}: {
  work: Work;
  number: number;
  ctx: RenderContext;
  anchor: string | undefined;
}) {
  const { input } = ctx;
  const cover = placedMedia(work.cover ?? work.media?.[0], ctx);
  const titleId = `${plateId(input, work)}--title`;
  const kind = cover ? 'media' : present(work.excerpt) ? 'quote' : 'text';
  const facts = workFacts(work, ctx);
  const sheet = plateSheet(work, ctx);
  // The work's evidence, as Pl. 1's notes are: up to three lines, its highlights first.
  const lines = (work.highlights?.filter(present) ?? [])
    .concat(
      evidenceByIds(work.evidence, input).flatMap((entry) =>
        present(entry.title) ? [entry.title] : [],
      ),
    )
    .slice(0, 3);
  return (
    <article
      id={plateId(input, work)}
      className={`ee-plate ee-plate--${kind}`}
      aria-labelledby={titleId}
      lang={work.lang}
      data-work-id={work.id}
    >
      {/* The plate's picture on its mat, the language's Surface, as Pl. 1's is. */}
      {cover ? (
        <Surface className="ee-plate__mat">
          <Figure
            placed={cover}
            ctx={ctx}
            className="ee-media"
            sizes="(min-width: 81.25rem) 60rem, 100vw"
          />
        </Surface>
      ) : null}
      {kind === 'quote' ? (
        <blockquote className="ee-plate__excerpt" data-type-role="headline">
          <RichText source={work.excerpt!} input={input} />
        </blockquote>
      ) : null}
      <div className="ee-plate__text">
        <div className="ee-plate__line">
          <Heading level={ctx.itemLevel} className="ee-plate__title">
            <span id={titleId}>
              <span id={anchor}>
                <WorkTitle work={work} ctx={ctx} />
              </span>
            </span>
          </Heading>
          <p className="ee-plate__index" data-type-role="caption">
            <Words input={input}>{`Pl. ${number}`}</Words>
          </p>
        </div>
        {present(work.summary) ? (
          <RichText
            source={work.summary}
            className={kind === 'text' ? 'ee-plate__dek' : 'ee-plate__summary'}
            input={input}
          />
        ) : null}
      </div>
      {/* The margin's job (G2): the plate's fact sheet, its evidence, its links; none when it has none. */}
      {sheet.length > 0 ||
      facts.length > 0 ||
      workDateShown(work) ||
      lines.length > 0 ||
      hasLinks(work) ? (
        <Caption className="ee-plate__side">
          {sheet.length > 0 ? (
            <Facts facts={sheet} className="ee-plate__facts" />
          ) : facts.length > 0 || workDateShown(work) ? (
            <p>{joined([...facts, <WorkDate key="date" work={work} ctx={ctx} />])}</p>
          ) : null}
          {lines.length > 0 ? (
            <ul className="ee-ruled ee-plate__lines" role="list">
              {lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
          <WorkLinks work={work} ctx={ctx} />
        </Caption>
      ) : null}
    </article>
  );
}

/**
 * A plate's fact sheet: its role, when, with whom, and what with, each a
 * ruled row, and whatever else the caption would say in a last row. Empty
 * when it would hold fewer than two rows, so the caption keeps its one line.
 */
function plateSheet(work: Work, ctx: RenderContext): [ReactNode, ReactNode][] {
  const { input } = ctx;
  const term = (text: string) => <Words input={input}>{text}</Words>;
  const sheet: [ReactNode, ReactNode][] = [];
  if (present(work.role)) sheet.push([term('Role'), work.role]);
  if (workDateShown(work)) {
    sheet.push([term('When'), <WorkDate key="when" work={work} ctx={ctx} />]);
  }
  if (present(work.organization)) sheet.push([term('With'), work.organization]);
  if (work.tools?.length) sheet.push([term('Made with'), formatNames(work.tools, ctx)]);
  const rest = workFacts(work, ctx).filter(
    (part) => part !== work.role && part !== work.organization,
  );
  if (rest.length > 0) sheet.push([term('Also'), joined(rest)]);
  return sheet.length >= 2 ? sheet : [];
}

const workDateShown = (work: Work) =>
  work.publishedAt !== undefined || work.releasedAt !== undefined || work.period !== undefined;

/** One work as a row: title, leader, and date, its facts under it, its summary in the margin. */
function WorkRow({
  work,
  ctx,
  model,
  anchor,
  inSelection,
}: {
  work: Work;
  ctx: RenderContext;
  model: HomeModel;
  anchor: string | undefined;
  inSelection: boolean;
}) {
  const { input } = ctx;
  const plate = inSelection ? undefined : model.plates.get(work.id);
  const facts = workFacts(work, ctx);
  const date = <WorkDate work={work} ctx={ctx} />;
  return (
    <Row
      id={anchor}
      lang={work.lang}
      level={ctx.itemLevel}
      title={<WorkTitle work={work} ctx={ctx} />}
      end={
        plate !== undefined ? (
          <a href={homeRegion(input, plateId(input, work))}>
            <Words input={input}>{`Pl. ${plate}`}</Words>
          </a>
        ) : workDateShown(work) ? (
          date
        ) : undefined
      }
      sub={
        facts.length > 0 || (work.links?.length ?? 0) > 0 ? (
          <>
            {facts.length > 0 ? <span>{joined(facts)}</span> : null}
            <WorkLinks work={work} ctx={ctx} />
          </>
        ) : undefined
      }
      note={
        present(work.excerpt) ? (
          <blockquote className="ee-row__quote">
            <RichText source={work.excerpt} input={input} />
          </blockquote>
        ) : present(work.summary) ? (
          <RichText source={work.summary} input={input} />
        ) : undefined
      }
      attributes={{ 'data-work-id': work.id }}
    />
  );
}

const trackTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A work with photographs or tracks, as a numbered figure with one caption. */
function WorkFigureBody({
  work,
  ctx,
  number,
  anchor,
}: {
  work: Work;
  ctx: RenderContext;
  number: number | undefined;
  anchor: string | undefined;
}) {
  const { input } = ctx;
  const kind = workFigure(work, input);
  const images = workImages(work, input).flatMap((placement) => {
    const placed = placedMedia(placement, ctx);
    return placed ? [placed] : [];
  });
  const cover = placedMedia(work.cover, ctx);
  const tracks = work.tracks ?? [];
  const total = tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0);
  const headingLevel: HeadingLevel = ctx.itemLevel;
  return (
    <li id={anchor} className={`ee-fig ee-fig--${kind}`} lang={work.lang} data-work-id={work.id}>
      <figure className="ee-fig__figure">
        {kind === 'gallery' ? (
          <div className={`ee-gallery ee-gallery--${Math.min(images.length, 3)}`}>
            {images.map((placed, index) => (
              <Figure
                key={`${placed.asset}-${index}`}
                placed={placed}
                ctx={ctx}
                className="ee-media"
                sizes="(min-width: 81.25rem) 20rem, 100vw"
              />
            ))}
          </div>
        ) : (
          <div className="ee-album">
            {cover ? <Figure placed={cover} ctx={ctx} className="ee-media" sizes="12rem" /> : null}
            <table className="ee-table">
              <caption className="ee-visually-plain">
                <Words input={input}>Tracks</Words>
              </caption>
              <tbody>
                {tracks.map((track, index) => (
                  <tr key={index}>
                    <td className="ee-table__n">{formatFigure(index + 1, ctx)}</td>
                    <td>
                      <MaybeLink url={track.url} ctx={ctx}>
                        {track.title}
                      </MaybeLink>
                    </td>
                    <td className="ee-table__end">
                      {track.durationSeconds !== undefined
                        ? trackTime(track.durationSeconds)
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              {total > 0 ? (
                <tfoot>
                  <tr>
                    <td />
                    <td>
                      <Words input={input}>Total</Words>
                    </td>
                    <td className="ee-table__end">{trackTime(total)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
        <figcaption>
          <Caption
            title={
              <Heading level={headingLevel} className="ee-fig__title">
                <WorkTitle work={work} ctx={ctx} />
              </Heading>
            }
            index={
              number !== undefined ? <Words input={input}>{`Fig. ${number}`}</Words> : undefined
            }
          >
            {present(work.summary) ? <RichText source={work.summary} input={input} /> : null}
            {workFacts(work, ctx).length > 0 || workDateShown(work) ? (
              <p>{joined([...workFacts(work, ctx), <WorkDate key="d" work={work} ctx={ctx} />])}</p>
            ) : null}
            <WorkLinks work={work} ctx={ctx} />
          </Caption>
        </figcaption>
      </figure>
    </li>
  );
}

/** The archive, behind a native disclosure that names how much it holds and what. */
function Archive({
  works,
  ctx,
  model,
  section,
}: {
  works: readonly Work[];
  ctx: RenderContext;
  model: HomeModel;
  section: string;
}) {
  const { input } = ctx;
  // A work keeps its id here unless another section the page renders lists it first.
  const anchorFor = (work: Work) => {
    const first = anchorSection(work, input);
    return first === undefined || first.id === section
      ? `${input.ids.prefix}${work.id}`
      : undefined;
  };
  const titles = works.slice(0, 3).map(({ title }) => title);
  const count = works.length === 1 ? '1 older work' : `${works.length} older works`;
  return (
    <Disclosure
      id={archiveId(input)}
      className="ee-archive"
      summary={
        <span className="ee-archive__summary">
          <span className="ee-archive__cue" aria-hidden="true" />
          <span className="ee-archive__title">
            <Words input={input}>{`The archive, ${count}`}</Words>
          </span>{' '}
          <span className="ee-archive__count">{formatNames(titles, ctx)}</span>
        </span>
      }
    >
      <Rows>
        {works.map((work) => (
          <WorkRow
            key={work.id}
            work={work}
            ctx={ctx}
            model={model}
            anchor={anchorFor(work)}
            inSelection
          />
        ))}
      </Rows>
    </Disclosure>
  );
}

export function WorksBody({ section, input, level, env }: WorksProps) {
  const { model } = env;
  const ctx = renderContext(input, section, level);
  const works = worksOf(section, input);
  const anchorOf = (work: Work) => recordAnchor(section, work, input);

  if (section.id === model.selection) {
    const lead = model.lead;
    const curated = new Set([...model.plates.keys(), ...model.archive.map(({ id }) => id)]);
    const rest = works.filter((work) => !curated.has(work.id));
    const listed = new Set(works.map(({ id }) => id));
    return (
      <div className="ee-run">
        {model.featured.map((work) => (
          <Plate
            key={work.id}
            work={work}
            number={model.plates.get(work.id)!}
            ctx={ctx}
            anchor={listed.has(work.id) ? anchorOf(work) : undefined}
          />
        ))}
        {lead || rest.length > 0 ? (
          // Pl. 1 heads the page; the run refers back to it in one ruled row (EE-S6), after
          // the plates, so it never sits over another work's figure (C11).
          <Rows>
            {lead ? (
              <WorkRow
                work={lead}
                ctx={ctx}
                model={model}
                anchor={listed.has(lead.id) ? anchorOf(lead) : undefined}
                inSelection={false}
              />
            ) : null}
            {rest.map((work) => (
              <WorkRow
                key={work.id}
                work={work}
                ctx={ctx}
                model={model}
                anchor={anchorOf(work)}
                inSelection
              />
            ))}
          </Rows>
        ) : null}
        {model.archive.length > 0 ? (
          <Archive works={model.archive} ctx={ctx} model={model} section={section.id} />
        ) : null}
      </div>
    );
  }

  return (
    <Rows>
      {works.map((work) =>
        workFigure(work, input) && !model.plates.has(work.id) ? (
          <WorkFigureBody
            key={work.id}
            work={work}
            ctx={ctx}
            number={model.figures.get(figureKey(section.id, work.id))}
            anchor={anchorOf(work)}
          />
        ) : (
          <WorkRow
            key={work.id}
            work={work}
            ctx={ctx}
            model={model}
            anchor={anchorOf(work)}
            inSelection={false}
          />
        ),
      )}
    </Rows>
  );
}
