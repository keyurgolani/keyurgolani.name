import type { CSSProperties, ReactNode } from 'react';
import type { Evidence, Work } from '@portfolio/schema';
import {
  CASE_STUDY_FIELDS,
  DateText,
  formatFigure,
  hrefFor,
  MediaFigure,
  PeriodText,
  placedImage,
  placedMedia,
  present,
  renderContext,
  RichText,
  sameTarget,
  type CaseStudyField,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Foot, type IndexColumn } from './chrome/foot';
import { HeaderRow } from './chrome/header-row';
import { Ticker } from './chrome/ticker';
import { RawGridClient } from './enhancements/raw-grid';
import {
  caseRows,
  caseStickers,
  caseTicker,
  chromeIds,
  citedOf,
  homeModel,
  mediumWords,
  nextWork,
  otherMedia,
  plainWords,
  recordHref,
  titleChars,
  workHref,
} from './model';
import { Stickers } from './opening/poster';
import { caseOf, Checks, Fit, Line, Lines, linkText, Out, Words } from './parts';
import { RuledTable } from './renderers/ruled-table';

// A work's own page, /work/<slug> (phase 2): the case pasted up as a poster
// of its own, on the same gutterless field, under the same ticker and the
// same header row, with Work the current page.
//
//   the opening   the poster: the way back to all work, what it is and
//                 when, the title as the page's one h1, the premise pasted
//                 on, the work's own links as block buttons, and up to
//                 three stickers of what it cites; beside it the fact
//                 sheet, ruled rows of only the facts it has, and its
//                 highlights checked off, which the ticker runs
//   the work      the cover across eight columns, its description beside it
//   the case      each part a band with its name as black tape: two short
//                 texts share a row, the decisions are a ruled table, the
//                 evidence is its cited records each a cell of its own,
//                 the reflection is set at headline size across its band
//   the way on    the next work on the prominent ground, and all work
//
// The foot is home's: the index (led by the case's own parts), the ink
// block, the colophon.

type ViewWork = CaseStudyPageProps['work'];

/** A part's name, as its band's tape and its entry in the index. */
const PART_NAMES = new Map<CaseStudyField, string>(CASE_STUDY_FIELDS);

/** What a cited record's cell is labelled by, in the composition's words. */
const RECORD_WORDS: Readonly<Record<string, string>> = {
  award: 'Recognition',
  press: 'Written up in',
  publication: 'Published',
  metric: 'Figure',
  testimonial: 'In their words',
  talk: 'Talk',
  patent: 'Patent',
  exhibition: 'Shown at',
  client: 'Client',
  recording: 'Recording',
  repository: 'Repository',
  'external-work': 'Elsewhere',
};

/** Where a part's band is: the outline's anchor. */
const partId = (input: VariantRenderInput, work: ViewWork, key: CaseStudyField) =>
  `${input.ids.prefix}${work.id}--${key}`;

/** The work's own links, as the poster's block buttons: its address, then its links, each once. */
function actionsOf(work: Work, input: VariantRenderInput) {
  const list: { href: string; text: string }[] = [];
  const add = (url: string | undefined, text: string) => {
    if (!present(url)) return;
    const href = hrefFor(url, input);
    if (!list.some((each) => sameTarget(each.href, href))) list.push({ href, text });
  };
  if (work.url) add(work.url, linkText({ url: work.url }));
  for (const link of work.links ?? []) add(link.url, linkText(link));
  return list;
}

/** When the work is from, as the fact sheet and the poster's meta line say it. */
function when(work: Work, ctx: RenderContext): ReactNode {
  if (work.publishedAt !== undefined) return <DateText raw={work.publishedAt} ctx={ctx} />;
  if (work.releasedAt !== undefined) return <DateText raw={work.releasedAt} ctx={ctx} />;
  if (work.period) return <PeriodText period={work.period} ctx={ctx} />;
  return null;
}

