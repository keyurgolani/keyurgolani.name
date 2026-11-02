import type { CSSProperties, ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import { Enhancement } from '@portfolio/kit/enhancements';
import {
  evidenceByIds,
  hrefFor,
  MediaFigure,
  placedImage,
  present,
  renderContext,
  type CaseStudyPageProps,
  type CaseStudyPart,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Footer, IndexDialog, PhoneBar } from './chrome/drawing-index';
import { Cell, IndexControl } from './chrome/title-block';
import { Dimension } from './drawing/dimension';
import { SheetBorder } from './drawing/sheet-border';
import { InterfaceFigure } from './figure/interface';
import { detailOf, drawingNumber, filledRows, plainInline, type DetailView } from './model';
import { Phrase, Port, Prose, Span, Ui, words } from './parts';

// A work's own page, /work/<slug> (brief §5.4, step 8): the detail sheet.
// One sheet in the set's border, numbered W-nn among the works with their
// own page, its title the page's one h1. Its head is the work's
// specification; then its views, each a part of the case study in the
// drawing's own vocabulary, every part's id the outline's so the sheet's
// index and the drawing index land: A, the elevation and plan (the
// challenge, the cover with its proportion dimensioned, and the work's
// interface figure); A–A, a section cut through what it sits on (context,
// constraints, role, hatched as strata); ECN, each decision as an
// engineering change notice (reason, what it supersedes); TR, the test
// report (outcomes observed, the evidence that witnessed them); Δ, the
// next revision, the reflection in a revision cloud. Then the way back to
// the sheet that draws the work, the neighbouring detail sheets, and the
// sheet's own corner and the footer's drawing index, as on home.

/** A view's head on the detail sheet: its code in a bubble, its title, and an optional note. */
function ViewHead({ view, lang, note }: { view: DetailView; lang?: string; note?: ReactNode }) {
  return (
    <header className="sx-vt sx-dvt">
      <span className="sx-code" aria-hidden="true">
        {view.code}
      </span>
      <h2 id={`${view.id}--h`} className="sx-vt__title" data-type-role="headline">
        <span className="sx-hidden">{view.code} </span>
        <Ui lang={lang}>{view.title}</Ui>
      </h2>
      {note ? (
        <p className="sx-vt__sub" data-type-role="body-compact">
          <Ui lang={lang}>{note}</Ui>
        </p>
      ) : null}
    </header>
  );
}

/** The part a view holds, by key, for its anchor. */
const partOf = (parts: readonly CaseStudyPart[], key: CaseStudyPart['key']) =>
  parts.find((part) => part.key === key);

/**
 * The work's fact sheet, as a drawing's title block (P2 change 6): its role,
 * period, medium, who it was for, what it was made with and what recognised
 * it, all from the content. It holds the head's end, under the lede, so the
 * sheet never splits into a title column and a fact column.
 */
function FactSheet({ work, input }: { work: Work; input: VariantRenderInput }) {
  const { t, lang } = words(input);
  const medium = t.medium[work.medium];
  const made = (work.tools ?? []).filter(present);
  // Each recognition in its own entry's language, else the work's (P2 review).
  const recognition = evidenceByIds(work.evidence ?? [], input)
    .map((entry) => ({
      text: [
        plainInline(entry.title ?? entry.statement ?? ''),
        entry.organization ?? entry.publication ?? entry.venue,
      ]
        .filter(present)
        .join(', '),
      lang: entry.lang ?? work.lang,
    }))
    .filter((entry) => present(entry.text));
  // Each fact's cell, at its own width: the short facts (medium, who for) a column, the rest two or the row.
  const facts: { key: string; name: string; span: 1 | 2 | 4; value: ReactNode }[] = [];
  if (present(work.role))
    facts.push({
      key: 'role',
      name: t.roleField,
      span: 2,
      value: <span lang={work.lang}>{work.role}</span>,
    });
  if (work.period)
    facts.push({
      key: 'period',
      name: t.period,
      span: 2,
      value: <Span period={work.period} input={input} />,
    });
  if (medium)
    facts.push({ key: 'medium', name: t.medium_, span: 1, value: <Ui lang={lang}>{medium}</Ui> });
  if (present(work.organization))
    facts.push({
      key: 'for',
      name: t.forOrg,
      span: 1,
      value: <span lang={work.lang}>{work.organization}</span>,
    });
  if (made.length)
    facts.push({
      key: 'made',
      name: t.madeWith,
      span: 2,
      value: <span lang={work.lang}>{made.join(', ')}</span>,
    });
  if (recognition.length)
    facts.push({
      key: 'recognition',
      name: t.recognition,
      span: 4,
      value: recognition.map((entry, i) => (
        <span key={i}>
          {i > 0 ? '; ' : null}
          <span lang={entry.lang}>{entry.text}</span>
        </span>
      )),
    });
  const cells = filledRows(facts).map(({ key, name, span, value }) => (
    <Cell key={key} name={name} lang={lang} span={span}>
      {value}
    </Cell>
  ));
  if (cells.length === 0) return null;
  return (
    <div className="sx-tb sx-dfacts" data-at="facts">
      {cells}
    </div>
  );
}

/** The title's longest word, in characters: the step its size may not pass so the word holds one line. */
const longestWord = (title: string) =>
  Math.max(1, ...title.split(/\s+/).map((word) => [...word].length));

/** A: the challenge, the cover with its proportion dimensioned, and the interface figure. */
function Elevation({
  view,
  work,
  input,
  parts,
}: {
  view: DetailView;
  work: Work;
  input: VariantRenderInput;
  parts: readonly CaseStudyPart[];
}) {
  const { t, lang } = words(input);
  const challenge = partOf(parts, 'challenge');
  const placed = work.cover ? placedImage(work.cover, input, undefined) : undefined;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 3);
  const media = placed?.image.state === 'ready' ? placed.image.value : undefined;
  const ratio = media?.width && media.height ? ratioOf(media.width, media.height) : undefined;
  // Every placement past the cover: an image drawn as a plate, any other kind by its caption alone.
  const plates = (work.media ?? [])
    .map((placement) => ({ placement, placed: placedImage(placement, input, undefined) }))
    .filter(({ placement, placed }) => placed || present(placement.caption));
  return (
    <>
      <ViewHead view={view} lang={lang} />
      <div className="sx-view__body sx-elevation">
        {present(work.description) ? (
          <Prose source={work.description} input={input} lang={work.lang} className="sx-spec" />
        ) : null}
        {challenge && present(work.caseStudy?.challenge) ? (
          <div id={challenge.anchor} className="sx-dpart" data-part="challenge">
            <Prose
              source={work.caseStudy!.challenge!}
              input={input}
              lang={work.lang}
              className="sx-spec"
            />
          </div>
        ) : null}
        {placed ? (
          <figure className="sx-cover-view">
            <div className="sx-cover-view__plate">
              <MediaFigure
                placed={{ ...placed, caption: undefined }}
                ctx={ctx}
                eager
                sizes="(min-width: 64rem) 60vw, 100vw"
                inline
              />
              {ratio ? (
                <Dimension axis="v" decorative className="sx-cover-view__dim">
                  {ratio}
                </Dimension>
              ) : null}
            </div>
            <figcaption className="sx-caption" data-type-role="body-compact">
              <span className="sx-caption__no" data-type-role="numeric">
                <Ui lang={lang}>{t.viewA}</Ui>
              </span>{' '}
              {present(work.cover?.caption) ? (
                <Phrase source={work.cover!.caption!} input={input} lang={work.lang} />
              ) : (
                (placed.alt ?? work.title)
              )}
            </figcaption>
          </figure>
        ) : null}
        {/* The work's other media, each a further view of the elevation, as its caption names it. */}
        {plates.length ? (
          <div className="sx-plates">
            {plates.map(({ placement, placed }, i) => (
              <figure key={i} className="sx-cover-view">
                {placed ? (
                  <div className="sx-cover-view__plate">
                    <MediaFigure
                      placed={{ ...placed, caption: undefined }}
                      ctx={ctx}
                      sizes="(min-width: 64rem) 30vw, 100vw"
                      inline
                    />
                  </div>
                ) : null}
                <figcaption className="sx-caption" data-type-role="body-compact">
                  <span className="sx-caption__no" data-type-role="numeric">
                    <Ui lang={lang}>{t.viewA}</Ui>.{i + 2}
                  </span>{' '}
                  {present(placement.caption) ? (
                    <Phrase source={placement.caption} input={input} lang={work.lang} />
                  ) : (
                    (placed?.alt ?? work.title)
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <InterfaceFigure work={work} no={1} input={input} level={3} full />
      </div>
    </>
  );
}

/** The cover's proportion as a drawing states it, width to height in lowest terms: 16 : 10. */
function ratioOf(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const w = Math.round(width);
  const h = Math.round(height);
  const d = gcd(w, h) || 1;
  const [a, b] = [w / d, h / d];
  // A ratio past two digits reads as noise; it's stated to one decimal against 1 instead.
  return a > 99 || b > 99 ? `${(w / h).toFixed(1)} : 1` : `${a} : ${b}`;
}

/** A–A: the section cut, each stratum a part of the case. */
function SectionCut({
  view,
  work,
  input,
  parts,
}: {
  view: DetailView;
  work: Work;
  input: VariantRenderInput;
  parts: readonly CaseStudyPart[];
}) {
  const { t, lang } = words(input);
  const study = work.caseStudy!;
  const strata = (
    [
      ['context', t.siteConditions, study.context],
      ['constraints', t.designLimits, study.constraints],
      ['role', t.drawnBy, study.role],
    ] as const
  ).flatMap(([key, name, text]) => {
    const part = partOf(parts, key);
    return part && present(text) ? [{ key, name, text, part }] : [];
  });
  return (
    <>
      <ViewHead view={view} lang={lang} note={t.sectionCaption} />
      <div className="sx-view__body">
        <p className="sx-cut" aria-hidden="true">
          <span>A</span>
          <span>A</span>
        </p>
        <div className="sx-strata">
          {strata.map(({ key, name, text, part }) => (
            <div key={key} id={part.anchor} className="sx-stratum" data-part={key}>
              <p className="sx-stratum__h sx-field-name" data-type-role="label">
                <Ui lang={lang}>{name}</Ui>
              </p>
              <Prose source={text} input={input} lang={work.lang} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** ECN: each decision an engineering change notice, numbered in content order. */
function ChangeNotices({
  view,
  work,
  input,
  parts,
}: {
  view: DetailView;
  work: Work;
  input: VariantRenderInput;
  parts: readonly CaseStudyPart[];
}) {
  const { t, lang } = words(input);
  const part = partOf(parts, 'decisions')!;
  const decisions = (work.caseStudy?.decisions ?? []).filter((d) => present(d.decision));
  return (
    <>
      <ViewHead view={view} lang={lang} note={t.ecnCaption} />
      <div className="sx-view__body" id={part.anchor} data-part="decisions">
        <ol className="sx-ecns" role="list">
          {decisions.map((decision, i) => (
            <li key={i} className="sx-ecn">
              <p className="sx-ecn__no" data-type-role="numeric">
                <Ui lang={lang}>{t.ecn}</Ui> {i + 1}
              </p>
              <h3 className="sx-ecn__title" data-type-role="title">
                <Phrase source={decision.decision} input={input} lang={work.lang} />
              </h3>
              {present(decision.rationale) || present(decision.alternatives) ? (
                <dl className="sx-ecn__fields">
                  {present(decision.rationale) ? (
                    <div>
                      <dt className="sx-field-name" data-type-role="label">
                        <Ui lang={lang}>{t.reason}</Ui>
                      </dt>
                      <dd>
                        <Prose source={decision.rationale} input={input} lang={work.lang} />
                      </dd>
                    </div>
                  ) : null}
                  {present(decision.alternatives) ? (
                    <div>
                      <dt className="sx-field-name" data-type-role="label">
                        <Ui lang={lang}>{t.supersedes}</Ui>
                      </dt>
                      <dd>
                        <Prose source={decision.alternatives} input={input} lang={work.lang} />
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/** TR: the test report, what was observed and what witnessed it. */
function TestReport({
  view,
  work,
  input,
  parts,
}: {
  view: DetailView;
  work: Work;
  input: VariantRenderInput;
  parts: readonly CaseStudyPart[];
}) {
  const { t, lang } = words(input);
  const outcomes = partOf(parts, 'outcomes');
  const evidence = partOf(parts, 'evidence');
  const cited = evidenceByIds(work.evidence ?? [], input);
  return (
    <>
      <ViewHead view={view} lang={lang} />
      <div className="sx-view__body">
        <div className="sx-report">
          {outcomes && present(work.caseStudy?.outcomes) ? (
            <div id={outcomes.anchor} className="sx-report__observed" data-part="outcomes">
              <p className="sx-field-name" data-type-role="label">
                <Ui lang={lang}>{t.observed}</Ui>
              </p>
              <Prose source={work.caseStudy!.outcomes!} input={input} lang={work.lang} />
            </div>
          ) : null}
          {evidence ? (
            <div id={evidence.anchor} className="sx-report__witness" data-part="evidence">
              <p className="sx-field-name" data-type-role="label">
                <Ui lang={lang}>{t.witnessedBy}</Ui>
              </p>
              {present(work.caseStudy?.evidence) ? (
                <Prose source={work.caseStudy!.evidence!} input={input} lang={work.lang} />
              ) : null}
              {cited.length ? (
                <ul className="sx-refs" role="list" data-type-role="body-compact">
                  {cited.map((entry) => {
                    const date = entry.receivedAt ?? entry.publishedAt ?? entry.presentedAt;
                    const by = [entry.organization ?? entry.publication ?? entry.venue, date]
                      .filter(present)
                      .join(', ');
                    const title = plainInline(entry.title ?? entry.statement ?? '');
                    return (
                      <li key={entry.id} lang={entry.lang}>
                        {entry.url ? <Port href={hrefFor(entry.url, input)}>{title}</Port> : title}
                        {by ? <span className="sx-muted">, {by}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Δ: the next revision, the reflection in a revision cloud. */
function NextRevision({
  view,
  work,
  input,
  parts,
}: {
  view: DetailView;
  work: Work;
  input: VariantRenderInput;
  parts: readonly CaseStudyPart[];
}) {
  const { t, lang } = words(input);
  const part = partOf(parts, 'reflection')!;
  return (
    <>
      <ViewHead view={view} lang={lang} />
      <div className="sx-view__body">
        <div className="sx-cloud" id={part.anchor} data-part="reflection">
          <p className="sx-delta" data-type-role="label">
            <span className="sx-delta__mark" aria-hidden="true" />
            <Ui lang={lang}>{t.notedByAuthor}</Ui>
          </p>
          <Prose source={work.caseStudy!.reflection!} input={input} lang={work.lang} />
        </div>
      </div>
    </>
  );
}

const VIEWS = {
  elevation: Elevation,
  section: SectionCut,
  decisions: ChangeNotices,
  report: TestReport,
  revision: NextRevision,
} as const;

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const { t, lang } = words(input);
  const detail = detailOf(input, work, outline);
  const homeHref = routeHref(input, { route: 'home' });
  const dwg = drawingNumber(input.portfolio.identity.name);
  return (
    <div className="sx" data-sx-page="case">
      {/* The phone bar names the detail sheet by its number alone, so the owner's name stays whole. */}
      <PhoneBar input={input} here={detail.no} />
      <main id={input.ids.main} className="sx-main" tabIndex={-1} data-work-id={work.id}>
        <section
          className="sx-sheet sx-sheet--detail"
          id={detail.id}
          aria-labelledby={detail.titleId}
          data-sheet={detail.no}
          data-sheet-title={work.title}
        >
          <SheetBorder rows={Math.min(6, Math.max(3, detail.views.length + 1))}>
            <header className="sx-dhead">
              <div className="sx-dhead__id">
                <p className="sx-crumb" data-type-role="label">
                  <a href={homeHref}>{input.portfolio.identity.name}</a>
                  <span aria-hidden="true"> / </span>
                  {detail.home ? (
                    <>
                      <a href={detail.home.href} lang={detail.home.lang}>
                        {detail.home.no} {detail.home.label}
                      </a>
                      <span aria-hidden="true"> / </span>
                    </>
                  ) : null}
                  <span>
                    <Ui lang={lang}>{t.detail}</Ui> {detail.no}
                  </span>
                </p>
                {/* The cover's device, on the work: its role and period the dimension over its title. */}
                {present(work.role) || work.period ? (
                  <Dimension className="sx-dhead__dim">
                    <span lang={work.lang}>{work.role}</span>
                    {present(work.role) && work.period ? ', ' : null}
                    {work.period ? <Span period={work.period} input={input} /> : null}
                  </Dimension>
                ) : null}
                <h1
                  id={detail.titleId}
                  className="sx-dhead__title"
                  data-type-role="display"
                  lang={work.lang}
                  style={{ '--layout-word': String(longestWord(work.title)) } as CSSProperties}
                >
                  {work.title}
                </h1>
                {present(work.summary) ? (
                  <Prose
                    source={work.summary}
                    input={input}
                    lang={work.lang}
                    className="sx-dlede"
                  />
                ) : null}
              </div>
              <FactSheet work={work} input={input} />
            </header>
            {detail.views.length > 1 ? (
              <nav className="sx-dparts" aria-label={t.thisSheet}>
                <ol role="list" data-type-role="body-compact">
                  {detail.views.map((view) => (
                    <li key={view.key}>
                      <a href={`#${view.id}`}>
                        <span data-type-role="numeric">{view.code}</span>{' '}
                        <Ui lang={lang}>{view.title}</Ui>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
            <div className="sx-views">
              {detail.views.map((view) => {
                const View = VIEWS[view.key];
                return (
                  <section
                    key={view.key}
                    id={view.id}
                    className={`sx-view sx-dview sx-dview--${view.key}`}
                    aria-labelledby={`${view.id}--h`}
                  >
                    <View view={view} work={work} input={input} parts={outline.parts} />
                  </section>
                );
              })}
            </div>
            <nav className="sx-return" aria-labelledby={`${detail.id}--back`}>
              <p id={`${detail.id}--back`} className="sx-return__h" data-type-role="headline">
                <a href={detail.home?.href ?? homeHref} lang={detail.home?.lang}>
                  {detail.home ? (
                    <Ui lang={lang}>{t.returnTo(`${detail.home.no} ${detail.home.label}`)}</Ui>
                  ) : (
                    <Ui lang={lang}>{t.backToSet}</Ui>
                  )}
                </a>
              </p>
              {outline.previous || outline.next ? (
                <ul className="sx-return__ways" role="list" data-type-role="body-compact">
                  {outline.previous ? (
                    <li>
                      <span className="sx-field-name" data-type-role="label">
                        <Ui lang={lang}>{t.previousDetail}</Ui>
                      </span>{' '}
                      <a href={outline.previous.href} lang={outline.previous.lang}>
                        {outline.previous.title}
                      </a>
                    </li>
                  ) : null}
                  {outline.next ? (
                    <li>
                      <span className="sx-field-name" data-type-role="label">
                        <Ui lang={lang}>{t.nextDetail}</Ui>
                      </span>{' '}
                      <a href={outline.next.href} lang={outline.next.lang}>
                        {outline.next.title}
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="sx-muted" data-type-role="body-compact">
                  <Ui lang={lang}>{t.noFurther}</Ui>
                </p>
              )}
              {outline.related.length ? (
                <p className="sx-return__related" data-type-role="body-compact">
                  <span className="sx-field-name" data-type-role="label">
                    <Ui lang={lang}>{t.relatedSets}</Ui>
                  </span>{' '}
                  {outline.related.slice(0, 3).map((related, i) => (
                    <span key={related.id}>
                      {i > 0 ? ', ' : null}
                      <a href={related.href} lang={related.lang}>
                        {related.title}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </nav>
            <div className="sx-run">
              <span className="sx-run__no" data-type-role="numeric">
                {detail.no}
              </span>
              <IndexControl input={input} />
            </div>
            <div className="sx-tb" data-at="sheet">
              {dwg ? (
                <Cell name={t.drawing} lang={lang}>
                  <span data-type-role="numeric">{`${dwg} / ${detail.no}`}</span>
                </Cell>
              ) : null}
              <Cell name={t.title} lang={lang} span={dwg ? 2 : 3}>
                {work.title}
              </Cell>
              <Cell name={t.sheet} lang={lang}>
                <span data-type-role="numeric">{t.nOf(detail.n, detail.total)}</span>
              </Cell>
            </div>
          </SheetBorder>
        </section>
      </main>
      <Footer input={input} />
      <IndexDialog input={input} />
      <Enhancement input={input} id="sheets" />
    </div>
  );
}
