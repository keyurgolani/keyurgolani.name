import type { ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  DateText,
  evidenceOf,
  formatFigure,
  formatNames,
  Heading,
  hrefFor,
  MaybeLink,
  present,
  recordAnchor,
  renderContext,
  RichText,
  shownPlace,
  Ui,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { layoutOf } from './evidence-layout';
import { Vitrine, type ChecklistRow } from './labels';
import { SectionTitle } from './title';

// Evidence in the record (redesign, stream C, C1). A section hangs its
// entries the way what they are reads best (evidence-layout.ts):
//
//   metrics              At a glance: one wall label in sentences, the
//                        figure leading each, never Editorial's leaders
//   press, testimonials  framed inscriptions: the words in a frame, the
//                        credit under it in the caption system
//   anything else        the catalogue checklist in a vitrine: number,
//                        title, where, and when
//
// Every entry takes its record's anchor on the first section that lists
// it, and shows the owner's words alone: no label of a field's name, and a
// date as written.

const TALK_FORMATS = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
} as const;

const PATENT_STATUSES = { granted: 'granted', pending: 'pending', expired: 'expired' } as const;

/** Short facts joined with commas, the owner's own words, as one credit line. */
function Credit({ parts, className = 'oa-credit' }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  if (shown.length === 0) return null;
  return (
    <p className={className} data-type-role="label">
      {shown.map((part, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          {part}
        </span>
      ))}
    </p>
  );
}

/** Facts on one line of a label, joined with commas. */
function Joined({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((part, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          {part}
        </span>
      ))}
    </>
  );
}