/** The fact sheet's rows: only the facts the work has, less what the poster's meta line says. */
function factRows(
  work: Work,
  cited: readonly Evidence[],
  ctx: RenderContext,
): readonly [string, ReactNode][] {
  const { input } = ctx;
  const linked = (record: Evidence, text: string, date?: string) => (
    <>
      <a href={recordHref(record, input)}>{text}</a>
      {date !== undefined ? (
        <>
          {', '}
          <DateText raw={date} ctx={ctx} />
        </>
      ) : null}
    </>
  );
  const awards = cited.filter((record) => record.type === 'award' && present(record.title));
  const press = cited.filter(
    (record) =>
      (record.type === 'press' && present(record.publication)) ||
      (record.type === 'publication' && present(record.venue)),
  );
  const rows: [string, ReactNode][] = [];
  if (present(work.role)) rows.push(['Role', work.role]);
  if (present(work.organization)) rows.push(['For', work.organization]);
  if (work.tools?.length) rows.push(['Built with', work.tools.filter(present).join(', ')]);
  for (const record of awards) {
    rows.push(['Recognition', linked(record, record.title!, record.receivedAt)]);
  }
  for (const record of press) {
    rows.push([
      record.type === 'press' ? 'Written up in' : 'Published in',
      linked(record, (record.publication ?? record.venue)!, record.publishedAt),
    ]);
  }
  return rows;
}

/** One cited record, a cell of its own, labelled by what it is. */
function RecordCell({ record, ctx }: { record: Evidence; ctx: RenderContext }) {
  const { input } = ctx;
  const words = RECORD_WORDS[record.type];
  const quote = record.excerpt ?? (record.type === 'testimonial' ? record.statement : undefined);
  const date =
    record.publishedAt ??
    record.presentedAt ??
    record.receivedAt ??
    record.grantedAt ??
    record.filedAt ??
    record.asOf;
  const figure = record.type === 'metric' ? record.metric?.value : undefined;
  return (
    <article
      className="rg-cell rg-item"
      id={`${input.ids.prefix}${record.id}`}
      lang={record.lang}
      data-type={record.type}
    >
      {words ? (
        <p className="rg-tab">
          <Fit text={words}>
            <Words lang={ctx.uiLang}>{words}</Words>
          </Fit>
        </p>
      ) : null}
      {figure !== undefined ? (
        <p className="rg-fact__n">
          {formatFigure(figure, ctx)}
          {present(record.metric?.unit) ? (
            <span className="rg-fact__unit"> {record.metric!.unit}</span>
          ) : null}
        </p>
      ) : null}
      <Line
        className="rg-meta"
        parts={[
          record.venue ?? record.publication ?? record.organization,
          date !== undefined ? <DateText key="d" raw={date} ctx={ctx} /> : null,
        ]}
      />
      {present(record.title) ? (
        <h3 className="rg-item__title">
          <Fit text={record.url ? `${record.title}↗` : record.title}>
            {record.url ? (
              <Out href={hrefFor(record.url, input)}>{record.title}</Out>
            ) : (
              record.title
            )}
          </Fit>
        </h3>
      ) : null}
      {present(quote) ? (
        <blockquote className="rg-item__quote">
          <RichText source={quote} input={input} />
        </blockquote>
      ) : present(record.statement) ? (
        <RichText source={record.statement} input={input} />
      ) : null}
      {present(record.description) ? (
        <RichText source={record.description} className="rg-item__desc" input={input} />
      ) : null}
      {record.source ? (
        <Line className="rg-meta" parts={[record.source.name, record.source.organization]} />
      ) : null}
      {!present(record.title) && record.url ? (
        <p>
          <Out href={hrefFor(record.url, input)}>
            <Words lang={ctx.uiLang}>Read</Words>
          </Out>
        </p>
      ) : null}
    </article>
  );
}

