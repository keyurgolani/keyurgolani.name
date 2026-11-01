import type { ReactNode } from 'react';
import type { Evidence, Placement, Work } from '@portfolio/schema';
import {
  DateText,
  evidenceByIds,
  formatFigure,
  formatNames,
  hrefFor,
  isRoutedWork,
  MediaFigure,
  placedImage,
  present,
  renderContext,
  RichText,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Chrome } from './chrome';
import { NavLandmark } from './client/nav-landmark';
import { atelierComposition, Colophon } from './home';
import { atelierModel, imagesOf, mediumLabel, type AtelierModel, type Room } from './model';
import { addressOf, homeHref, ownId, periodWords, Words, yearOf } from './parts';

// A work's own page, /work/<slug> (redesign, stream C): the case, hung as
// a room of its own, in Atelier's anatomy rather than the kit's parts:
//
//   the title block   where the work hangs ("Room I, catalogue No. 1"),
//                     its title at the display size, its premise at body
//                     size, and beside it the fact sheet, a ruled dl
//   the installation  the work on its own wall with its wall label pinned
//                     to its foot, Plate 1, and the floor band under it
//   the case bar      the case's own index, sticky while it's read: its
//                     stops named by plate, never by the case's fields
//   the case          the analytical column, unheaded but for a run-in,
//                     paired row by row with the plates under the one
//                     caption system: a clipping set straight on its
//                     plate, a figure framed in its mat, a citation matted
//   the reflection    the closing wall inscription, its floor band naming
//                     it and the way on
//   the back matter   the sources, then the next room at the title size
//
// The plates come from what the work holds, in a fixed order: the cover
// as the installation view, then each cited clipping (press, testimony),
// figure (a metric), and citation (an award), then the work's other
// pictures. Nothing is made up: a work that cites no figure hangs none.

type ViewWork = CaseStudyPageProps['work'];

/** What a plate hangs. */
type Hung =
  | { readonly kind: 'clipping' | 'figure' | 'citation'; readonly entry: Evidence }
  | { readonly kind: 'study'; readonly image: Placement };

interface Plate {
  /** Its number: the installation view is 1, so the first plate here is 2. */
  readonly number: number;
  readonly hung: Hung;
  /** Its name in the case bar and the running head: "Plate 2, the clipping". */
  readonly name: string;
}

/** A case part's row: its words, run in, beside a plate or its own margin. */
interface Row {
  readonly key: 'challenge' | 'decisions' | 'evidence' | 'outcomes';
  readonly plate?: Plate;
}

const KIND_WORDS: Readonly<Record<Hung['kind'], readonly [string, string]>> = {
  clipping: ['the clipping', 'a clipping'],
  figure: ['the figure', 'a figure'],
  citation: ['the citation', 'a citation'],
  study: ['a study', 'a study'],
};

/** The plates the case hangs past the installation view, numbered from 2. */
export function platesOf(work: ViewWork, input: VariantRenderInput): readonly Plate[] {
  const cited = evidenceByIds(work.evidence, input);
  const words = (entry: Evidence) => entry.excerpt ?? entry.statement;
  const hung: Hung[] = [
    ...cited
      .filter(
        (entry) =>
          (entry.type === 'press' || entry.type === 'testimonial') && present(words(entry)),
      )
      .map((entry) => ({ kind: 'clipping' as const, entry })),
    ...cited
      .filter((entry) => entry.type === 'metric' && entry.metric?.value !== undefined)
      .map((entry) => ({ kind: 'figure' as const, entry })),
    ...cited
      .filter((entry) => entry.type === 'award')
      .map((entry) => ({ kind: 'citation' as const, entry })),
    ...imagesOf(work, input)
      .slice(1)
      .map((image) => ({ kind: 'study' as const, image })),
  ];
  const seen = new Set<Hung['kind']>();
  return hung.map((each, index) => {
    const [first, more] = KIND_WORDS[each.kind];
    const name = seen.has(each.kind) ? more : first;
    seen.add(each.kind);
    return { number: index + 2, hung: each, name: `Plate ${index + 2}, ${name}` };
  });
}

/** Where the work hangs in the catalogue, and the one after it. */
interface Place {
  readonly number: number;
  /** "Room I", or "The collection". */
  readonly where: string;
  readonly room?: Room;
  /** The work's element on home. */
  readonly anchor: string;
}

