import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  anchorSection,
  evidenceByIds,
  footerOutline,
  formatNames,
  MediaFigure,
  PeriodText,
  present,
  renderContext,
  RichText,
  sectionRenders,
  worksOf,
  type CaseStudyPageProps,
  type CaseStudyPart,
  type RenderContext,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CaseFocus } from './case-focus';
import { EscHint } from './esc-hint';
import { AwardFigure, captionable, ChangeFigure } from './case-figures';
import { changeIn } from './figures';
import { FooterTile, uiLangOf } from './chrome';
import { overviewOf, overviewPlane, showcaseOrder, type Overview } from './model';
import { Button, linkWords, placed } from './parts';
import { Plane } from './plane';
import { EvidenceItems } from './renderers/evidence';
import { SECTIONS } from './home';

// A work's own page, /work/<slug>: the work's tile opened into one sheet
// over the receded field. The overview's plane lies faded behind it, inert
// and out of reach, and the sheet is one surface: no cards inside it. Its
// head is the name at display size, the summary and the work's links, with
// a fact sheet beside it; then the cover, what the work is, and each part of
// the case under the composition's own words, ruled off and as tall as its
// words, the decisions a real table and the evidence the records it cites;
// and the next work. Beside the opening words, the press line and the
// awards the work cites; beside What it showed and What it changed, the
// changes their own sentences report, drawn: figures under one caption
// system (case-figures.tsx), each drawn only from what the case holds
// (SPA-1). What it showed's figure leads its records; What it changed's
// stands in the next track, down beside Looking back. Arriving, focus goes to the h1; the way back returns to the tile
// the visitor opened.

type Study = CaseStudyPageProps['work']['caseStudy'];

/**
 * Each stop of the case in the composition's own words, never the schema's
 * field names: the sheet reads as one account, not a template's headings.
 */
const STOPS: Readonly<Record<CaseStudyPart['key'], string>> = {
  challenge: 'What was wrong',
  context: 'The setting',
  role: 'My part',
  constraints: 'Within limits',
  decisions: 'Calls made',
  evidence: 'What it showed',
  outcomes: 'What it changed',
  reflection: 'Looking back',
};

/** The DOM id of a work's tile on home: its anchor, when a section of the page holds it. */
export function tileAnchor(input: VariantRenderInput, workId: string): string | undefined {
  const work = input.portfolio.works.find((each) => each.id === workId);
  if (!work) return undefined;
  const section = anchorSection(work, input);
  return section && sectionRenders(section, input) ? `${input.ids.prefix}${work.id}` : undefined;
}

/**
 * Another work for the sheet's foot when there's no next case: the one the
 * field sets after this one in the showcase, round to the start, with a
 * tile on home to land on.
 */
export function anotherWork(input: VariantRenderInput, overview: Overview, workId: string) {
  if (!overview.showcase) return undefined;
  const works = showcaseOrder(worksOf(overview.showcase, input), input.portfolio.signature);
  const at = works.findIndex((each) => each.id === workId);
  const round = at < 0 ? works : [...works.slice(at + 1), ...works.slice(0, at)];
  for (const each of round) {
    const anchor = each.id === workId ? undefined : tileAnchor(input, each.id);
    if (anchor) return { work: each, anchor };
  }
  return undefined;
}

/** What the sheet draws beside its words (SPA-1): the opening's aside, and each part's figures. */
interface Drawn {
  /** Beside the opening words: the press line the work cites, then its awards as figures. */
  readonly quote?: Evidence;
  readonly opening: readonly ReactElement[];
  /** The records What it showed lists after its figures: the cited evidence the opening didn't take. */
  readonly records: readonly Evidence[];
  readonly evidence: readonly ReactElement[];
  readonly outcomes?: ReactElement;
}

/** A press line with words: the one the sheet sets beside its opening words. */
const isPullQuote = (entry: Evidence) =>
  entry.type === 'press' && (present(entry.excerpt) || present(entry.statement));

/** An award with something to caption: drawn as a figure, not listed as a row. */
const isAward = (entry: Evidence) => entry.type === 'award' && captionable(entry);