/** A part's band: its tape over its cells, its own landmark at its outline anchor. */
function Part({
  id,
  name,
  count,
  ctx,
  children,
  wide,
}: {
  id: string;
  name: string;
  count?: number;
  ctx: RenderContext;
  children: ReactNode;
  wide?: 'columns' | 'set';
}) {
  return (
    <section className="rg-band rg-part" id={id} aria-labelledby={`${id}-head`} data-wide={wide}>
      <div className="rg-cell rg-band__head">
        <h2 className="rg-tab" id={`${id}-head`}>
          <Fit text={name}>
            <Words lang={ctx.uiLang}>{name}</Words>
          </Fit>
        </h2>
        {count !== undefined && count > 1 ? (
          <p className="rg-band__count">
            <span className="rg-num">{count}</span> <Words lang={ctx.uiLang}>entries</Words>
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A text alone on its row fills the band, never a measure in its corner: past this many
 * characters it sets in two columns, and short of it a step up across the band, balanced.
 */
const WIDE_TEXT = 320;

function PartBand({
  part,
  work,
  cited,
  ctx,
  alone,
}: {
  part: CaseStudyField;
  work: ViewWork;
  cited: readonly Evidence[];
  ctx: RenderContext;
  alone: boolean;
}) {
  const { input } = ctx;
  const study = work.caseStudy;
  const id = partId(input, work, part);
  const name = PART_NAMES.get(part)!;
  if (part === 'decisions') {
    const decisions = study.decisions ?? [];
    const anyAlternative = decisions.some((row) => present(row.alternatives));
    return (
      <Part id={id} name={name} count={decisions.length} ctx={ctx}>
        <RuledTable
          rows={decisions}
          variant="decisions"
          caption={name}
          uiLang={ctx.uiLang}
          rowId={() => undefined}
          columns={[
            {
              key: 'decision',
              head: 'Decision',
              cell: (row) => (
                <p className="rg-t-title">
                  <RichText source={row.decision} inline input={input} />
                </p>
              ),
            },
            {
              key: 'why',
              head: 'Why',
              cell: (row) =>
                present(row.rationale) ? (
                  <>
                    <Words lang={ctx.uiLang}>
                      <span className="rg-t-k">Why</span>
                    </Words>
                    <RichText source={row.rationale} input={input} />
                  </>
                ) : null,
            },
            {
              key: 'instead',
              head: 'Instead of',
              // A cell's label shows where the column heads don't (a phone), and is read with it.
              // None recorded: a dash, so the column's cell isn't a blank box; read as "none".
              cell: (row) =>
                present(row.alternatives) ? (
                  <>
                    <Words lang={ctx.uiLang}>
                      <span className="rg-t-k">Instead of</span>
                    </Words>
                    <RichText source={row.alternatives} input={input} />
                  </>
                ) : anyAlternative ? (
                  <>
                    <Words lang={ctx.uiLang}>
                      <span className="rg-t-k">Instead of</span>
                    </Words>
                    <span aria-hidden="true">—</span>
                    <Words lang={ctx.uiLang}>
                      <span className="rg-hidden">None recorded</span>
                    </Words>
                  </>
                ) : null,
            },
          ]}
        />
      </Part>
    );
  }
  if (part === 'reflection') {
    return (
      <Part id={id} name={name} ctx={ctx}>
        {/* The case's last word, at headline size across the band: a line, not a card. */}
        <div className="rg-cell rg-reflect">
          <RichText source={study.reflection!} input={input} />
        </div>
      </Part>
    );
  }
  const text = study[part];
  const records = part === 'evidence' ? cited : [];
  return (
    <Part
      id={id}
      name={name}
      count={records.length}
      ctx={ctx}
      wide={
        alone && records.length === 0 && present(text)
          ? text.length > WIDE_TEXT
            ? 'columns'
            : 'set'
          : undefined
      }
    >
      {present(text) ? (
        <div className="rg-cell">
          <RichText source={text} input={input} />
        </div>
      ) : null}
      {records.map((record) => (
        <RecordCell key={record.id} record={record} ctx={ctx} />
      ))}
    </Part>
  );
}

/** The cover across eight columns, the description beside it, the work's other pictures after. */
function TheWork({ work, ctx, headId }: { work: ViewWork; ctx: RenderContext; headId: string }) {
  const { input } = ctx;
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  // The first of the media is gone from the rest only when it became the cover.
  const rest = otherMedia(work, !work.cover && cover !== undefined)
    .map((placement) => placedMedia(placement, ctx))
    .filter((placed) => placed !== undefined);
  if (!cover && !present(work.description) && rest.length === 0) return null;
  return (
    <section className="rg-field" aria-labelledby={headId}>
      <div className="rg-cell rg-band__head">
        <h2 className="rg-tab" id={headId}>
          <Words lang={ctx.uiLang}>The work</Words>
        </h2>
      </div>
      {cover ? (
        <div className="rg-cell rg-case__media">
          <MediaFigure placed={cover} ctx={ctx} eager sizes="(min-width: 48rem) 60vw, 100vw" />
        </div>
      ) : null}
      {present(work.description) ? (
        <div className="rg-cell">
          <RichText source={work.description} input={input} />
        </div>
      ) : null}
      {rest.map((placed, index) => (
        <figure key={index} className="rg-cell rg-photo">
          <div className="rg-photo__mat">
            <MediaFigure
              placed={{ ...placed, caption: undefined }}
              ctx={ctx}
              inline
              sizes="(min-width: 48rem) 30vw, 100vw"
            />
          </div>
          {placed.caption ? (
            <figcaption className="rg-photo__cap">{placed.caption}</figcaption>
          ) : null}
        </figure>
      ))}
    </section>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const model = homeModel(input);
  const ids = chromeIds(input.ids.prefix);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 1);
  const cited = citedOf(work, input);
  const stickers = caseStickers(work, input);
  const actions = actionsOf(work, input);
  const facts = factRows(work, cited, ctx);
  const highlights = (work.highlights ?? []).filter(present);
  const parts = outline.parts.map(({ key }) => key);
  const rows = caseRows(parts, cited.length > 0);
  const next = nextWork(work, input);
  const sheet = model.sheets.find(({ id }) => id === 'work');
  const label = sheet?.label ?? 'Work';
  const allHref = sheet ? `${outline.home}#${ids.sheet('work')}` : outline.home;
  const nextHref = next
    ? (workHref(next, input) ?? `${outline.home}${recordHref(next, input)}`)
    : undefined;
  const titleId = `${input.ids.prefix}${work.id}--title`;
  const factsId = `${input.ids.prefix}${work.id}--facts`;
  const lead: IndexColumn = {
    id: 'case',
    label: work.title,
    ...(work.lang !== undefined ? { lang: work.lang } : {}),
    entries: outline.parts.map((part) => ({
      id: part.key,
      title: PART_NAMES.get(part.key)!,
      href: part.href,
      ...(ctx.uiLang ? { lang: ctx.uiLang } : {}),
    })),
  };
  return (
    <>
      <RawGridClient />
      <Ticker
        facts={caseTicker(work, input)}
        uiLang={model.uiLang}
        policy={input.presentation.motionPolicy}
      />
      <HeaderRow
        input={input}
        model={model}
        current="work"
        home={outline.home}
        rest={[label, 'Case study']}
      />
      <main id={input.ids.main} className="rg-main" tabIndex={-1}>
        <Lines />
        <article
          className="rg-casepage"
          aria-labelledby={titleId}
          lang={work.lang}
          data-sheet="work"
          data-word={label}
          data-work-id={work.id}
        >
          <div
            className="rg-field rg-opening"
            data-thesis="none"
            data-pin="none"
            data-facts={facts.length > 0 || highlights.length > 0 ? undefined : 'none'}
          >
            <div
              className={
                stickers.length > 0 ? 'rg-cell rg-poster rg-poster--stuck' : 'rg-cell rg-poster'
              }
            >
              <div className="rg-poster__top">
                <p className="rg-poster__role">
                  <a href={allHref}>
                    <Words lang={ctx.uiLang}>All work</Words>
                  </a>
                </p>
                <Line
                  className="rg-meta"
                  parts={[
                    mediumWords(work) ? (
                      <Words key="m" lang={ctx.uiLang}>
                        {mediumWords(work)}
                      </Words>
                    ) : null,
                    when(work, ctx),
                  ]}
                />
              </div>
              {/* The name's fit: its longest word, or a third of it, fills the poster's column. */}
              <h1
                className="rg-name rg-case__title"
                id={titleId}
                style={{ '--layout-name-chars': titleChars(work.title) } as CSSProperties}
                {...caseOf(work.title)}
              >
                {work.title}
              </h1>
              {present(work.summary) ? (
                <div className="rg-paste">
                  <RichText source={work.summary} className="rg-paste__lede" input={input} />
                </div>
              ) : null}
              {actions.length > 0 ? (
                <ul className="rg-actions" role="list">
                  {actions.map((action, index) => (
                    <li
                      key={action.href}
                      className="rg-act"
                      data-ui-surface={index === 0 ? 'accent' : undefined}
                    >
                      <Out className="rg-go rg-btn" href={action.href}>
                        {action.text}
                      </Out>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Stickers stickers={stickers} input={input} uiLang={ctx.uiLang} />
            </div>
            {facts.length > 0 || highlights.length > 0 ? (
              <section className="rg-cell rg-thesis rg-facts" aria-labelledby={factsId}>
                <h2 className="rg-tab" id={factsId}>
                  <Words lang={ctx.uiLang}>Fact sheet</Words>
                </h2>
                {facts.length > 0 ? (
                  <dl className="rg-dl">
                    {facts.map(([term, value], index) => (
                      <div key={index}>
                        <dt>
                          <Words lang={ctx.uiLang}>{term}</Words>
                        </dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <Checks items={highlights} />
              </section>
            ) : null}
          </div>
          <TheWork work={work} ctx={ctx} headId={`${input.ids.prefix}${work.id}--work`} />
          {rows.length > 0 ? (
            <div className="rg-field">
              {rows.map((row) =>
                row.length === 2 ? (
                  <div key={row.join(' ')} className="rg-pair">
                    {row.map((part) => (
                      <PartBand
                        key={part}
                        part={part}
                        work={work}
                        cited={cited}
                        ctx={ctx}
                        alone={false}
                      />
                    ))}
                  </div>
                ) : (
                  <PartBand key={row[0]} part={row[0]!} work={work} cited={cited} ctx={ctx} alone />
                ),
              )}
            </div>
          ) : null}
          {/* The way on, beside all work. With no next work it isn't drawn: the poster's All
              work already leads back, and All work alone would be a lone cell the width. */}
          {next && nextHref ? (
            <nav className="rg-field rg-next" aria-labelledby={`${input.ids.prefix}rg--next`}>
              <p className="rg-hidden" id={`${input.ids.prefix}rg--next`}>
                <Words lang={ctx.uiLang}>More work</Words>
              </p>
              <a className="rg-cell rg-next__go" href={nextHref} lang={next.lang}>
                <span className="rg-meta">
                  <Words lang={ctx.uiLang}>Next work</Words>
                </span>
                <span
                  className="rg-name rg-next__title"
                  style={{ '--layout-name-chars': titleChars(next.title) } as CSSProperties}
                  {...caseOf(next.title)}
                >
                  {next.title}
                </span>
                {/* Plain words: the cell is the link, and a link inside it would nest. */}
                {present(next.summary) ? (
                  <span className="rg-next__sum">{plainWords(next.summary)}</span>
                ) : null}
              </a>
              <a className="rg-cell rg-next__all" href={allHref}>
                <span className="rg-meta">{label}</span>
                <span className="rg-next__title">
                  <Words lang={ctx.uiLang}>All work</Words>
                </span>
              </a>
            </nav>
          ) : null}
        </article>
      </main>
      <Foot input={input} model={model} home={outline.home} lead={lead} />
    </>
  );
}
