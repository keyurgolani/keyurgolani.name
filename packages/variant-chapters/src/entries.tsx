import type { ReactNode } from 'react';
import type { Evidence, Work } from '@portfolio/schema';
import { formatFigure, frameAttributes, present, renderContext } from '@portfolio/kit/sections';
import type { BookRecord, Group } from './model/book';
import { listed } from './model/book';
import { idOf, joined, Md, Out, plain, Prose, When, type Input } from './text';

/** A work's or a record's own links, by the labels the owner gave them. */
const ownLinks = (
  links: readonly { url: string; label?: string; platform?: string }[] | undefined,
) => (links ?? []).map((link) => [link.url, link.label ?? link.platform ?? 'Link'] as const);

// One entry renderer for each kind of record a group page holds: an essay,
// an episode, any other work, a testimonial with hanging quotation marks, a
// metric as a figure inside its sentence, a talk, a paper, an award, a
// patent, press, and anything else by its title and words.

type Level = 2 | 3 | 4;
const H = ({
  level,
  children,
  className,
  id,
}: {
  level: Level;
  children: ReactNode;
  className: string;
  id?: string;
}) => {
  const Tag = `h${level}` as const;
  return (
    <Tag className={className} id={id} data-type-role="title">
      {children}
    </Tag>
  );
};

const cap = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const lower = (text: string) => (text ? text[0]!.toLowerCase() + text.slice(1) : text);

function Meta({ parts, separator }: { parts: readonly ReactNode[]; separator?: string }) {
  const line = joined(parts, separator);
  return line.length === 0 ? null : (
    <p className="it__meta" data-type-role="body-compact">
      {line}
    </p>
  );
}

const minutes = (n: number) => `${n} min`;

/** Whether a field repeats its group's own name: "Incident History" in Incident History, "essay" in Essays. */
const repeats = (field: string | undefined, group: string | undefined) => {
  const base = (text: string) => text.trim().toLowerCase().replace(/s$/, '');
  return field !== undefined && group !== undefined && base(field) === base(group);
};

function WorkEntry({
  work,
  input,
  level,
  group,
}: {
  work: Work;
  input: Input;
  level: Level;
  group?: string;
}) {
  const url = work.url ?? work.links?.[0]?.url ?? work.audioUrl ?? work.videoUrl;
  const title = (
    <H level={level} className="it__t">
      <Out url={url} input={input}>
        {work.title}
      </Out>
    </H>
  );
  if (work.medium === 'writing' || work.medium === 'research') {
    return (
      <li className="it it--essay" id={idOf(input, work.id)}>
        {title}
        <Meta
          parts={[
            work.publication,
            work.role,
            work.publishedAt ? <When key="d" raw={work.publishedAt} input={input} /> : null,
            work.readingTimeMinutes ? (
              <span key="r" className="ch-nobreak">
                {work.readingTimeMinutes}-minute read
              </span>
            ) : null,
          ]}
        />
        {present(work.excerpt) ? (
          <Md source={work.excerpt} input={input} className="it__quote" role="body" />
        ) : null}
        <Prose source={work.summary} input={input} className="it__text" role="body-compact" />
        {work.description !== work.summary ? (
          <Prose source={work.description} input={input} className="it__text" role="body-compact" />
        ) : null}
        <MadeWith work={work} />
        <Tags work={work} group={group} />
        <Links input={input} links={ownLinks(work.links)} />
      </li>
    );
  }
  if (work.medium === 'audio-video') {
    return (
      <li className="it it--episode" id={idOf(input, work.id)}>
        <p className="it__num" data-type-role="numeric">
          {work.number ? `No. ${work.number}` : ''}
        </p>
        <div>
          {title}
          <Meta
            parts={[
              work.publishedAt ? <When key="d" raw={work.publishedAt} input={input} /> : null,
              work.durationMinutes ? (
                <span key="m" className="ch-nobreak">
                  {minutes(work.durationMinutes)}
                </span>
              ) : null,
              work.guests?.length ? `with ${listed(work.guests)}` : null,
              repeats(work.series, group) ? null : work.series,
            ]}
          />
          <Prose
            source={work.description ?? work.summary}
            input={input}
            className="it__text"
            role="body-compact"
          />
          <Prose source={work.showNotes} input={input} className="it__text" role="body-compact" />
          <Tags work={work} group={group} />
          <Links input={input} links={ownLinks(work.links)} />
        </div>
      </li>
    );
  }
  return (
    <li className="it it--work" id={idOf(input, work.id)}>
      {title}
      <Meta parts={[work.artist, work.role, work.organization]} />
      <Prose
        source={work.summary ?? work.description}
        input={input}
        className="it__text"
        role="body-compact"
      />
      <MadeWith work={work} />
      <Tags work={work} group={group} />
      <Links input={input} links={ownLinks(work.links)} />
    </li>
  );
}