function catalogue(model: AtelierModel, input: VariantRenderInput) {
  const entries: (Place & { work: Work })[] = [
    ...model.rooms.map((room) => ({
      work: room.work,
      number: room.number,
      where: `Room ${room.numeral}`,
      room,
      anchor: room.anchor,
    })),
    ...model.collection.flatMap((section) =>
      (model.bays.get(section.id)?.hung ?? []).map((hung) => ({
        work: hung.work,
        number: hung.number,
        where: 'The collection',
        anchor: `${input.ids.prefix}${hung.work.id}`,
      })),
    ),
  ];
  return entries.sort((a, b) => a.number - b.number);
}

/** The run-in that starts a part, in the catalogue's words, never the case's field names. */
function runIn(key: Row['key'], decisions: number): string {
  switch (key) {
    case 'challenge':
      return 'The challenge.';
    case 'decisions':
      return decisions === 1
        ? 'The decision.'
        : decisions === 2
          ? 'Two decisions.'
          : decisions === 3
            ? 'Three decisions.'
            : `${decisions} decisions.`;
    case 'evidence':
      return 'The evidence.';
    case 'outcomes':
      return 'What changed.';
  }
}

/** The plate beside each part, in order; a plate left over hangs on its own below. */
function rowsOf(
  work: ViewWork,
  plates: readonly Plate[],
  cited: number,
): { rows: Row[]; rest: Plate[] } {
  const study = work.caseStudy;
  const has = (key: Row['key']) =>
    key === 'decisions'
      ? (study.decisions?.length ?? 0) > 0
      : key === 'evidence'
        ? present(study.evidence) || cited > 0
        : present(study[key]);
  const keys = (['challenge', 'decisions', 'evidence', 'outcomes'] as const).filter(has);
  const queue = [...plates];
  // Each part takes the next plate. The challenge's context, role, and constraints are words, so
  // they read in the column with it (OBS-3), and the wall beside the words holds only plates.
  const rows = keys.map((key): Row => {
    const plate = queue.shift();
    return plate ? { key, plate } : { key };
  });
  return { rows, rest: queue };
}

/**
 * What stands beside a row of the case: its plate, the highlights beside
 * What changed when no plate hangs there, or nothing. The challenge's notes
 * are its words, so they read on in the column (OBS-3); the highlights are
 * the one list of words the wall takes, a short ruled list in a plate's
 * place, since they're the case's facts in brief, not its argument.
 */
type Aside = 'plate' | 'highlights' | undefined;

function asideOf(row: Row, work: ViewWork): Aside {
  if (row.plate) return 'plate';
  if (row.key === 'outcomes' && (work.highlights ?? []).some(present)) return 'highlights';
  return undefined;
}

/** Parts that hang together beside one aside: the one row of the page that holds them. */
interface Group {
  readonly rows: readonly Row[];
  /** The row whose aside the group shows beside its words. */
  readonly holder?: Row;
}

/**
 * The rows of the page. Once any part holds a plate, each part is its own
 * row: the words run on in one column and the plates hang on the wall
 * beside them from where their own words start (OBS-3), so a part with no
 * plate leaves no track empty, and on a phone each plate follows its own
 * words. A case with no plate at all is one row of words, set across.
 */
export function groupsOf(rows: readonly Row[], work: ViewWork): Group[] {
  const beside = (row: Row) => asideOf(row, work) !== undefined;
  if (!rows.some(beside)) return rows.length > 0 ? [{ rows }] : [];
  return rows.map((row) => (beside(row) ? { rows: [row], holder: row } : { rows: [row] }));
}

/** A row's id, which the case bar's stop goes to. */
const rowId = (input: VariantRenderInput, work: ViewWork, key: string) =>
  ownId(input, `case-${work.id}-${key}`);

