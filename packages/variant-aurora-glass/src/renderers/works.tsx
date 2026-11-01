import type { Section, Work } from '@portfolio/schema';
import { isArchived, recordAnchor, type SectionRendererProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { signatureId } from '../hero';
import {
  formatNumber,
  homeDescription,
  isShownAbove,
  present,
  rangeOf,
  repoForWork,
  workRuns,
  yearOf,
} from '../model';
import { Img, LinkLine, More, Out, Phrase, readyImage, uiLang, Words } from '../parts';
import { Sheet } from '../surfaces/sheet';
import { Essays } from './essays';
import { Episodes } from './episodes';
import { Looking } from './looking';
import { Sleeve } from './sleeve';
import { workHref } from './work-href';

export { workHref };

// Works (brief §5.2, works by medium): software, systems, interfaces and
// objects are sheets laid on the band's lite, the first with a cover as the
// lead (tall, with its cover), the rest as archive slips; writing and
// research are essay rows; audio and video the episodes pane; image series
// and photography the Looking stage; music the sleeve and its tracks. A
// mixed section shows each run of one medium in its own form, in order.
// The signature work shows once, in the opening's sheet: here it's one line
// back to it (N6, AG-S6).

type Works = Extract<Section, { kind: 'works' }>;

/** A work's when: its period's years, else the year it was published or released. */
export function workWhen(work: Work): string | undefined {
  return rangeOf(work.period)?.text ?? yearOf(work.publishedAt ?? work.releasedAt);
}

/**
 * The one line a band keeps for the work the opening shows, whatever its
 * form (N6, AG-S6). It keeps the record's anchor, so a link to the record
 * still lands in its band, and links on to the opening's sheet.
 */
function BackRef({
  work,
  section,
  input,
}: {
  work: Work;
  section: Works;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <p className="ag-backref" data-type-role="body-compact" id={recordAnchor(section, work, input)}>
      <a href={`#${signatureId(input)}`}>
        <span lang={work.lang}>{work.title}</span>
        <Words lang={lang}>, the signature work, opens the page</Words>
      </a>
    </p>
  );
}

function SheetEntry({
  work,
  section,
  input,
  lead,
}: {
  work: Work;
  section: Works;
  input: VariantRenderInput;
  lead: boolean;
}) {
  const lang = uiLang(input.portfolio.locale);
  const href = workHref(work, input);
  const cover = lead ? readyImage(work.cover ?? work.media?.[0], input) : undefined;
  const summary = work.summary ?? work.description;
  const highlights = (work.highlights ?? []).filter(present).slice(0, lead ? 3 : 1);
  const repo = repoForWork(input, work);
  const when = workWhen(work);
  const tools = (work.tools ?? []).filter(present);
  const titleId = `${recordAnchor(section, work, input) ?? `${input.ids.prefix}${section.id}-${work.id}`}--h`;
  return (
    <Sheet
      as="li"
      className={
        lead ? (cover ? 'ag-work ag-work--lead' : 'ag-work ag-work--lead ag-work--text') : 'ag-work'
      }
      id={recordAnchor(section, work, input)}
      lang={work.lang}
      aria-labelledby={titleId}
    >
      {cover ? (
        <div className="ag-work__media">
          <Img
            placed={cover}
            input={input}
            sizes="(min-width: 64rem) 40rem, 100vw"
            className="ag-work__img"
          />
        </div>
      ) : null}
      <div className="ag-work__body">
        <h4 className="ag-work__title" id={titleId} data-type-role={lead ? 'headline' : 'title'}>
          {href ? (
            <a className="ag-stretch" href={href}>
              {work.title}
              <Out href={href} />
            </a>
          ) : (
            work.title
          )}
        </h4>
        {present(work.role) || present(work.organization) || when ? (
          <p className="ag-work__meta" data-type-role="caption">
            {present(work.role) ? <span>{work.role}</span> : null}
            {present(work.organization) ? <span>{work.organization}</span> : null}
            {when ? <span className="ag-num">{when}</span> : null}
          </p>
        ) : null}
        {present(summary) ? (
          <p className="ag-work__sum" data-type-role={lead ? 'body' : 'body-compact'}>
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {homeDescription(work) ? (
          <More label="More about it" of={work} source={homeDescription(work)!} input={input} />
        ) : null}
        {tools.length > 0 ? (
          <p className="ag-work__tools" data-type-role="caption">
            <Words lang={lang}>Made with </Words>
            {tools.join(', ')}
          </p>
        ) : null}
        <LinkLine links={work.links} input={input} />
        {highlights.length > 0 || repo ? (
          <ul className="ag-work__proof" data-type-role="body-compact">
            {highlights.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
            {repo ? (
              <li>
                <Words
                  lang={lang}
                >{`${formatNumber(repo.stars, input.portfolio.locale)} stars on GitHub`}</Words>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}

function Sheets({
  works,
  section,
  input,
}: {
  works: Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const live = works.filter((work) => !isArchived(work, input));
  const archived = works.filter((work) => isArchived(work, input));
  const leadAt = live.findIndex((work) => readyImage(work.cover ?? work.media?.[0], input));
  const lead = leadAt >= 0 ? live[leadAt] : live[0];
  const rest = live.filter((work) => work !== lead);
  return (
    <>
      {live.length > 0 ? (
        <ul className="ag-works" data-count={String(live.length)}>
          {lead ? <SheetEntry work={lead} section={section} input={input} lead /> : null}
          {rest.map((work) => (
            <SheetEntry key={work.id} work={work} section={section} input={input} lead={false} />
          ))}
        </ul>
      ) : null}
      {archived.length > 0 ? (
        <details className="ag-archive">
          <summary data-type-role="label">
            <Words lang={lang}>Archive</Words>{' '}
            <span className="ag-num">{formatNumber(archived.length, input.portfolio.locale)}</span>
          </summary>
          <ul className="ag-works ag-works--slips">
            {archived.map((work) => (
              <SheetEntry key={work.id} work={work} section={section} input={input} lead={false} />
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

export function WorksRenderer({ section, input }: SectionRendererProps<Works>) {
  const runs = workRuns(section, input);
  return (
    <>
      {runs.flatMap((run, index) => {
        const key = `${run.form}-${index}`;
        // The signature shows once, in the opening; in its band, in every form, one line back to it.
        const above = run.items.filter((work) => isShownAbove(work, input));
        const works = run.items.filter((work) => !isShownAbove(work, input));
        const refs = above.map((work) => (
          <BackRef key={`ref-${work.id}`} work={work} section={section} input={input} />
        ));
        return works.length === 0 ? refs : [...refs, formOf(run.form, works, key)];
      })}
    </>
  );

  function formOf(form: (typeof runs)[number]['form'], works: Work[], key: string) {
    switch (form) {
      case 'essay':
        return <Essays key={key} works={works} section={section} input={input} />;
      case 'episode':
        return <Episodes key={key} works={works} section={section} input={input} />;
      case 'looking':
        return <Looking key={key} works={works} section={section} input={input} />;
      case 'sleeve':
        return <Sleeve key={key} works={works} section={section} input={input} />;
      default:
        return <Sheets key={key} works={works} section={section} input={input} />;
    }
  }
}