/** A work's tools, as the plates' fact sheets name them: "Made with a and b". Never a role. */
function MadeWith({ work }: { work: Work }) {
  return work.tools?.length ? (
    <p className="it__meta" data-type-role="body-compact">
      Made with {listed(work.tools)}.
    </p>
  ) : null;
}

/**
 * A metric as a figure inside its own sentence: "47 essays published". The number alone hangs
 * (P1-10): a unit the statement doesn't open opens the words instead, bound to them, so a metric
 * of 1,200 "ships" stated "Built" reads "1,200 | ships, built", never outgrowing its column.
 */
export function metricParts(evidence: Evidence, input: Input) {
  const ctx = renderContext(input, { id: evidence.id }, 2);
  const value = evidence.metric?.value;
  let unit = evidence.metric?.unit ?? '';
  const statement = plain(evidence.statement ?? evidence.title).replace(/\.$/, '');
  const first = statement.split(/\s+/)[0]?.toLowerCase() ?? '';
  const u = unit.toLowerCase();
  if (u && (first === u || first === `${u}s` || `${first}s` === u)) unit = '';
  const figure = value === undefined ? '' : formatFigure(value, ctx);
  const words = [
    lower(statement),
    evidence.description ? lower(plain(evidence.description).replace(/\.$/, '')) : '',
    evidence.source?.name ? `per ${evidence.source.name}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const opens = figure && unit ? unit.replace(/ /g, '\u00a0') : '';
  const rest = opens && words ? `${opens},\u00a0${words}` : opens || words;
  return { figure, rest };
}

function EvidenceEntry({
  evidence: e,
  input,
  level,
}: {
  evidence: Evidence;
  input: Input;
  level: Level;
}) {
  const id = idOf(input, e.id);
  const title = (text: string | undefined, url?: string) =>
    present(text) ? (
      <H level={level} className="it__t">
        <Out url={url} input={input}>
          {text}
        </Out>
      </H>
    ) : null;
  switch (e.type) {
    case 'testimonial':
      return (
        <li className="it it--praise" id={id}>
          <figure>
            <blockquote className="it__praise" data-type-role="quote">
              <Md source={e.statement} input={input} />
            </blockquote>
            <figcaption data-type-role="body-compact">
              <span className="it__who">{e.source?.name}</span>
              {e.source?.role || e.source?.organization
                ? `, ${[e.source?.role, e.source?.organization].filter(Boolean).join(', ')}`
                : null}
            </figcaption>
          </figure>
        </li>
      );
    case 'metric': {
      const { figure, rest } = metricParts(e, input);
      return (
        <li className="it it--figure" id={id}>
          <p>
            <span className="it__fig" data-type-role="display">
              {figure}
            </span>{' '}
            <span className="it__figtext" data-type-role="body">
              {rest}.
            </span>
          </p>
        </li>
      );
    }
    case 'talk':
      return (
        <li className="it it--talk" id={id}>
          {title(e.title, e.url)}
          <Meta
            parts={[
              e.format ? cap(e.format) : null,
              e.venue,
              e.location,
              e.presentedAt ? <When key="d" raw={e.presentedAt} input={input} /> : null,
            ]}
          />
          <Prose source={e.description} input={input} className="it__text" role="body-compact" />
          <Prose source={e.abstract} input={input} className="it__text" role="body-compact" />
          <Links
            input={input}
            links={[[e.slidesUrl, 'Slides'], [e.videoUrl, 'Video'], ...ownLinks(e.links)]}
          />
        </li>
      );
    case 'publication':
      return (
        <li className="it it--article" id={id}>
          {title(e.title, e.url)}
          <Meta
            separator=". "
            parts={[
              e.authors?.length ? listed(e.authors) : null,
              e.venue ? <i key="v">{e.venue}</i> : null,
              e.publishedAt ? <When key="d" raw={e.publishedAt} input={input} /> : null,
            ]}
          />
          <Prose
            source={e.abstract ?? e.description}
            input={input}
            className="it__text"
            role="body-compact"
          />
          {present(e.citation) ? (
            <p className="it__cite" data-type-role="caption">
              {e.citation}
            </p>
          ) : null}
          <Links
            input={input}
            note={e.awards?.length ? listed(e.awards) : undefined}
            links={[
              [e.pdfUrl, 'PDF'],
              [e.doi ? `https://doi.org/${e.doi}` : undefined, e.doi ? `doi:${e.doi}` : ''],
            ]}
          />
        </li>
      );
    case 'patent':
      return (
        <li className="it it--patent" id={id}>
          {title(e.title ? cap(e.title) : undefined, e.url)}
          <Meta
            parts={[
              e.number ? (
                <span key="n" className="ch-nobreak">
                  {e.number}
                </span>
              ) : null,
              e.status ? (
                <span key="s">
                  {cap(e.status)}
                  {e.grantedAt ? ' ' : null}
                  {e.grantedAt ? <When raw={e.grantedAt} input={input} /> : null}
                </span>
              ) : null,
              e.filedAt ? (
                <span key="f">
                  filed <When raw={e.filedAt} input={input} />
                </span>
              ) : null,
            ]}
          />
          <p className="it__text" data-type-role="body-compact">
            {e.description}
            {e.inventors?.length
              ? `${e.description ? ' ' : ''}Inventors ${listed(e.inventors)}${e.assignee ? `, assigned to ${e.assignee}` : ''}.`
              : null}
          </p>
        </li>
      );
    case 'press':
      return (
        <li className="it it--press" id={id}>
          {title(e.title, e.url)}
          <Meta
            parts={[
              e.publication ? <i key="p">{e.publication}</i> : null,
              e.author ? `by ${e.author}` : null,
              e.publishedAt ? <When key="d" raw={e.publishedAt} input={input} /> : null,
            ]}
          />
          {present(e.excerpt) ? (
            <blockquote className="it__quote" data-type-role="body">
              <Md source={e.excerpt} input={input} />
            </blockquote>
          ) : null}
        </li>
      );
    case 'award':
      return (
        <li className="it it--award" id={id}>
          {title(e.title, e.url)}
          <Meta
            parts={[
              e.organization,
              e.receivedAt ? <When key="d" raw={e.receivedAt} input={input} /> : null,
            ]}
          />
          <Prose source={e.description} input={input} className="it__text" role="body-compact" />
        </li>
      );
    default:
      return (
        <li className="it" id={id}>
          {title(e.title ?? e.statement, e.url ?? e.links?.[0]?.url)}
          <Meta
            parts={[
              e.venue ?? e.organization ?? e.publication,
              e.location ?? e.locationLabel,
              e.publishedAt ? <When key="d" raw={e.publishedAt} input={input} /> : null,
            ]}
          />
          {e.title ? (
            <Prose source={e.statement} input={input} className="it__text" role="body-compact" />
          ) : null}
          <Prose source={e.description} input={input} className="it__text" role="body-compact" />
          <Links input={input} links={ownLinks(e.links)} />
        </li>
      );
  }
}