/** One caption system, as the collection wall's: the title, the number at the line's end, the credit under them. */
function Caption({
  title,
  number,
  credit,
  id,
}: {
  title: ReactNode;
  number: string;
  credit: ReactNode[];
  id: string;
}) {
  const shown = credit.filter((part) => part !== undefined && part !== null && part !== '');
  return (
    <figcaption id={id} className="oa-caption" data-type-role="label">
      <span className="oa-caption__title">{title}</span>
      <span className="oa-caption__no">{number}</span>
      {shown.length > 0 ? (
        <span className="oa-caption__credit">
          {shown.map((part, index) => (
            <span key={index}>
              {index > 0 ? ', ' : null}
              {part}
            </span>
          ))}
        </span>
      ) : null}
    </figcaption>
  );
}

/** A plate, hung as what it is: a clipping straight on its plate, a figure framed, a citation matted, a study mounted. */
function PlateView({ plate, ctx, work }: { plate: Plate; ctx: RenderContext; work: ViewWork }) {
  const { input } = ctx;
  const { hung } = plate;
  const id = ownId(input, `plate-${work.id}-${plate.number}`);
  const no = <Words input={input}>{`Plate ${plate.number}`}</Words>;
  if (hung.kind === 'study') {
    const placed = placedImage(hung.image, input);
    if (!placed) return null;
    return (
      <figure className="oa-caseplate oa-caseplate--study" aria-labelledby={id}>
        <div className="oa-mount">
          <MediaFigure
            placed={placed}
            ctx={ctx}
            className="oa-mount__image"
            sizes="(min-width: 64rem) 40vw, 100vw"
          />
        </div>
        <Caption
          id={id}
          title={<span lang={work.lang}>{work.title}</span>}
          number={`Plate ${plate.number}`}
          credit={[]}
        />
      </figure>
    );
  }
  const { entry } = hung;
  const link = (children: ReactNode) =>
    present(entry.url) ? <a href={hrefFor(entry.url, input)}>{children}</a> : children;
  if (hung.kind === 'clipping') {
    const words = entry.excerpt ?? entry.statement ?? '';
    const who = entry.author ?? entry.source?.name;
    const where = entry.publication ?? entry.venue ?? entry.source?.organization;
    return (
      <figure
        className="oa-caseplate oa-caseplate--clipping"
        aria-labelledby={id}
        lang={entry.lang}
      >
        <div className="oa-caseplate__mat">
          <blockquote
            className="oa-caseplate__quote"
            cite={present(entry.url) ? hrefFor(entry.url, input) : undefined}
          >
            <RichText source={words} input={input} />
          </blockquote>
        </div>
        <Caption
          id={id}
          title={present(entry.title) ? link(entry.title) : (who ?? no)}
          number={`Plate ${plate.number}`}
          credit={[
            present(entry.title) ? who : undefined,
            where,
            entry.publishedAt !== undefined ? (
              <DateText key="date" raw={entry.publishedAt} ctx={ctx} />
            ) : undefined,
          ]}
        />
      </figure>
    );
  }
  if (hung.kind === 'figure') {
    const metric = entry.metric!;
    return (
      <figure className="oa-caseplate oa-caseplate--figure" aria-labelledby={id} lang={entry.lang}>
        <div className="oa-caseplate__frame">
          <div className="oa-caseplate__mat">
            <p className="oa-caseplate__figure">
              <data value={metric.value}>{formatFigure(metric.value!, ctx)}</data>
              {present(metric.unit) ? (
                <span className="oa-caseplate__unit">{` ${metric.unit}`}</span>
              ) : null}
            </p>
          </div>
        </div>
        <Caption
          id={id}
          title={
            present(entry.statement) ? (
              <RichText source={entry.statement} inline input={input} />
            ) : (
              (entry.title ?? no)
            )
          }
          number={`Plate ${plate.number}`}
          credit={[
            present(entry.description) ? (
              <RichText key="more" source={entry.description} inline input={input} />
            ) : undefined,
            entry.asOf !== undefined ? (
              <DateText key="as-of" raw={entry.asOf} ctx={ctx} />
            ) : undefined,
          ]}
        />
      </figure>
    );
  }
  const year = entry.receivedAt ?? entry.asOf;
  return (
    <figure className="oa-caseplate oa-caseplate--citation" aria-labelledby={id} lang={entry.lang}>
      <div className="oa-caseplate__mat">
        <p className="oa-caseplate__award">{link(entry.title ?? entry.statement ?? '')}</p>
        {present(entry.description) ? (
          <RichText source={entry.description} className="oa-caseplate__words" input={input} />
        ) : null}
      </div>
      <Caption
        id={id}
        title={<Words input={input}>The citation</Words>}
        number={`Plate ${plate.number}`}
        credit={[
          entry.organization,
          year !== undefined ? <DateText key="year" raw={year} ctx={ctx} /> : undefined,
        ]}
      />
    </figure>
  );
}

