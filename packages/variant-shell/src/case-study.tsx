import type { ReactNode } from 'react';
import type { Evidence, Work } from '@portfolio/schema';
import { Enhancement } from '@portfolio/kit/enhancements';
import {
  hrefFor,
  MediaFigure,
  navigationModel,
  placedMedia,
  present,
  renderContext,
  RichText,
  sameTarget,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Footer } from './chrome/footer';
import { PaletteDialog } from './chrome/palette-dialog';
import { Pane, paneTotal, type PaneGroup } from './chrome/pane';
import { NoScriptMark, StatusLine } from './chrome/status-line';
import { chromeIds } from './home';
import {
  CitedLinks,
  CitedRecord,
  RecordName,
  recordNameOf,
  RecordTerm,
} from './renderers/evidence';
import {
  alsoWorksOf,
  citedOf,
  controlsOf,
  coverOf,
  cwdOf,
  historyOf,
  manSectionsOf,
  manTitleOf,
  plainInline,
  restMediaOf,
  seeAlsoOf,
  sinceOf,
  type AlsoWork,
  type ManKey,
  type ManSection,
} from './model';
import { CommandLine, Link, outlineFor, Range, Sr, uiLangOf, When, Words } from './parts';

// A work's own page, /work/<slug> (brief §5.6, P2): the case study as a
// man(1) page, read in the same session. The prompt runs `man <slug>`; the
// page heads and foots itself as a manual does (aria-hidden: shell idiom);
// then its sections, each a block the index and the palette land on:
//
//   NAME          the title, the page's one h1, at the 2× step, and the summary
//   SYNOPSIS      the facts the work has, as key and value lines, the cover beside
//   DESCRIPTION   its description, its highlights in brackets, its other pictures
//   the case      each part the outline names, at the outline's anchor
//   HISTORY       the awards it cites
//   SEE ALSO      the other records it cites, and works sharing a tag or a tool
//   AUTHORS       the owner, and the role
//
// Then the way on: `man` the next work, `cd ~` to all work. The index docks
// beside it at 1280 px and up, as home's does, listing the page's sections,
// the works to see, and the way home; the status line is home's, in ~/work.

/** The work's own links: the links it lists, then its address, each target once. */
function linksOf(work: Work, input: VariantRenderInput): { url: string; text: string }[] {
  const list: { url: string; text: string }[] = [];
  const add = (url: string | undefined, text: string) => {
    if (!present(url)) return;
    const href = hrefFor(url, input);
    if (!list.some((each) => sameTarget(hrefFor(each.url, input), href))) list.push({ url, text });
  };
  for (const link of work.links ?? []) add(link.url, link.label ?? link.platform ?? link.url);
  if (work.url) add(work.url, 'Open');
  return list;
}

/** One of the man page's sections: its name at the margin, its body indented under it. */
function ManBlock({
  section,
  cwd,
  ctx,
  title,
  children,
}: {
  section: ManSection;
  cwd: string;
  ctx: RenderContext;
  /**
   * NAME's: the id of the page's h1 inside it, under a margin label alone. The h1 names the
   * article already, so this section takes no name, and a landmark list holds the title once.
   */
  title?: string;
  children: ReactNode;
}) {
  const headed = title === undefined;
  const headId = `${section.anchor}--h`;
  return (
    <section
      className="sh-block sh-man__sec"
      id={section.anchor}
      data-gap="1"
      data-cwd={cwd}
      data-dest="work"
      data-man={section.key}
      aria-labelledby={headed ? headId : undefined}
    >
      {headed ? (
        <h2 className="sh-man__h" id={headId}>
          <Words lang={ctx.uiLang}>{section.label}</Words>
        </h2>
      ) : (
        <p className="sh-man__h" aria-hidden="true">
          <Words lang={ctx.uiLang}>{section.label}</Words>
        </p>
      )}
      <div className="sh-man__body">{children}</div>
    </section>
  );
}