/** A work's tags, as the book files it: "Filed under a, b". */
function Tags({ work, group }: { work: Work; group?: string }) {
  const tags = (work.tags ?? []).filter((tag) => !repeats(tag, group));
  return tags.length ? (
    <p className="it__meta" data-type-role="body-compact">
      Filed under {listed(tags)}.
    </p>
  ) : null;
}

function Links({
  input,
  links,
  note,
}: {
  input: Input;
  links: readonly (readonly [string | undefined, string])[];
  note?: string;
}) {
  const shown = links.filter(([url]) => url !== undefined);
  if (shown.length === 0 && !note) return null;
  return (
    <p className="it__links" data-type-role="body-compact">
      {note ? <span className="it__note">{note}</span> : null}
      {shown.map(([url, label], i) => (
        <Out key={`${url}-${i}`} url={url} input={input}>
          {label}
        </Out>
      ))}
    </p>
  );
}

export function Entry({
  record,
  input,
  level,
  group,
}: {
  record: BookRecord;
  input: Input;
  level: Level;
  /** The group's own title, so an entry doesn't repeat it (P2-4). */
  group?: string;
}) {
  return record.type === 'work' ? (
    <WorkEntry work={record.work} input={input} level={level} group={group} />
  ) : (
    <EvidenceEntry evidence={record.evidence} input={input} level={level} />
  );
}

/**
 * A section's records on a page, framed as its section: its title and
 * subtitle, then an entry for each record. `framed` is false for a section
 * the page already framed.
 */
export function GroupBlock({
  group,
  input,
  framed,
  depth = 2,
}: {
  group: Group;
  input: Input;
  framed: boolean;
  /** The group title's heading level: 3 inside a part that has its own h2, as Uncollected. */
  depth?: 2 | 3;
}) {
  const { section, records } = group;
  const titled = present(section.title);
  const headId = idOf(input, `${section.id}--title`);
  const attributes = framed ? frameAttributes(section, input, true) : {};
  const figures = records.every((r) => r.type === 'evidence' && r.evidence.type === 'metric');
  return (
    <section className="gp" {...attributes} aria-labelledby={titled ? headId : undefined}>
      {titled ? (
        <H level={depth} className="gp__t" id={headId}>
          {section.title}
        </H>
      ) : null}
      {present(section.subtitle) ? (
        <p className="gp__sub" data-type-role="body-compact">
          {section.subtitle}
        </p>
      ) : null}
      <ol className={figures ? 'gp__list gp__list--figures' : 'gp__list'} role="list">
        {records.map((record) => (
          <Entry
            key={record.id}
            record={record}
            input={input}
            level={titled ? ((depth + 1) as Level) : depth}
            group={section.title}
          />
        ))}
      </ol>
    </section>
  );
}
