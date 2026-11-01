import type { Section, Work } from '@portfolio/schema';
import {
  Heading,
  MediaFigure,
  RichText,
  hrefFor,
  isRoutedWork,
  placedImage,
  recordAnchor,
  renderContext,
  worksOf,
  type SectionRendererProps,
  type SectionOf,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { dateText, recordState, said, showcaseOf, titleOfSection, type HomeModel } from '../model';
import { linkText, Out, StateLine, traceAttrs, Words } from '../parts';
import { Credits, Excerpt, WorkMore } from './detail';

// Works on the wall. The first works section opens the Work board as the
// showcase: the signature cell (a cover crop, its lamps, its title, the
// summary, a ticked list of highlights, its actions), the featured cell
// beside it, the archived strip across the foot, and "n of N shown". A
// writing section is a log table, newest first as written; anything else
// is a row of cells split by hairlines.

/** A work's own page, when it has a case study. */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  return isRoutedWork(work) ? routeHref(input, { route: 'work', slug: work.slug }) : undefined;
}

/** A work's actions: its case study first, then its links, each place once. */
function actionsOf(work: Work, input: VariantRenderInput) {
  const seen = new Set<string>();
  const out: { href: string; text: string; primary: boolean }[] = [];
  const route = workHref(work, input);
  if (route) {
    out.push({ href: route, text: 'Open the case', primary: true });
    seen.add(route);
  }
  for (const link of work.links ?? []) {
    const href = hrefFor(link.url, input);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: linkText(link), primary: false });
  }
  if (said(work.url)) {
    const href = hrefFor(work.url, input);
    if (!seen.has(href)) out.push({ href, text: 'Visit', primary: false });
  }
  return out;
}

function Actions({
  work,
  input,
  uiLang,
}: {
  work: Work;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}) {
  const actions = actionsOf(work, input);
  if (actions.length === 0) return null;
  return (
    <ul className="mc-actions">
      {actions.map((action) => (
        <li key={action.href}>
          <Out href={action.href} className={action.primary ? 'mc-act mc-act--primary' : 'mc-link'}>
            {action.primary ? <Words lang={uiLang}>{action.text}</Words> : action.text}
          </Out>
        </li>
      ))}
    </ul>
  );
}