/**
 * What the case's own data draws, numbered down the sheet. Beside the
 * opening words, the press line and the awards the work cites: what others
 * said of it and gave it, so the opening is no measure of words beside
 * bare ground. They stay in What it showed when there are no opening words,
 * or when taking them would leave What it showed with nothing. Then the
 * change What it showed reports, and the one What it changed reports. A
 * part with none draws none, and leaves no hole.
 */
function drawn(
  work: CaseStudyPageProps['work'],
  outline: CaseStudyPageProps['outline'],
  cited: readonly Evidence[],
  ctx: RenderContext,
): Drawn {
  const study = work.caseStudy;
  const has = (key: CaseStudyPart['key']) => outline.parts.some((part) => part.key === key);
  const quoted = cited.find(isPullQuote);
  const aside = present(work.description)
    ? cited.filter((entry) => entry === quoted || isAward(entry))
    : [];
  const left = cited.filter((entry) => !aside.includes(entry));
  const moved = aside.length > 0 && (present(study.evidence) || left.length > 0);
  const records = moved ? left : cited;
  const awards = moved ? aside.filter(isAward) : has('evidence') ? records.filter(isAward) : [];
  let number = 0;
  const award = (entry: Evidence) => (
    <AwardFigure key={entry.id} entry={entry} number={(number += 1)} ctx={ctx} />
  );
  const opening = moved ? awards.map(award) : [];
  const evidence: ReactElement[] = [];
  const showed = has('evidence') ? changeIn(study.evidence) : undefined;
  if (showed) {
    evidence.push(
      <ChangeFigure
        key="change"
        change={showed}
        number={(number += 1)}
        ctx={ctx}
        lang={work.lang}
      />,
    );
  }
  if (!moved) evidence.push(...awards.map(award));
  const changed = has('outcomes') ? changeIn(study.outcomes) : undefined;
  return {
    ...(moved && quoted ? { quote: quoted } : {}),
    opening,
    records: records.filter((entry) => !awards.includes(entry)),
    evidence,
    ...(changed
      ? {
          outcomes: (
            <ChangeFigure change={changed} number={(number += 1)} ctx={ctx} lang={work.lang} />
          ),
        }
      : {}),
  };
}