/** The figure of a metric, with its unit. */
function Figure({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  if (entry.metric?.value === undefined) return null;
  return (
    <data value={entry.metric.value} className="oa-check__figure">
      {formatFigure(entry.metric.value, ctx)}
      {present(entry.metric.unit) ? ` ${entry.metric.unit}` : null}
    </data>
  );
}

/** A sentence from the owner's words: its first letter lowered, unless the word is a name or an acronym. */
function lowered(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** Text that ends as a sentence does. */
function stopped(text: string): string {
  return /[.!?\u2026]["'\u2019\u201d)]?$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/**
 * A metric as a sentence on At a glance's label, the figure leading: "12
 * years engineering, from research code…", "38 services owned, across
 * three platform teams". The unit is left out when the claim starts with
 * it. The owner's words are plain text here, their Markdown marks dropped.
 */
export function glanceSentence(entry: Evidence, figure: string): string {
  const claim = (entry.title ?? entry.statement ?? '').replace(/[*_`]/g, '').trim();
  const unit = entry.metric?.unit?.trim();
  // The owner's unit is free text ("+", "x", "req/s"), so it's compared as text, never read as a pattern.
  const unitLeads =
    unit !== undefined &&
    unit !== '' &&
    claim.toLocaleLowerCase().startsWith(unit.toLocaleLowerCase()) &&
    !/^[\p{L}\p{M}\p{N}]/u.test(claim.slice(unit.length));
  const lead = unit !== undefined && unit !== '' && !unitLeads ? `${figure} ${unit}` : figure;
  const more = [present(entry.title) ? entry.statement : undefined, entry.description]
    .filter(present)
    .map((text) => lowered(text.replace(/[*_`]/g, '').trim()));
  return stopped([`${lead} ${lowered(claim)}`.trim(), ...more].join(', '));
}

/** At a glance: one wall label in sentences, the figures in tabular numerals, never leaders. */
function Glance({
  entries,
  section,
  ctx,
}: {
  entries: readonly Evidence[];
  section: SectionOf<'evidence'>;
  ctx: RenderContext;
}) {
  const { input } = ctx;
  return (
    <p className="oa-glance">
      {entries.map((entry, index) => (
        <span key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
          {index > 0 ? ' ' : null}
          {glanceSentence(entry, formatFigure(entry.metric!.value!, ctx))}
        </span>
      ))}
    </p>
  );
}

/** An entry as a row of the record's checklist: its title, where it was, and when. */
function entryRow(entry: Evidence, ctx: RenderContext, anchor: string | undefined): ChecklistRow {
  const { input } = ctx;
  const words = (text: string | undefined) =>
    present(text) ? <RichText source={text} inline input={input} /> : undefined;
  const titleText = present(entry.title) ? entry.title : entry.statement;
  const title = present(titleText) ? (
    <MaybeLink url={entry.url ?? entry.videoUrl ?? entry.slidesUrl} ctx={ctx}>
      <RichText source={titleText} inline input={input} />
    </MaybeLink>
  ) : (
    (entry.venue ?? entry.publication ?? '')
  );
  const date =
    entry.receivedAt ??
    entry.presentedAt ??
    entry.publishedAt ??
    entry.grantedAt ??
    entry.asOf ??
    undefined;
  const people = entry.authors ?? entry.inventors;
  const where = (parts: ReactNode[]) => <Joined parts={parts} />;
  const figure =
    entry.metric?.value !== undefined ? <Figure key="figure" entry={entry} ctx={ctx} /> : undefined;
  return {
    key: entry.id,
    id: anchor,
    lang: entry.lang,
    type: entry.type,
    title,
    more: [
      figure,
      entry.type === 'talk' && entry.format !== undefined ? (
        <Ui key="format" ctx={ctx}>
          {TALK_FORMATS[entry.format]}
        </Ui>
      ) : undefined,
      people?.length ? formatNames(people, ctx) : undefined,
      present(entry.title) ? words(entry.excerpt ?? entry.statement) : undefined,
      words(entry.description),
      ...(entry.awards ?? []),
    ],
    where:
      entry.type === 'talk'
        ? where([entry.venue, shownPlace(entry.location)])
        : where([
            entry.source ? (
              <MaybeLink key="source" url={entry.source.url} ctx={ctx}>
                {entry.source.name}
              </MaybeLink>
            ) : undefined,
            entry.venue,
            entry.publication,
            entry.organization,
            entry.number,
            entry.status !== undefined ? (
              <Ui key="status" ctx={ctx}>
                {PATENT_STATUSES[entry.status]}
              </Ui>
            ) : undefined,
            entry.assignee,
          ]),
    when: date !== undefined ? <DateText raw={date} ctx={ctx} /> : undefined,
  };
}

/** What a checklist of these entries calls its rows. */
function rowWord(entries: readonly Evidence[]): string {
  const every = (type: Evidence['type']) => entries.every((entry) => entry.type === type);
  if (every('talk')) return 'Talk';
  if (every('publication')) return 'Paper';
  if (every('award')) return 'Award';
  if (every('patent')) return 'Patent';
  return 'Title';
}

/**
 * A press clipping, mounted as a framed inscription: the excerpt at the
 * title size in its frame, then who wrote it, the piece, and where, under
 * it in the caption system.
 */
function Clipping({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  const { input } = ctx;
  const words = entry.excerpt ?? entry.statement;
  return (
    <figure id={anchor} className="oa-frame" lang={entry.lang}>
      {present(words) ? (
        <div className="oa-frame__mat">
          <blockquote cite={entry.url !== undefined ? hrefFor(entry.url, input) : undefined}>
            <RichText source={words} input={input} />
          </blockquote>
        </div>
      ) : null}
      <figcaption>
        <Credit
          parts={[
            entry.author ?? entry.source?.name,
            present(entry.title) ? (
              <MaybeLink key="title" url={entry.url} ctx={ctx}>
                {entry.title}
              </MaybeLink>
            ) : undefined,
            entry.publication ?? entry.venue,
            entry.publishedAt !== undefined ? (
              <DateText key="date" raw={entry.publishedAt} ctx={ctx} />
            ) : undefined,
          ]}
        />
      </figcaption>
    </figure>
  );
}

/** A testimonial, mounted as a framed inscription: what was said, then who said it. */
function Voice({ entry, ctx, anchor }: { entry: Evidence; ctx: RenderContext; anchor?: string }) {
  const { input } = ctx;
  return (
    <figure id={anchor} className="oa-frame" lang={entry.lang}>
      <div className="oa-frame__mat">
        <blockquote
          cite={entry.source?.url !== undefined ? hrefFor(entry.source.url, input) : undefined}
        >
          {present(entry.statement) ? <RichText source={entry.statement} input={input} /> : null}
        </blockquote>
      </div>
      <figcaption>
        <Credit
          parts={[
            entry.source ? (
              <MaybeLink key="name" url={entry.source.url} ctx={ctx}>
                {entry.source.name}
              </MaybeLink>
            ) : undefined,
            entry.source?.role,
            entry.source?.organization,
          ]}
        />
      </figcaption>
    </figure>
  );
}

/** A bibliography entry, as an owner's custom section lists its evidence: the title, then the facts. */
export function Entry({
  entry,
  ctx,
  anchor,
  level,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
  level?: RenderContext['level'];
}) {
  const { input } = ctx;
  const people = entry.authors ?? entry.inventors;
  const date = entry.publishedAt ?? entry.grantedAt ?? entry.receivedAt ?? entry.presentedAt;
  const title = present(entry.title) ? entry.title : undefined;
  const titleText = title ? (
    <MaybeLink url={entry.url} ctx={ctx}>
      {title}
    </MaybeLink>
  ) : null;
  const words = entry.statement;
  const metric = entry.metric?.value !== undefined ? <Figure entry={entry} ctx={ctx} /> : null;
  return (
    <li id={anchor} className="oa-entry" data-evidence-type={entry.type} lang={entry.lang}>
      {titleText ? (
        level !== undefined ? (
          <Heading level={level} className="oa-entry__title">
            {titleText}
          </Heading>
        ) : (
          <p className="oa-entry__title">{titleText}</p>
        )
      ) : null}
      {metric ? <p className="oa-entry__figure">{metric}</p> : null}
      {present(words) ? (
        <RichText source={words} className="oa-entry__words" input={input} />
      ) : null}
      <Credit
        className="oa-entry__facts"
        parts={[
          people?.length ? formatNames(people, ctx) : undefined,
          entry.source ? (
            <MaybeLink key="source" url={entry.source.url} ctx={ctx}>
              {entry.source.name}
            </MaybeLink>
          ) : undefined,
          entry.source?.role,
          entry.venue,
          entry.publication,
          entry.organization,
          entry.number,
          entry.status !== undefined ? (
            <Ui key="status" ctx={ctx}>
              {PATENT_STATUSES[entry.status]}
            </Ui>
          ) : undefined,
          entry.assignee,
          shownPlace(entry.locationLabel) ?? shownPlace(entry.location),
          date !== undefined ? <DateText key="date" raw={date} ctx={ctx} /> : undefined,
          ...(entry.awards ?? []),
        ]}
      />
      {present(entry.description) ? (
        <RichText source={entry.description} className="oa-entry__more" input={input} />
      ) : null}
      {entry.highlights?.length ? (
        <p className="oa-entry__more">
          {entry.highlights.map((highlight) => `${highlight.label} ${highlight.sub}`).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

export function EvidenceSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const ctx = renderContext(input, section, level);
  const entries = evidenceOf(section, input);
  const layout = layoutOf(entries);
  const glance =
    entries.length > 0 &&
    entries.every((entry) => entry.type === 'metric' && entry.metric?.value !== undefined);
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {layout === 'clippings' || layout === 'voices' ? (
        <div className="oa-frames">
          {entries.map((entry) =>
            layout === 'clippings' ? (
              <Clipping
                key={entry.id}
                entry={entry}
                ctx={ctx}
                anchor={recordAnchor(section, entry, input)}
              />
            ) : (
              <Voice
                key={entry.id}
                entry={entry}
                ctx={ctx}
                anchor={recordAnchor(section, entry, input)}
              />
            ),
          )}
        </div>
      ) : glance ? (
        <Glance entries={entries} section={section} ctx={ctx} />
      ) : (
        <Vitrine
          input={input}
          title={rowWord(entries)}
          where="Where"
          when="When"
          rows={entries.map((entry) => entryRow(entry, ctx, recordAnchor(section, entry, input)))}
        />
      )}
    </>
  );
}