/** SYNOPSIS: only the facts the work has, as key and value lines. */
function Synopsis({
  work,
  awards,
  ctx,
}: {
  work: Work;
  awards: readonly Evidence[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const since = sinceOf(work);
  const links = linksOf(work, input);
  const rows: [string, ReactNode][] = [];
  if (present(work.role)) rows.push(['role', work.role]);
  if (present(work.organization)) rows.push(['for', work.organization]);
  if (since) {
    rows.push([
      since.label,
      work.period ? <Range period={work.period} lang={ctx.uiLang} /> : <When raw={since.raw} />,
    ]);
  }
  rows.push(['medium', work.medium]);
  const tools = (work.tools ?? []).filter(present);
  if (tools.length > 0) rows.push(['tools', tools.join(', ')]);
  const tags = (work.tags ?? []).filter(present);
  if (tags.length > 0) rows.push(['tags', tags.map((tag) => `#${tag}`).join(' ')]);
  if (links.length > 0) {
    rows.push([
      'links',
      <ul className="sh-kv__list" key="links">
        {links.map((link) => (
          <li key={link.url}>
            <Link url={link.url} input={input}>
              {link.text === 'Open' ? <Words lang={ctx.uiLang}>Open</Words> : link.text}
            </Link>
          </li>
        ))}
      </ul>,
    ]);
  }
  if (awards.length > 0) {
    rows.push([
      'recognition',
      <ul className="sh-kv__list sh-kv__list--rows" key="awards">
        {awards.map((record) => (
          <li key={record.id} lang={record.lang}>
            <a href={`#${input.ids.prefix}${record.id}`}>
              <RecordName record={record} ctx={ctx} />
            </a>
            {present(record.organization) && record.organization !== recordNameOf(record) ? (
              <span className="sh-faint"> {record.organization}</span>
            ) : null}
            {record.receivedAt !== undefined ? (
              <span className="sh-faint">
                {', '}
                <When raw={record.receivedAt} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>,
    ]);
  }
  return (
    <dl className="sh-kv sh-man__kv">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>
            <Words lang={ctx.uiLang}>{key}</Words>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** DECISIONS: each a bold line, its reason indented under it, what else was weighed after. */
function Decisions({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ol className="sh-man__dec">
      {(work.caseStudy?.decisions ?? []).map((row, i) => (
        <li key={i}>
          <p className="sh-man__dt">
            <RichText source={row.decision} inline input={input} />
          </p>
          {present(row.rationale) ? (
            <RichText source={row.rationale} input={input} className="sh-prose sh-man__dd" />
          ) : null}
          {present(row.alternatives) ? (
            <div className="sh-man__alt">
              <span className="sh-faint">
                <Words lang={ctx.uiLang}>alternatives:</Words>{' '}
              </span>
              <RichText source={row.alternatives} inline input={input} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** HISTORY: each award the work cites, its year first, as a changelog line. */
function History({ awards, ctx }: { awards: readonly Evidence[]; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ul className="sh-man__hist">
      {awards.map((record) => {
        const name = recordNameOf(record);
        return (
          <li key={record.id} id={`${input.ids.prefix}${record.id}`} lang={record.lang}>
            {record.receivedAt !== undefined ? (
              <span className="sh-fig">
                <When raw={record.receivedAt} />{' '}
              </span>
            ) : null}
            <RecordTerm record={record} ctx={ctx} />
            {present(record.organization) && record.organization !== name ? (
              <span>, {record.organization}</span>
            ) : null}
            {present(record.description) ? (
              <RichText source={record.description} input={input} className="sh-prose" />
            ) : null}
            <CitedLinks entry={record} input={input} named />
          </li>
        );
      })}
    </ul>
  );
}

/** SEE ALSO: the other records the work cites, then works sharing a tag or a tool. */
function SeeAlso({
  records,
  works,
  ctx,
}: {
  records: readonly Evidence[];
  works: readonly AlsoWork[];
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const byId = new Map(input.portfolio.works.map((work) => [work.id, work]));
  return (
    <dl className="sh-man__see">
      {records.map((record) => (
        <CitedRecord
          key={record.id}
          record={record}
          ctx={ctx}
          id={`${input.ids.prefix}${record.id}`}
        />
      ))}
      {works.map((related) => {
        const work = byId.get(related.id);
        const ref = (
          <>
            {related.name}
            <span aria-hidden="true">({related.section})</span>
            <Sr lang={ctx.uiLang}>: {related.title}</Sr>
          </>
        );
        return (
          <div key={related.id} lang={related.lang}>
            <dt>
              {related.href === undefined ? (
                <b className="sh-man__ref">{ref}</b>
              ) : related.routed ? (
                <a className="sh-man__ref" href={related.href} data-sh-work={related.title}>
                  {ref}
                </a>
              ) : (
                <Link url={related.href} input={input} className="sh-man__ref">
                  {ref}
                </Link>
              )}
            </dt>
            <dd>
              {work && present(work.summary) ? (
                <span className="sh-dim">{plainInline(work.summary)} </span>
              ) : null}
              <span className="sh-faint">
                <Words lang={ctx.uiLang}>Shares</Words> {related.shared.join(', ')}.
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const uiLang = uiLangOf(input);
  const model = navigationModel(outlineFor(input));
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 1);
  const ids = chromeIds(input.ids.prefix);
  const { commands, prompt } = controlsOf(input);
  const cwd = cwdOf('work', model);
  const cited = citedOf(work, input);
  const awards = historyOf(cited);
  const also = alsoWorksOf(work, input, outline.related);
  const see = seeAlsoOf(cited, also);
  const sections = manSectionsOf(work, outline, input, also);
  const pages = see.works.filter((related) => related.routed && related.href !== undefined);
  const at = (key: ManKey) => sections.find((section) => section.key === key);
  const title = manTitleOf(work);
  const name = input.portfolio.identity.name;
  const study = work.caseStudy;
  const cover = placedMedia(coverOf(work, input), ctx);
  const rest = restMediaOf(work, input)
    .map((placement) => placedMedia(placement, ctx))
    .filter((placed) => placed !== undefined);
  const highlights = (work.highlights ?? []).filter(present);
  const workDest = model.primary.find(({ id }) => id === 'work');
  const allHref = workDest?.href ?? outline.home;
  const titleId = `${input.ids.prefix}${work.id}--title`;
  const groups: PaneGroup[] = [
    {
      cwd: `man ${work.slug}`,
      destination: 'work',
      rows: sections.map((section) => ({
        href: `#${section.anchor}`,
        target: section.anchor,
        label: section.label,
        verb: 'man',
      })),
    },
    ...(pages.length > 0
      ? [
          {
            cwd: 'see also',
            destination: 'work',
            kind: 'Work' as const,
            rows: pages.map((related) => ({
              href: related.href!,
              title: related.title,
              label: related.title,
              verb: 'man',
              ...(related.lang !== undefined ? { lang: related.lang } : {}),
            })),
          },
        ]
      : []),
    {
      cwd: '~',
      destination: 'home',
      kind: 'Home' as const,
      rows: [{ href: outline.home, label: 'Back to the home page', verb: 'cd' }],
    },
  ];
  const command = (verb: string, args: string) =>
    commands === 'shown' ? (
      <CommandLine input={input} cwd={cwd} command={{ verb, args }} style={prompt} />
    ) : null;
  const block = (key: ManKey, body: ReactNode) => {
    const section = at(key);
    return section ? (
      <ManBlock key={key} section={section} cwd={cwd} ctx={ctx}>
        {body}
      </ManBlock>
    ) : null;
  };
  const text = (source: string | undefined) =>
    present(source) ? <RichText source={source} input={input} className="sh-prose" /> : null;
  return (
    <>
      <div className="sh-session" data-sh-session="" data-pane={controlsOf(input).pane}>
        <NoScriptMark />
        <main id={input.ids.main} className="sh-main" tabIndex={-1}>
          <article
            className="sh-man"
            aria-labelledby={titleId}
            lang={work.lang}
            data-work-id={work.id}
          >
            {command('man', work.slug)}
            {/* The manual's running head and foot: shell idiom, the title already says it. */}
            <p className="sh-man__run" aria-hidden="true">
              <span>{title}</span>
              <span className="sh-man__mid">{name} — Portfolio</span>
              <span>{title}</span>
            </p>
            <div className="sh-man__top" data-cover={cover ? '' : undefined}>
              <div className="sh-man__lead">
                {at('name') ? (
                  <ManBlock section={at('name')!} cwd={cwd} ctx={ctx} title={titleId}>
                    <h1 className="sh-man__title" id={titleId}>
                      {work.title}
                    </h1>
                    {present(work.summary) ? (
                      <RichText
                        source={work.summary}
                        input={input}
                        className="sh-prose sh-man__sum"
                      />
                    ) : null}
                  </ManBlock>
                ) : null}
                {block('synopsis', <Synopsis work={work} awards={awards} ctx={ctx} />)}
              </div>
              {cover ? (
                <div className="sh-man__cover">
                  <MediaFigure
                    placed={cover}
                    ctx={ctx}
                    eager
                    sizes="(min-width: 64rem) 40ch, 100vw"
                  />
                </div>
              ) : null}
            </div>
            {block(
              'description',
              <>
                {text(work.description)}
                {highlights.length > 0 ? (
                  <ul className="sh-figs">
                    {highlights.map((highlight, i) => (
                      <li key={i}>{highlight}</li>
                    ))}
                  </ul>
                ) : null}
                {rest.length > 0 ? (
                  <div className="sh-man__media">
                    {rest.map((placed, i) => (
                      <MediaFigure
                        key={i}
                        placed={placed}
                        ctx={ctx}
                        sizes="(min-width: 48rem) 36ch, 100vw"
                      />
                    ))}
                  </div>
                ) : null}
              </>,
            )}
            {outline.parts.map((part) => {
              if (part.key === 'decisions')
                return block('decisions', <Decisions work={work} ctx={ctx} />);
              if (part.key === 'evidence') {
                return block(
                  'evidence',
                  <>
                    {text(study.evidence)}
                    {cited.length > 0 ? (
                      <p className="sh-faint">
                        <Words lang={ctx.uiLang}>Cited records:</Words>{' '}
                        {[
                          awards.length > 0 && at('history') ? (
                            <a key="h" href={`#${at('history')!.anchor}`}>
                              <Words lang={ctx.uiLang}>History</Words>
                            </a>
                          ) : null,
                          see.records.length > 0 && at('see-also') ? (
                            <a key="s" href={`#${at('see-also')!.anchor}`}>
                              <Words lang={ctx.uiLang}>See also</Words>
                            </a>
                          ) : null,
                        ]
                          .filter(Boolean)
                          .flatMap((link, i) => (i > 0 ? [', ', link] : [link]))}
                      </p>
                    ) : null}
                  </>,
                );
              }
              return block(part.key, text(study[part.key]));
            })}
            {block('history', <History awards={awards} ctx={ctx} />)}
            {block('see-also', <SeeAlso records={see.records} works={see.works} ctx={ctx} />)}
            {block(
              'authors',
              <p className="sh-prose">
                {name}
                {present(work.role) ? `, ${work.role}` : ''}
                {present(work.organization) ? (
                  <>
                    {' '}
                    <Words lang={ctx.uiLang}>for</Words> {work.organization}
                  </>
                ) : null}
                .
              </p>,
            )}
            <p className="sh-man__run sh-man__run--foot" aria-hidden="true">
              <span>{name}</span>
              <span className="sh-man__mid">
                {sinceOf(work) ? <When raw={sinceOf(work)!.raw} /> : null}
              </span>
              <span>{title}</span>
            </p>
          </article>
          {/* The way on: the next work's page, then all work. */}
          <nav className="sh-man__on" aria-label="More work" lang={uiLang}>
            {outline.next ? (
              <>
                {command('man', outline.next.slug)}
                <p className="sh-man__go">
                  <span className="sh-faint">
                    <Words lang={uiLang}>Next:</Words>{' '}
                  </span>
                  <a
                    href={outline.next.href}
                    lang={outline.next.lang}
                    data-sh-work={outline.next.title}
                  >
                    {outline.next.title}
                  </a>
                </p>
              </>
            ) : null}
            {command('cd', '~')}
            <p className="sh-man__go sh-man__all">
              <a href={allHref}>
                <Words lang={uiLang}>All work</Words>
              </a>
            </p>
          </nav>
        </main>
        <Pane input={input} groups={groups} id={ids.index} command={`man ${work.slug}`} whole />
        <Footer input={input} cwd={cwd} />
      </div>
      <StatusLine
        input={input}
        model={model}
        total={paneTotal(groups)}
        indexHref={`#${ids.index}`}
        dialogId={ids.dialog}
        cwd={cwd}
      />
      <PaletteDialog input={input} id={ids.dialog} />
      <Enhancement input={input} id="palette" />
    </>
  );
}
