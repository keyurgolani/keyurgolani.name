import type { CSSProperties, ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  anchorSection,
  DateText,
  evidenceByIds,
  footerOutline,
  hrefFor,
  LinkText,
  MediaFigure,
  PeriodText,
  placedMedia,
  present,
  renderContext,
  RichText,
  VisitorControlSlot,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { BoardMap, type BoardMark } from './board-map';
import { changeIn, countsIn, type Change, type Count } from './figures';
import { SECTIONS } from './compose';
import { Credits } from './credits';
import { mediumLabel } from './model';
import { firstSentence, ownId, uiLang, Words } from './parts';
import { anchorOfScene } from './scene';
import { homeScenes, recordId } from './scenes';

// The case study as a storyboard (redesign): the work's own page read top
// to bottom as the film's scenes. A slate opens it, the work's title, its
// still, and a fact sheet that folds in the role, the context, and the
// constraints; then a scene for each part the owner wrote, each one led by
// its own first sentence, not its label: the challenge, every decision, the
// evidence, the outcomes, and the reflection. The decisions and the
// outcomes are slabs on the matte; the rest are frames on the canvas, only
// their top bar black, so the page alternates the way the film cuts. The scenes' own minimap sits on the
// bottom edge; the next case study and the way back to the film close it,
// then a short credits roll.

type Study = CaseStudyPageProps['work']['caseStudy'];

/**
 * One scene of the board. A scene with a picture of its own, a figure its
 * words hold or the award it won, is split on the module: the frame on seven
 * columns, its heading and words on five. One without is a slab on the
 * matte, as wide as its words, its line at the title card's size. The takes
 * sit side by side in one row.
 */
interface BoardScene {
  readonly key: string;
  /** Its id, with the prefix. */
  readonly id: string;
  /** What its bar and the minimap call it. */
  readonly label: string;
  readonly layout: 'split' | 'slab' | 'take';
  /** Whether it's on the matte, the takes and the final cut, or a frame on the canvas. */
  readonly matte: boolean;
  /** The split scene's picture. */
  readonly frame?: ReactNode;
  readonly body: ReactNode;
}

/** The context's counts as a figure: one square a thing, the first count drawn, every count captioned. */
function CountFigure({ counts, lang }: { counts: readonly Count[]; lang: 'en' | undefined }) {
  const [drawn] = counts;
  if (!drawn || drawn.count > 120) return null;
  return (
    <figure className="hc-board__figure hc-board__count">
      <ul className="hc-board__squares" aria-hidden="true" role="list">
        {Array.from({ length: drawn.count }, (_, index) => (
          <li key={index} />
        ))}
      </ul>
      <figcaption className="hc-board__tally">
        {counts.slice(0, 3).map((one, index) => (
          <span key={`${index}-${one.count}-${one.of}`}>
            <strong data-type-role="headline">{one.count}</strong>{' '}
            <span data-type-role="label">{one.of}</span>
          </span>
        ))}
        <span className="hc-visually-hidden">
          <Words lang={lang}>, from the context</Words>
        </span>
      </figcaption>
    </figure>
  );
}

/** A change as two bars, before and after, each as long as its number, labelled with it. */
function ChangeFigure({ change, lang }: { change: Change; lang: 'en' | undefined }) {
  // The bars share one scale, the before side's unit; each label keeps its own number and unit.
  const after = change.toAsFrom ?? change.to;
  const most = Math.max(change.from, after);
  const bar = (
    value: number,
    length: number,
    unit: string | undefined,
    label: string,
    last: boolean,
  ) => (
    <div className="hc-board__bar" data-after={last ? '' : undefined}>
      <dt data-type-role="label">
        <Words lang={lang}>{label}</Words>
      </dt>
      <dd>
        <span
          className="hc-board__fill"
          style={{ '--layout-share': length / most } as CSSProperties}
          aria-hidden="true"
        />
        <span data-type-role="headline">{value}</span>
        {unit ? <span data-type-role="label"> {unit}</span> : null}
      </dd>
    </div>
  );
  return (
    <figure className="hc-board__figure hc-board__change">
      <dl>
        {bar(change.from, change.from, change.unit, 'Before', false)}
        {bar(change.to, after, change.toUnit ?? change.unit, 'After', true)}
      </dl>
      <figcaption data-type-role="label">{change.measure}</figcaption>
    </figure>
  );
}

/** The award the work won, set as a plate on the matte: who gave it, when, and what for. */
function AwardPlate({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const by = present(entry.organization) ? entry.organization : undefined;
  return (
    <div className="hc-board__figure hc-board__plate">
      {by || entry.receivedAt ? (
        <p data-type-role="label">
          {by}
          {entry.receivedAt ? (
            <>
              {by ? ', ' : null}
              <DateText raw={entry.receivedAt} ctx={ctx} />
            </>
          ) : null}
        </p>
      ) : null}
      <p className="hc-board__plate-title" data-type-role="display">
        {entry.title}
      </p>
      {present(entry.description) ? <p data-type-role="body">{entry.description}</p> : null}
    </div>
  );
}

/** What the slate says follows it, from the film's first stop to its last, as they're named. */
function followText(labels: readonly string[]): string {
  // "The rushes" reads "the rushes", not "the the rushes".
  const name = (label: string) => {
    const bare = label.replace(/^the\s+/i, '');
    return bare.charAt(0).toLowerCase() + bare.slice(1);
  };
  const [first] = labels;
  const last = labels.at(-1);
  if (!first || !last) return '';
  if (labels.length === 1) return `1 scene follows, the ${name(first)}`;
  return `${labels.length} scenes follow, from the ${name(first)} to the ${name(last)}`;
}

/**
 * The board's own names for its stops, in the film's words, never the case
 * study's field names: the challenge is the cold open, each decision a
 * take, the evidence the rushes, the outcomes the final cut, and the
 * reflection the director's commentary.
 */
const STOPS = {
  challenge: 'Cold open',
  context: 'The set',
  decision: (number: number) => `Take ${number}`,
  evidence: 'The rushes',
  outcomes: 'Final cut',
  reflection: "Director's commentary",
} as const;

/** A part led by its own first sentence, at headline size, its label above it as a heading. */
function Led({
  id,
  label,
  text,
  input,
  shown = false,
  children,
}: {
  id: string;
  label: string;
  text: string | undefined;
  input: VariantRenderInput;
  /** A split scene shows its heading over its words; a slab's bar names it. */
  shown?: boolean;
  children?: ReactNode;
}) {
  const { lead, rest } = present(text) ? firstSentence(text) : { lead: '', rest: undefined };
  return (
    <>
      <h2
        id={`${id}-heading`}
        className={shown ? 'hc-board__heading' : 'hc-visually-hidden'}
        data-type-role="title"
      >
        <Words lang={uiLang(input.portfolio.locale)}>{label}</Words>
      </h2>
      {lead ? (
        <div className="hc-board__lead" data-type-role="headline">
          <RichText source={lead} input={input} />
        </div>
      ) : null}
      {rest ? <RichText source={rest} className="hc-board__body" input={input} /> : null}
      {children}
    </>
  );
}

/** A piece of evidence as the board cites it: what it is, who gave it, and its words. */
function Cited({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const by =
    entry.type === 'press'
      ? entry.publication
      : entry.type === 'award'
        ? entry.organization
        : entry.type === 'testimonial'
          ? [entry.source?.name, entry.source?.organization].filter(present).join(', ')
          : undefined;
  const when =
    entry.type === 'press'
      ? entry.publishedAt
      : entry.type === 'award'
        ? entry.receivedAt
        : undefined;
  const words =
    entry.type === 'press'
      ? entry.excerpt
      : entry.type === 'testimonial'
        ? entry.statement
        : undefined;
  return (
    <li className="hc-board__cited">
      {present(words) ? (
        <blockquote data-type-role="title">
          <p>{words}</p>
        </blockquote>
      ) : null}
      <p data-type-role="label">
        {present(entry.title) ? <strong>{entry.title}</strong> : null}
        {present(by) ? `, ${by}` : null}
        {when ? (
          <>
            {', '}
            <DateText raw={when} ctx={ctx} />
          </>
        ) : null}
      </p>
    </li>
  );
}

/** The slate's facts: one row a fact, the folded parts keeping their anchors. */
function FactSheet({
  rows,
  lang,
}: {
  rows: readonly { label: string; id?: string; value: ReactNode }[];
  lang: 'en' | undefined;
}) {
  if (rows.length === 0) return null;
  return (
    <dl className="hc-board__facts">
      {rows.map((row) => (
        <div key={row.label} id={row.id}>
          <dt data-type-role="label">
            <Words lang={lang}>{row.label}</Words>
          </dt>
          <dd data-type-role="body-compact">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const { ids, portfolio } = input;
  const prefix = ids.prefix;
  const lang = uiLang(portfolio.locale);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 1);
  const study: Study = work.caseStudy;
  const footer = footerOutline(input, SECTIONS);
  const creditsId = ownId(prefix, 'credits');
  // Each part's anchor, as the outline gives it, else the same form it would take.
  const anchorOf = (key: string) =>
    outline.parts.find((part) => part.key === key)?.anchor ?? `${prefix}${work.id}--${key}`;

  // Where the work is in the film, for the way back.
  const { scenes: film } = homeScenes(input);
  const inFilm =
    film.find((scene) => scene.kind === 'lead' && scene.work.id === work.id) ??
    film.find((scene) => scene.kind === 'reel' && scene.items.some((item) => item.id === work.id));
  // A work the film has no room for waits in the full record, where its own anchor opens it.
  const listedBy = inFilm ? undefined : anchorSection(work, input);
  const inRecord = listedBy ? recordId(listedBy, work, input) : undefined;
  const back = {
    href: inFilm
      ? `${outline.home}#${prefix}${anchorOfScene(inFilm, film)}`
      : inRecord
        ? `${outline.home}#${inRecord}`
        : outline.home,
    title: inFilm
      ? `Back to the film, scene ${inFilm.number}`
      : inRecord
        ? 'Back to the full record'
        : 'Back to the film',
    // The composition's words, marked English in a portfolio in another language.
    lang,
  };

  const still = [work.cover, ...(work.media ?? [])]
    .map((placement) =>
      placement ? { placement, placed: placedMedia(placement, ctx) } : undefined,
    )
    .find((one) => one?.placed && !one.placed.decorative);
  const evidence = evidenceByIds(work.evidence, input);
  const medium = mediumLabel(work);
  const facts: { label: string; id?: string; value: ReactNode }[] = [];
  if (present(study.role) || present(work.role)) {
    facts.push({
      label: 'Role',
      id: anchorOf('role'),
      value: present(study.role) ? <RichText source={study.role} input={input} /> : work.role,
    });
  }
  if (work.period)
    facts.push({ label: 'Period', value: <PeriodText period={work.period} ctx={ctx} /> });
  if (medium || work.tools?.length) {
    facts.push({
      label: 'Medium',
      value: (
        <>
          {medium ? <Words lang={lang}>{medium}</Words> : null}
          {medium && work.tools?.length ? ', ' : null}
          {work.tools?.length ? (
            <>
              <Words lang={lang}>in</Words> {work.tools.join(', ')}
            </>
          ) : null}
        </>
      ),
    });
  }
  // The context's counts, where its words give some: drawn as its own scene, else a fact.
  const counts = countsIn(study.context);
  const drawsContext = present(study.context) && counts.length > 0 && counts[0]!.count <= 120;
  if (present(study.context) && !drawsContext) {
    facts.push({
      label: 'Context',
      id: anchorOf('context'),
      value: <RichText source={study.context} input={input} />,
    });
  }
  if (present(study.constraints)) {
    facts.push({
      label: 'Constraints',
      id: anchorOf('constraints'),
      value: <RichText source={study.constraints} input={input} />,
    });
  }
  // The work's own address leads, named in the composition's words, unless a link already points there.
  const own = work.links ?? [];
  const site =
    present(work.url) && !own.some((link) => link.url === work.url) ? work.url : undefined;
  if (site || own.length > 0) {
    facts.push({
      label: 'Links',
      value: (
        <span className="hc-board__links">
          {site ? (
            <a href={hrefFor(site, input)}>
              <Words lang={lang}>Project site</Words>
            </a>
          ) : null}
          {own.map((link, index) => (
            <LinkText key={index} link={link} ctx={ctx} />
          ))}
        </span>
      ),
    });
  }

  const scenes: BoardScene[] = [];
  if (present(study.challenge)) {
    const id = anchorOf('challenge');
    scenes.push({
      key: 'challenge',
      id,
      label: STOPS.challenge,
      layout: 'slab',
      matte: false,
      body: <Led id={id} label={STOPS.challenge} text={study.challenge} input={input} />,
    });
  }
  if (drawsContext) {
    const id = anchorOf('context');
    scenes.push({
      key: 'context',
      id,
      label: STOPS.context,
      layout: 'split',
      matte: false,
      frame: <CountFigure counts={counts} lang={lang} />,
      body: (
        <Led id={id} label={STOPS.context} text={undefined} input={input} shown>
          <RichText source={study.context!} className="hc-board__body" input={input} />
        </Led>
      ),
    });
  }
  (study.decisions ?? []).forEach((decision, index) => {
    const first = anchorOf('decisions');
    const id = index === 0 ? first : `${first}-${index + 1}`;
    const label = STOPS.decision(index + 1);
    scenes.push({
      key: `decision-${index}`,
      id,
      label,
      layout: 'take',
      matte: true,
      body: (
        <Led id={id} label={label} text={decision.decision} input={input}>
          {present(decision.rationale) || present(decision.alternatives) ? (
            <dl className="hc-board__why">
              {present(decision.rationale) ? (
                <div>
                  <dt data-type-role="label">
                    <Words lang={lang}>Why</Words>
                  </dt>
                  <dd>
                    <RichText source={decision.rationale} input={input} />
                  </dd>
                </div>
              ) : null}
              {present(decision.alternatives) ? (
                <div>
                  <dt data-type-role="label">
                    <Words lang={lang}>Instead of</Words>
                  </dt>
                  <dd>
                    <RichText source={decision.alternatives} input={input} />
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </Led>
      ),
    });
  });
  if (present(study.evidence) || evidence.length > 0) {
    const id = anchorOf('evidence');
    const award = evidence.find((entry) => entry.type === 'award');
    const cited = evidence.filter((entry) => entry !== award);
    const citations =
      cited.length > 0 ? (
        <ul className="hc-board__citations" role="list">
          {cited.map((entry) => (
            <Cited key={entry.id} entry={entry} ctx={ctx} />
          ))}
        </ul>
      ) : null;
    scenes.push({
      key: 'evidence',
      id,
      label: STOPS.evidence,
      layout: award ? 'split' : 'slab',
      matte: false,
      frame: award ? <AwardPlate entry={award} ctx={ctx} /> : undefined,
      body: award ? (
        <Led id={id} label={STOPS.evidence} text={undefined} input={input} shown>
          {present(study.evidence) ? (
            <RichText source={study.evidence} className="hc-board__body" input={input} />
          ) : null}
          {citations}
        </Led>
      ) : (
        <Led id={id} label={STOPS.evidence} text={study.evidence} input={input}>
          {citations}
        </Led>
      ),
    });
  }
  if (present(study.outcomes)) {
    const id = anchorOf('outcomes');
    const change = changeIn(study.outcomes);
    scenes.push({
      key: 'outcomes',
      id,
      label: STOPS.outcomes,
      layout: change ? 'split' : 'slab',
      matte: true,
      frame: change ? <ChangeFigure change={change} lang={lang} /> : undefined,
      body: change ? (
        <Led id={id} label={STOPS.outcomes} text={undefined} input={input} shown>
          <RichText source={study.outcomes} className="hc-board__body" input={input} />
        </Led>
      ) : (
        <Led id={id} label={STOPS.outcomes} text={study.outcomes} input={input} />
      ),
    });
  }
  if (present(study.reflection)) {
    const id = anchorOf('reflection');
    scenes.push({
      key: 'reflection',
      id,
      label: STOPS.reflection,
      layout: 'slab',
      matte: false,
      body: <Led id={id} label={STOPS.reflection} text={study.reflection} input={input} />,
    });
  }

  const slateId = ownId(prefix, 'slate');
  const total = scenes.length + 1;
  const marks: BoardMark[] = [
    { id: slateId, label: 'The slate', matte: false },
    ...scenes.map((scene) => ({
      id: scene.id,
      label: scene.label,
      matte: scene.matte,
    })),
  ];
  // What comes next: the next case study, else the next work in the film, at title size.
  const nextWork = (() => {
    if (outline.next)
      return {
        href: outline.next.href,
        title: outline.next.title,
        lang: outline.next.lang,
        label: 'The next case study',
      };
    const order = film.flatMap((scene) =>
      scene.kind === 'reel' && scene.section.kind === 'works'
        ? scene.items.map((item) => ({ id: item.id, scene }))
        : [],
    );
    const at = order.findIndex((one) => one.id === work.id);
    const after = order.slice(at + 1).find((one) => one.id !== work.id);
    if (!after) return undefined;
    const found = input.portfolio.works.find((one) => one.id === after.id);
    if (!found) return undefined;
    return {
      href: `${outline.home}#${prefix}${anchorOfScene(after.scene, film)}`,
      title: found.title,
      lang: found.lang,
      label: `The next work, in scene ${after.scene.number}`,
    };
  })();
  return (
    <div className="hc hc-board" data-view="case">
      <a className="hc-skip" href={`#${creditsId}`} data-type-role="label">
        <Words lang={lang}>Skip to the credits</Words>
      </a>
      <header className="hc-chrome">
        <a className="hc-chrome__name" href={outline.home}>
          <span className="hc-chrome__title" data-type-role="body">
            {portfolio.identity.name}
          </span>
          <span className="hc-chrome__running" data-type-role="body">
            <Words lang={lang}>{`Case study in ${total} scenes`}</Words>
          </span>
        </a>
        {/* The name leads home; the one way back to the work's own scene is at the end. */}
        {footer.contactHref ? (
          <nav className="hc-chrome__nav" aria-label="Site">
            <a className="hc-chrome__contact" href={footer.contactHref} data-type-role="label">
              <Words lang={lang}>Get in touch</Words>
            </a>
          </nav>
        ) : null}
        <VisitorControlSlot />
      </header>
      <main id={ids.main} className="hc-main hc-board__main" tabIndex={-1}>
        <article className="hc-board__film" aria-labelledby={`${slateId}-title`} lang={work.lang}>
          <section
            id={slateId}
            className="hc-scene hc-board__scene"
            data-kind="slate"
            aria-labelledby={`${slateId}-title`}
          >
            <div className="hc-bar hc-bar--top" aria-hidden="true" data-type-role="label">
              <span className="hc-bar__lead">
                <Words lang={lang}>Case study</Words>
              </span>
              <span className="hc-bar__counter">
                <Words lang={lang}>{`Scene 1 of ${total}`}</Words>
              </span>
            </div>
            <div className="hc-pic hc-board__slate">
              <div className="hc-board__titles">
                {medium || work.period ? (
                  <p className="hc-board__medium" data-type-role="label">
                    {medium}
                    {medium && work.period ? ', ' : null}
                    {work.period ? (
                      <>
                        <Words lang={lang}>{work.period.end ? 'from' : 'since'}</Words>{' '}
                        <DateText raw={work.period.start} ctx={ctx} />
                      </>
                    ) : null}
                  </p>
                ) : null}
                <h1 id={`${slateId}-title`} className="hc-board__title" data-type-role="display">
                  {work.title}
                </h1>
                {present(work.summary) ? (
                  <p className="hc-board__summary" data-type-role="title">
                    {work.summary}
                  </p>
                ) : null}
              </div>
              {still?.placed ? (
                <div className="hc-board__still hc-still">
                  <MediaFigure
                    placed={still.placed}
                    ctx={ctx}
                    eager
                    sizes="(min-width: 64rem) 45vw, 100vw"
                  />
                </div>
              ) : null}
              <FactSheet rows={facts} lang={lang} />
            </div>
            <div className="hc-bar hc-bar--bottom" data-type-role="label">
              <span className="hc-bar__credit">
                <Words lang={lang}>{followText(scenes.map((scene) => scene.label))}</Words>
              </span>
              {scenes[0] ? (
                <a className="hc-bar__next" href={`#${scenes[0].id}`}>
                  <Words lang={lang}>{`Next: ${scenes[0].label}`}</Words>
                </a>
              ) : null}
            </div>
          </section>
          {(() => {
            // The takes read side by side, one row; every other scene in turn.
            const out: ReactNode[] = [];
            let takes: ReactNode[] = [];
            const flush = () => {
              if (takes.length > 0) {
                out.push(
                  <div key={`takes-${out.length}`} className="hc-board__takes">
                    {takes}
                  </div>,
                );
              }
              takes = [];
            };
            scenes.forEach((scene, index) => {
              const bar = (
                <div className="hc-bar hc-bar--top" aria-hidden="true" data-type-role="label">
                  <span className="hc-bar__lead">{scene.label}</span>
                  <span className="hc-bar__counter">
                    <Words lang={lang}>{`Scene ${index + 2} of ${total}`}</Words>
                  </span>
                </div>
              );
              const node =
                scene.layout === 'split' ? (
                  <section
                    key={scene.key}
                    id={scene.id}
                    className="hc-board__scene"
                    data-layout="split"
                    aria-labelledby={`${scene.id}-heading`}
                  >
                    <div
                      className="hc-scene hc-board__frame"
                      data-matte={scene.matte ? '' : undefined}
                    >
                      {bar}
                      <div className="hc-board__picture">{scene.frame}</div>
                    </div>
                    <div className="hc-board__text">{scene.body}</div>
                  </section>
                ) : (
                  <section
                    key={scene.key}
                    id={scene.id}
                    className="hc-scene hc-board__scene"
                    data-layout={scene.layout}
                    data-matte={scene.matte ? '' : undefined}
                    aria-labelledby={`${scene.id}-heading`}
                  >
                    {bar}
                    <div className="hc-pic hc-board__pic">{scene.body}</div>
                  </section>
                );
              if (scene.layout === 'take') takes.push(node);
              else {
                flush();
                out.push(node);
              }
            });
            flush();
            return out;
          })()}
        </article>
        <nav className="hc-board__end" aria-label="After this case study">
          {nextWork ? (
            <p className="hc-board__next">
              <span data-type-role="label">
                <Words lang={lang}>{nextWork.label}</Words>
              </span>
              <a href={nextWork.href} lang={nextWork.lang} data-type-role="headline">
                {nextWork.title}
              </a>
            </p>
          ) : null}
          <p className="hc-board__back" data-type-role="title">
            <a href={back.href} lang={back.lang}>
              {back.title}
            </a>
          </p>
        </nav>
        <BoardMap marks={marks} lang={lang} label={`The case study's ${total} scenes`} />
      </main>
      <Credits id={creditsId} footer={footer} locale={portfolio.locale} />
    </div>
  );
}