/** A part of the case study on the sheet: its words, and for decisions and evidence, their objects. */
function PartBody({
  part,
  study,
  ctx,
  figures,
}: {
  part: CaseStudyPart;
  study: Study;
  ctx: RenderContext;
  figures: Drawn;
}): ReactNode {
  if (part.key === 'decisions') {
    return (
      <table className="sb-table">
        <thead>
          <tr lang={ctx.uiLang}>
            {DECISION_HEADS.map((head) => (
              <th key={head} scope="col">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(study.decisions ?? []).map((decision, index) => (
            <tr key={index}>
              <td data-label={DECISION_HEADS[0]}>
                <RichText source={decision.decision} input={ctx.input} />
              </td>
              <td data-label={present(decision.rationale) ? DECISION_HEADS[1] : undefined}>
                {present(decision.rationale) ? (
                  <RichText source={decision.rationale} input={ctx.input} />
                ) : null}
              </td>
              <td data-label={present(decision.alternatives) ? DECISION_HEADS[2] : undefined}>
                {present(decision.alternatives) ? (
                  <RichText source={decision.alternatives} input={ctx.input} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (part.key === 'evidence') {
    return (
      <>
        {present(study.evidence) ? (
          <RichText source={study.evidence} input={ctx.input} className="sb-prose" />
        ) : null}
        <EvidenceItems entries={figures.records} ctx={ctx} figures={figures.evidence} />
      </>
    );
  }
  const text = study[part.key];
  return typeof text === 'string' && present(text) ? (
    <RichText source={text} input={ctx.input} className="sb-prose" />
  ) : null;
}

/** The decisions table's heads, which a phone's rows carry as each cell's lead. */
export const DECISION_HEADS = ['The call', 'Why', 'What else was on the table'] as const;

/** One fact as a tile: its label, its value at the title size, and a line under it. */
interface FactTile {
  readonly label: string;
  readonly value: ReactNode;
  readonly more?: ReactNode;
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 1);
  const parts = { ...ctx, itemLevel: 3 as const };
  const uiLang = uiLangOf(input);
  const footer = footerOutline(input, SECTIONS);
  const study = work.caseStudy;
  const cover = placed(work.cover ?? work.media?.[0], ctx);
  // The facts as tiles (E3): who the owner was in it and for whom; when, and what it's made with.
  const period = work.period ? <PeriodText period={work.period} ctx={ctx} /> : undefined;
  const tools = work.tools?.length ? formatNames(work.tools, ctx) : undefined;
  const candidates: (FactTile | null)[] = [
    present(work.role)
      ? {
          // "Role", since "My part" is the case's own stop about it.
          label: 'Role',
          value: work.role,
          ...(present(work.organization) ? { more: `For ${work.organization}` } : {}),
        }
      : present(work.organization)
        ? { label: 'For', value: work.organization }
        : null,
    period !== undefined
      ? {
          label: 'When',
          value: period,
          ...(tools !== undefined ? { more: <>Made with {tools}</> } : {}),
        }
      : tools !== undefined
        ? { label: 'Made with', value: tools }
        : null,
  ];
  const facts = candidates.filter((fact): fact is FactTile => fact !== null);
  const [primary, ...rest] = work.links ?? [];
  const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
  const overview = overviewOf(sections, input);
  // Back to the tile the visitor opened, on the field it came from.
  const tile = tileAnchor(input, work.id);
  const back = tile ? `${outline.home}#${tile}` : outline.home;
  const backId = `${input.ids.prefix}sb--case-back`;
  const other = outline.next ? undefined : anotherWork(input, overview, work.id);
  const figures = drawn(work, outline, evidenceByIds(work.evidence, input), parts);
  const aside = figures.quote || figures.opening.length > 0;
  return (
    <>
      <main id={input.ids.main} className="sb-page sb-case" tabIndex={-1} lang={work.lang}>
        {/* The field the sheet rose from, receded behind it: decoration, out of reach. */}
        <div className="sb-case__field" aria-hidden="true" inert>
          <Plane model={overviewPlane(overview)} raised />
        </div>
        <article className="sb-case__open" aria-labelledby={`${input.ids.prefix}sb--case-title`}>
          <nav className="sb-case__nav" aria-label="Case study" lang={uiLang}>
            <a className="sb-btn sb-btn--ghost sb-case__back" id={backId} href={back}>
              Back to the field
            </a>
            {outline.previous ? (
              <a className="sb-case__step" href={outline.previous.href}>
                <span className="sb-label">Previous</span>
                <span lang={outline.previous.lang}>{outline.previous.title}</span>
              </a>
            ) : null}
            {outline.next ? (
              <a className="sb-case__step" href={outline.next.href}>
                <span className="sb-label">Next</span>
                <span lang={outline.next.lang}>{outline.next.title}</span>
              </a>
            ) : null}
            {/* Rendered once CaseFocus listens for Escape: the server sends none of its words. */}
            <EscHint back={backId} dir={uiLang ? 'ltr' : undefined} />
          </nav>
          <header className="sb-case__head">
            <div className="sb-tile sb-tile--large sb-case__title">
              <CaseFocus target={`${input.ids.prefix}sb--case-title`} back={backId} />
              <h1 className="sb-case__name" id={`${input.ids.prefix}sb--case-title`} tabIndex={-1}>
                {work.title}
              </h1>
              {present(work.summary) ? (
                <RichText source={work.summary} input={input} className="sb-case__lede" />
              ) : null}
              {primary ? (
                <ul className="sb-hero__actions" role="list">
                  <li>
                    <Button url={primary.url} ctx={ctx} tone="strong">
                      {linkWords(primary)}
                    </Button>
                  </li>
                  {rest.map((link, index) => (
                    <li key={index}>
                      <Button url={link.url} ctx={ctx} tone="ghost">
                        {linkWords(link)}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {facts.length > 0 || work.highlights?.length ? (
              <div className="sb-case__facts">
                {facts.map((fact) => (
                  <dl key={fact.label} className="sb-tile sb-tile--dense sb-fact">
                    <dt className="sb-label" lang={uiLang}>
                      {fact.label}
                    </dt>
                    <dd className="sb-fact__value" lang={work.lang}>
                      {fact.value}
                    </dd>
                    {fact.more !== undefined ? (
                      <dd className="sb-fact__more" lang={work.lang}>
                        {fact.more}
                      </dd>
                    ) : null}
                  </dl>
                ))}
                {work.highlights?.length ? (
                  <div className="sb-tile sb-tile--dense sb-fact">
                    <p className="sb-label" lang={uiLang}>
                      What it did
                    </p>
                    <ul className="sb-checks" role="list" lang={work.lang}>
                      {work.highlights.filter(present).map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>
          <div className="sb-sheet">
            {cover ? (
              <div className="sb-sheet__cover">
                <MediaFigure
                  placed={cover}
                  ctx={ctx}
                  eager
                  sizes="(min-width: 64rem) 80vw, 100vw"
                />
              </div>
            ) : null}
            {present(work.description) && aside ? (
              // The opening words, and beside them on the parts' two tracks what others said of the work and gave it.
              <div className="sb-sheet__parts">
                <RichText source={work.description} input={input} className="sb-prose" />
                <EvidenceItems
                  entries={figures.quote ? [figures.quote] : []}
                  ctx={parts}
                  figures={figures.opening}
                  plain
                  after
                />
              </div>
            ) : present(work.description) ? (
              <RichText
                source={work.description}
                input={input}
                className="sb-prose sb-sheet__about"
              />
            ) : null}
            <div className="sb-sheet__parts">
              {outline.parts.map((part, index) => {
                const next = outline.parts[index + 1];
                return (
                  <Fragment key={part.key}>
                    <section
                      id={part.anchor}
                      className="sb-sheet__part"
                      data-part={part.key}
                      data-wide={
                        part.key === 'decisions' || part.key === 'evidence' ? '' : undefined
                      }
                    >
                      <h2 className="sb-title" lang={uiLang}>
                        {STOPS[part.key]}
                      </h2>
                      <PartBody part={part} study={study} ctx={parts} figures={figures} />
                    </section>
                    {part.key === 'outcomes' && figures.outcomes ? (
                      // What it changed's figure, a stop of its own in the next track: beside it,
                      // and, wide, down beside Looking back too when that follows, so neither
                      // leaves its half of the sheet bare.
                      <div
                        className="sb-sheet__part"
                        data-figure=""
                        data-span={next?.key === 'reflection' ? '' : undefined}
                      >
                        {figures.outcomes}
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            {outline.next ? (
              <a className="sb-sheet__next" href={outline.next.href}>
                <span className="sb-label" lang={uiLang}>
                  Next
                </span>
                <span className="sb-case__next-title" lang={outline.next.lang}>
                  {outline.next.title}
                </span>
              </a>
            ) : (
              // The last case, or the only one: the way on is the way back, and another
              // work of the field beside it, to its tile (S4).
              <div className="sb-sheet__end">
                <a className="sb-sheet__next" href={back} lang={uiLang}>
                  <span className="sb-label">The end of the sheet</span>
                  <span className="sb-case__next-title">Back to the field</span>
                </a>
                {other ? (
                  <div className="sb-sheet__other" lang={other.work.lang}>
                    <p className="sb-label" lang={uiLang}>
                      Also on the field
                    </p>
                    <p className="sb-case__other">
                      <a href={`${outline.home}#${other.anchor}`}>{other.work.title}</a>
                    </p>
                    {present(other.work.summary) ? (
                      <RichText source={other.work.summary} input={input} className="sb-prose" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </article>
      </main>
      <FooterTile input={input} footer={footer} top={`#${input.ids.main}`} sheet />
    </>
  );
}