function Cell({
  section,
  work,
  input,
  level,
  form,
  model,
  titled = true,
}: {
  section: Section;
  work: Work;
  input: VariantRenderInput;
  level: SectionRendererProps<Section>['level'];
  form: 'signature' | 'featured' | 'cell';
  model: HomeModel;
  /** Whether it sets its title: a lone work named as its panel is leaves it to the panel's bar. */
  titled?: boolean;
}) {
  const { uiLang } = model;
  const anchor = recordAnchor(section, work, input);
  const ctx = renderContext(input, section as SectionOf<'works'>, level);
  // A work with a page of its own captions its cover there; any other keeps its captions,
  // with its credits and the rest, behind its Details, so the wall stays its length.
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  const highlights = form === 'signature' ? (work.highlights ?? []) : [];
  const routed = isRoutedWork(work);
  return (
    <article
      className="mc-cell"
      data-form={form}
      id={anchor}
      lang={work.lang}
      {...traceAttrs(work.id, model)}
    >
      {cover ? (
        <MediaFigure
          placed={cover}
          ctx={ctx}
          className="mc-cell__media"
          eager={form === 'signature'}
          sizes={
            form === 'signature'
              ? '(width >= 73.75rem) 40vw, 100vw'
              : '(width >= 73.75rem) 25vw, 100vw'
          }
        />
      ) : null}
      <div className="mc-cell__body">
        {/* The title, then its lamps and Linked control on the same line while they fit. */}
        <div className="mc-cell__head">
          {titled ? (
            <Heading
              level={ctx.itemLevel}
              className={
                form === 'signature' ? 'mc-cell__title mc-cell__title--lead' : 'mc-cell__title'
              }
            >
              {work.title}
            </Heading>
          ) : null}
          <StateLine
            id={work.id}
            lamps={recordState(work, input)}
            anchored={anchor !== undefined}
            model={model}
            input={input}
          />
        </div>
        {form === 'signature' || routed ? <Credits work={work} ctx={ctx} /> : null}
        {said(work.summary) ? (
          <RichText source={work.summary} className="mc-cell__summary" input={input} />
        ) : null}
        <Excerpt work={work} ctx={ctx} />
        {highlights.length > 0 ? (
          <ul className="mc-ticks">
            {highlights.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : null}
        {form !== 'signature' && work.tools && work.tools.length > 0 ? (
          <p className="mc-cell__meta">{work.tools.join(', ')}</p>
        ) : null}
        {/* Its actions, then its Details on the same line; a work with a page of its own shows
            the rest there. */}
        <div className="mc-cell__foot">
          <Actions work={work} input={input} uiLang={uiLang} />
          {routed ? null : (
            <WorkMore
              work={work}
              ctx={ctx}
              uiLang={uiLang}
              tools={form === 'signature'}
              credits={form !== 'signature'}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function Showcase({
  section,
  input,
  level,
  model,
}: SectionRendererProps<SectionOf<'works'>> & { model: HomeModel }) {
  const works = worksOf(section, input);
  const { signature, featured, archived, rest } = showcaseOf(works, input);
  const ctx = renderContext(input, section, level);
  return (
    <div className="mc-showcase">
      <div className="mc-showcase__lead">
        {signature ? (
          <Cell
            section={section}
            work={signature}
            input={input}
            level={level}
            form="signature"
            model={model}
          />
        ) : null}
        {featured ? (
          <Cell
            section={section}
            work={featured}
            input={input}
            level={level}
            form="featured"
            model={model}
          />
        ) : null}
      </div>
      {archived ? (
        <article
          className="mc-strip"
          id={recordAnchor(section, archived, input)}
          lang={archived.lang}
          {...traceAttrs(archived.id, model)}
        >
          <Heading level={ctx.itemLevel} className="mc-strip__title">
            {archived.title}
          </Heading>
          <StateLine
            id={archived.id}
            lamps={recordState(archived, input)}
            anchored={recordAnchor(section, archived, input) !== undefined}
            model={model}
            input={input}
          />
          {isRoutedWork(archived) ? <Credits work={archived} ctx={ctx} /> : null}
          {said(archived.summary) ? (
            <RichText source={archived.summary} className="mc-strip__summary" input={input} />
          ) : null}
          <Excerpt work={archived} ctx={ctx} />
          <div className="mc-cell__foot">
            <Actions work={archived} input={input} uiLang={model.uiLang} />
            {isRoutedWork(archived) ? null : (
              <WorkMore work={archived} ctx={ctx} uiLang={model.uiLang} tools credits />
            )}
          </div>
        </article>
      ) : null}
      {rest.length > 0 ? (
        <>
          <ul className="mc-cells">
            {rest.map((work) => (
              <li key={work.id}>
                <Cell
                  section={section}
                  work={work}
                  input={input}
                  level={level}
                  form="cell"
                  model={model}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** A writing section as a log: date, title, publication, reading time. */
function Log({
  section,
  input,
  level,
  model,
}: SectionRendererProps<SectionOf<'works'>> & { model: HomeModel }) {
  const ctx = renderContext(input, section, level);
  return (
    <ol className="mc-log">
      {worksOf(section, input).map((work) => {
        const date = work.publishedAt ?? work.releasedAt;
        const href =
          workHref(work, input) ?? (said(work.url) ? hrefFor(work.url, input) : undefined);
        return (
          <li
            key={work.id}
            id={recordAnchor(section, work, input)}
            lang={work.lang}
            className="mc-log__row"
            {...traceAttrs(work.id, model)}
          >
            {date ? (
              <time className="mc-log__date mc-num" dateTime={date}>
                {dateText(date, input.portfolio.locale)}
              </time>
            ) : (
              <span className="mc-log__date" />
            )}
            <div className="mc-log__main">
              <Heading level={ctx.itemLevel} className="mc-log__title">
                {href ? <Out href={href}>{work.title}</Out> : work.title}
              </Heading>
              {said(work.summary) ? (
                <RichText source={work.summary} className="mc-log__summary" input={input} />
              ) : null}
              {isRoutedWork(work) ? null : (
                <WorkMore work={work} ctx={ctx} uiLang={model.uiLang} tools excerpt />
              )}
            </div>
            <div className="mc-log__meta">
              {[work.publication, work.role, work.organization].filter(said).map((part) => (
                <span key={part}>{part}</span>
              ))}
              {work.readingTimeMinutes ? (
                <span>
                  <span className="mc-num">{work.readingTimeMinutes}</span>{' '}
                  <Words lang={model.uiLang}>min read</Words>
                </span>
              ) : null}
              <StateLine
                id={work.id}
                lamps={[]}
                anchored={recordAnchor(section, work, input) !== undefined}
                model={model}
                input={input}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function WorksBody(props: SectionRendererProps<SectionOf<'works'>> & { model: HomeModel }) {
  const { section, input, level, model } = props;
  if (section.id === model.firstWorks) return <Showcase {...props} />;
  const works = worksOf(section, input);
  if (works.length > 0 && works.every((work) => work.medium === 'writing'))
    return <Log {...props} />;
  // A panel holding one work named as the panel is: its bar says the name, so the cell doesn't
  // say it again (the design review's D3).
  const title = titleOfSection(section);
  const lone =
    works.length === 1 &&
    said(title) &&
    works[0]!.title.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase();
  return (
    <ul className="mc-cells">
      {works.map((work) => (
        <li key={work.id}>
          <Cell
            section={section}
            work={work}
            input={input}
            level={level}
            form="cell"
            model={model}
            titled={!lone}
          />
        </li>
      ))}
    </ul>
  );
}