/**
 * The installation's wall label (C4): the facts in museum-label prose at
 * caption size, never a ruled fact sheet, which is Editorial's form. The
 * plate's number, the title and when, what it is and the owner's part in
 * it, what it's made with, its recognition, and its links:
 * "Postmortem Template Kit, since 2022. Software. Author and maintainer.
 * Made with TypeScript, Bun, and Markdown. SREcon Practitioner Award,
 * USENIX, 2025."
 */
function CaseLabel({
  work,
  ctx,
  id,
  no,
  as = 'figcaption',
}: {
  work: ViewWork;
  ctx: RenderContext;
  id: string;
  no?: string;
  as?: 'figcaption' | 'div';
}) {
  const { input } = ctx;
  const awards = evidenceByIds(work.evidence, input).filter((entry) => entry.type === 'award');
  const links = [
    ...(present(work.url) ? [{ href: hrefFor(work.url, input), text: addressOf(work.url) }] : []),
    ...(work.links ?? []).map((each) => ({
      href: hrefFor(each.url, input),
      text: [each.label, each.platform].find(present) ?? addressOf(each.url),
    })),
  ];
  const when = periodWords(work.period);
  const medium = mediumLabel(work);
  const part = [work.role, present(work.organization) ? `with ${work.organization}` : undefined]
    .filter(present)
    .join(', ');
  const sentence = (text: string | undefined) =>
    present(text) ? (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`) : undefined;
  const lines = [
    medium ? <Words input={input}>{sentence(medium)!}</Words> : undefined,
    sentence(part),
    work.tools?.length ? (
      <Words input={input}>{`Made with ${formatNames(work.tools, ctx)}.`}</Words>
    ) : undefined,
    ...awards.map((award) =>
      sentence(
        [award.title, award.organization, yearOf(award.receivedAt)].filter(present).join(', '),
      ),
    ),
  ].filter((line) => line !== undefined);
  const Tag = as;
  return (
    <Tag className="oa-label" id={id} data-type-role="label" lang={work.lang}>
      {no ? (
        <span className="oa-label__no">
          <Words input={input}>{no}</Words>
        </span>
      ) : null}
      <span>
        <span className="oa-label__title">{work.title}</span>
        {when ? <Words input={input}>{`, ${when}.`}</Words> : '.'}
      </span>
      {lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
      {links.length > 0 ? (
        <ul className="oa-links" role="list">
          {links.map((each, index) => (
            <li key={index}>
              <a href={each.href}>{each.text}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </Tag>
  );
}

/** A part's words, the run-in floated into its first line. */
function RunOn({
  id,
  lead,
  source,
  input,
}: {
  id: string;
  lead: string;
  source: string;
  input: VariantRenderInput;
}) {
  return (
    <div className="oa-runon">
      <h2 id={id} className="oa-runin">
        <Words input={input}>{lead}</Words>
      </h2>
      <RichText source={source} className="oa-casetext" input={input} />
    </div>
  );
}

function RowText({
  row,
  work,
  ctx,
  headId,
}: {
  row: Row;
  work: ViewWork;
  ctx: RenderContext;
  headId: string;
}) {
  const { input } = ctx;
  const study = work.caseStudy;
  if (row.key === 'decisions') {
    const decisions = study.decisions ?? [];
    return (
      <div className="oa-runon">
        <h2 id={headId} className="oa-runin oa-runin--alone">
          <Words input={input}>{runIn('decisions', decisions.length)}</Words>
        </h2>
        <ol className="oa-casedecisions" role="list">
          {decisions.map((decision, index) => (
            <li key={index}>
              <span className="oa-casedecisions__no" aria-hidden="true">
                {index + 1}
              </span>
              <RichText
                source={decision.decision}
                className="oa-casedecisions__what"
                input={input}
              />
              {present(decision.rationale) ? (
                <RichText source={decision.rationale} className="oa-casetext" input={input} />
              ) : null}
              {present(decision.alternatives) ? (
                <p className="oa-casedecisions__instead oa-quiet" data-type-role="label">
                  <Words input={input}>Considered instead:</Words>{' '}
                  <RichText source={decision.alternatives} inline input={input} />
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const source = study[row.key];
  const lead = runIn(row.key, 0);
  return (
    <>
      {present(source) ? (
        <RunOn id={headId} lead={lead} source={source} input={input} />
      ) : (
        <h2 id={headId} className="oa-runin oa-runin--alone">
          <Words input={input}>{lead}</Words>
        </h2>
      )}
      {/* The challenge's notes read on under its words; What changed, in short, does when a plate hangs beside it, else it hangs in the plate's place. */}
      {row.key === 'challenge' ? <Notes work={work} ctx={ctx} /> : null}
      {row.key === 'outcomes' && row.plate ? <Highlights work={work} /> : null}
    </>
  );
}

/** The work's highlights, a short ruled list. */
function Highlights({ work }: { work: ViewWork }) {
  const highlights = (work.highlights ?? []).filter(present);
  if (highlights.length === 0) return null;
  return (
    <ul className="oa-highlights" role="list" lang={work.lang}>
      {highlights.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** The challenge's notes, under its words: its context, the owner's part, and the constraints, each run in. */
function Notes({ work, ctx }: { work: ViewWork; ctx: RenderContext }) {
  const { input } = ctx;
  const study = work.caseStudy;
  const notes = (
    [
      ['Context', study.context],
      ['My part', study.role],
      ['Constraints', study.constraints],
    ] as const
  ).filter(([, text]) => present(text));
  if (notes.length === 0) return null;
  return (
    <dl className="oa-casenotes" lang={work.lang}>
      {notes.map(([term, text]) => (
        <div key={term}>
          <dt>
            <Words input={input}>{term}</Words>
          </dt>
          <dd>
            <RichText source={text!} className="oa-casetext" input={input} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The sources: the work's own addresses and every cited record that has one. */
function sourcesOf(work: ViewWork, input: VariantRenderInput) {
  const seen = new Set<string>();
  const list: { href: string; text: string }[] = [];
  const add = (url: string | undefined, text: string | undefined) => {
    if (!present(url)) return;
    const href = hrefFor(url, input);
    if (seen.has(href)) return;
    seen.add(href);
    list.push({ href, text: present(text) ? text : addressOf(url) });
  };
  add(work.url, undefined);
  for (const link of work.links ?? []) add(link.url, undefined);
  for (const entry of evidenceByIds(work.evidence, input)) {
    const where = entry.publication ?? entry.venue ?? entry.organization;
    add(entry.url, [entry.title, where].filter(present).join(', '));
  }
  return list;
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const { ids } = input;
  const model = atelierModel(input);
  const composition = atelierComposition(model, input);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 2);
  const entries = catalogue(model, input);
  const at = entries.findIndex((entry) => entry.work.id === work.id);
  const place = at >= 0 ? entries[at] : undefined;
  const after = at >= 0 ? entries[at + 1] : undefined;
  const plates = platesOf(work, input);
  const cited = evidenceByIds(work.evidence, input).length;
  const { rows, rest } = rowsOf(work, plates, cited);
  const groups = groupsOf(rows, work);
  // No plate anywhere: the case's words take the whole row, set across.
  const bare = groups.every((group) => group.holder === undefined);
  const cover = imagesOf(work, input)[0];
  const total = plates.length + (cover ? 1 : 0);
  const study = work.caseStudy;
  // Where the page starts, short enough for a phone's corner: the room the work hangs in.
  const here = place ? place.where : 'The case';
  const coverPlaced = cover ? placedImage(cover, input) : undefined;
  const labelId = ownId(input, `label-${work.id}`);
  const installationId = ownId(input, `case-${work.id}-installation`);
  const reflectionId = ownId(input, `case-${work.id}-reflection`);
  const barId = ownId(input, 'casebar');
  // The stops: the installation view, each plate's row, the plates on their own, and the reflection wall.
  const stops = [
    ...(coverPlaced ? [{ href: `#${installationId}`, name: 'Installation view' }] : []),
    ...groups.flatMap(({ rows: parts, holder }) =>
      holder?.plate
        ? [{ href: `#${rowId(input, work, parts[0]!.key)}`, name: holder.plate.name }]
        : [],
    ),
    ...rest.map((plate) => ({
      href: `#${ownId(input, `plate-${work.id}-${plate.number}`)}-hang`,
      name: plate.name,
    })),
    ...(present(study.reflection) ? [{ href: `#${reflectionId}`, name: 'Reflection wall' }] : []),
  ];
  const nextHref = after
    ? isRoutedWork(after.work)
      ? routeHref(input, { route: 'work', slug: after.work.slug })
      : homeHref(input, after.anchor)
    : undefined;
  const nextImage = after ? imagesOf(after.work, input)[0] : undefined;
  const nextPlaced = nextImage ? placedImage(nextImage, input) : undefined;
  const sources = sourcesOf(work, input);
  const nextName = after ? `Next, ${after.where}, No. ${after.number}` : undefined;
  return (
    <>
      <Chrome input={input} model={model} here={here} />
      <main
        id={ids.main}
        className="oa-main oa-casepage"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <article aria-labelledby={ownId(input, 'case-title')}>
          {/* The installation view leads: the work on its wall, its label at its foot, the room's title on the floor. */}
          <section
            id={installationId}
            className="oa-installation oa-wall"
            aria-labelledby={ownId(input, 'case-title')}
            data-oa-place={here}
          >
            {coverPlaced ? (
              <figure className="oa-hang" aria-labelledby={labelId}>
                <div className="oa-hang__work oa-mount">
                  <MediaFigure
                    placed={coverPlaced}
                    ctx={ctx}
                    className="oa-mount__image"
                    eager
                    sizes="(min-width: 64rem) 55vw, 100vw"
                  />
                </div>
                <CaseLabel work={work} ctx={ctx} id={labelId} no={`Plate 1 of ${total}`} />
              </figure>
            ) : (
              <div className="oa-hang">
                <CaseLabel work={work} ctx={ctx} id={labelId} as="div" />
              </div>
            )}
            <div className="oa-installation__title">
              {place ? (
                <p className="oa-no" data-type-role="label">
                  <a href={homeHref(input, place.anchor)}>
                    <Words input={input}>{place.where}</Words>
                  </a>
                  <Words input={input}>{`, catalogue No. ${place.number} of ${model.total}`}</Words>
                </p>
              ) : null}
              <h1
                id={ownId(input, 'case-title')}
                className="oa-entrance__title"
                data-type-role="display"
              >
                {work.title}
              </h1>
              {present(work.summary) ? (
                <RichText source={work.summary} className="oa-installation__lede" input={input} />
              ) : null}
            </div>
            <p className="oa-floor__on" data-type-role="label">
              <span>
                <Words input={input}>
                  {place ? `Installation view, ${place.where}` : 'Installation view'}
                </Words>
              </span>
            </p>
          </section>
          {stops.length > 1 ? (
            <NavLandmark labelledBy={barId} className="oa-casebar">
              <p id={barId} className="oa-casebar__name" data-type-role="label">
                <Words input={input}>The case</Words>
              </p>
              <ol className="oa-casebar__stops" role="list" data-oa-stops="">
                {stops.map((stop) => (
                  <li key={stop.href}>
                    <a href={stop.href}>
                      <Words input={input}>{stop.name}</Words>
                    </a>
                  </li>
                ))}
              </ol>
              <p className="oa-casebar__count" data-type-role="label">
                <Words input={input}>{total === 1 ? '1 plate' : `${total} plates`}</Words>
              </p>
            </NavLandmark>
          ) : null}
          <div className="oa-case">
            {groups.map((group) => {
              const first = group.rows[0]!;
              const headId = ownId(input, `case-${work.id}-${first.key}-head`);
              const holder = group.holder;
              const aside = holder ? asideOf(holder, work) : undefined;
              return (
                <section
                  key={first.key}
                  id={rowId(input, work, first.key)}
                  className="oa-case__row"
                  aria-labelledby={headId}
                  data-oa-place={holder?.plate?.name ?? undefined}
                  data-oa-row={group.rows.map((row) => row.key).join(' ')}
                  data-bare={bare ? '' : undefined}
                >
                  {/*
                   * The plate comes first, so on a wide window it hangs on the wall from where
                   * its words start while the words run on in the column, never waiting out its
                   * height (OBS-3). A phone sets the words first.
                   */}
                  {aside === 'plate' ? (
                    // The plate is a place too: its row may be shorter than it, and the head names either the same.
                    <div className="oa-case__plate" data-oa-place={holder!.plate!.name}>
                      <PlateView plate={holder!.plate!} ctx={ctx} work={work} />
                    </div>
                  ) : aside === 'highlights' ? (
                    <div className="oa-case__plate">
                      <Highlights work={work} />
                    </div>
                  ) : null}
                  <div className="oa-case__text">
                    {group.rows.map((row) => (
                      <div key={row.key} className="oa-case__part">
                        <RowText
                          row={row}
                          work={work}
                          ctx={ctx}
                          headId={ownId(input, `case-${work.id}-${row.key}-head`)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {rest.length > 0 ? (
              <div className="oa-case__hangs">
                {rest.map((plate) => (
                  <div
                    key={plate.number}
                    id={`${ownId(input, `plate-${work.id}-${plate.number}`)}-hang`}
                    data-oa-place={plate.name}
                  >
                    <PlateView plate={plate} ctx={ctx} work={work} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {present(study.reflection) ? (
            <section
              id={reflectionId}
              className="oa-reflection oa-wall"
              aria-labelledby={`${reflectionId}-head`}
              data-oa-place="Reflection wall"
            >
              <h2 id={`${reflectionId}-head`} className="oa-visually-hidden">
                <Words input={input}>Reflection</Words>
              </h2>
              <div className="oa-reflection__text" lang={work.lang}>
                <RichText source={study.reflection} input={input} />
              </div>
              {/* One way on per room (C7): the next room is the back matter's, after the sources. */}
              <p className="oa-wallfloor" data-type-role="label">
                <span>
                  <Words input={input}>{place ? `Reflection, ${place.where}` : 'Reflection'}</Words>
                </span>
              </p>
            </section>
          ) : null}
          <footer className="oa-backmatter">
            {sources.length > 0 ? (
              <section
                className="oa-backmatter__sources"
                aria-labelledby={ownId(input, 'case-sources')}
              >
                <h2 id={ownId(input, 'case-sources')} className="oa-h3">
                  <Words input={input}>Sources and links</Words>
                </h2>
                <ul className="oa-ruled" role="list">
                  {sources.map((source) => (
                    <li key={source.href}>
                      <a href={source.href}>{source.text}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <NavLandmark label="The next room" className="oa-nextroom">
              {after && nextHref && nextName ? (
                <a className="oa-nextroom__link" href={nextHref}>
                  {nextPlaced ? (
                    <span className="oa-nextroom__thumb oa-mount">
                      <MediaFigure
                        placed={{ ...nextPlaced, decorative: true }}
                        ctx={ctx}
                        inline
                        sizes="(min-width: 64rem) 16rem, 40vw"
                      />
                    </span>
                  ) : null}
                  <span className="oa-nextroom__text">
                    <span className="oa-quiet" data-type-role="label">
                      <Words input={input}>{nextName}</Words>
                    </span>
                    <span className="oa-nextroom__title" lang={after.work.lang}>
                      {after.work.title}
                    </span>
                    {present(after.work.summary) ? (
                      <RichText
                        source={after.work.summary}
                        inline
                        className="oa-quiet"
                        input={input}
                      />
                    ) : null}
                  </span>
                </a>
              ) : null}
              <ul className="oa-links" role="list" data-type-role="label">
                {place ? (
                  <li>
                    <a href={homeHref(input, place.anchor)}>
                      <Words input={input}>{`Back to ${place.where}`}</Words>
                    </a>
                  </li>
                ) : (
                  <li>
                    <a href={outline.home}>
                      <Words input={input}>Back to the entrance</Words>
                    </a>
                  </li>
                )}
                {model.collection.length > 0 ? (
                  <li>
                    <a href={homeHref(input, ownId(input, 'collection'))}>
                      <Words input={input}>The whole collection</Words>
                    </a>
                  </li>
                ) : null}
              </ul>
            </NavLandmark>
          </footer>
        </article>
      </main>
      <Colophon input={input} model={model} composition={composition} />
    </>
  );
}
