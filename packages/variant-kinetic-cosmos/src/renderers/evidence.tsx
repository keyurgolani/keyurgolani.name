import type { Evidence } from '@portfolio/schema';
import { Disclosure } from '@portfolio/appearance/primitives';
import {
  citesWhole,
  DateText,
  evidenceOf,
  formatFigure,
  formatNames,
  Heading,
  hrefFor,
  LabeledDate,
  MaybeLink,
  MediaFigure,
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
import { Planets, type Planet } from '../bodies';
import { FoldOnPhone } from '../fold';
import { IndexClose, IndexTrigger, InkDialog } from '../system-index';
import { Facts, LinkRow, Phrase, UrlRow, placedPhoto } from '../parts';

// Evidence in Kinetic Cosmos (redesign, stream E): each piece takes the
// shape its type has. Figures sit on dotted leaders with tabular numbers;
// testimonials and press are quotations, the first set large; talks are
// objects, the first one wide, each with its foot pinned; publications are
// citations under a hanging year, the abstract behind a disclosure; awards
// and patents are ruled records, a patent with its facts; and work kept
// elsewhere is a body with its own figures. A section of mixed types lays
// out by the type most of it is, and each piece still shows as its own.

const TALK_FORMATS = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
} as const;

const PATENT_STATUSES = { granted: 'Granted', pending: 'Pending', expired: 'Expired' } as const;

/** The type most of the entries are. */
function dominantType(entries: readonly Evidence[]): Evidence['type'] {
  const tally = new Map<Evidence['type'], number>();
  for (const entry of entries) tally.set(entry.type, (tally.get(entry.type) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0]![0];
}

/** The year a piece of evidence dates from, for a hanging year: its first dated field. */
function yearOf(entry: Evidence): string | undefined {
  const raw =
    entry.publishedAt ??
    entry.receivedAt ??
    entry.grantedAt ??
    entry.filedAt ??
    entry.presentedAt ??
    entry.asOf;
  const year = raw === undefined ? undefined : /^\d{4}/.exec(raw)?.[0];
  return year;
}

/** The source by the owner's name for it, linked when it has an address. */
function SourceName({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  if (!entry.source) return null;
  return (
    <MaybeLink url={entry.source.url} ctx={ctx}>
      <strong>{entry.source.name}</strong>
    </MaybeLink>
  );
}

/** A DOI's own text and its doi.org address, each part encoded. */
function doiLink(raw: string): { text: string; url: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** The entry's way out: its action label, else its title links; and its unlabelled addresses. */
function Outbound({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const action = [entry.buttonText, entry.urlLabel].find(present);
  const doi = entry.doi !== undefined ? doiLink(entry.doi) : undefined;
  // What its links open, so a page of talks doesn't say "Watch" three times.
  const subject =
    entry.type === 'talk'
      ? `the ${(entry.format !== undefined ? TALK_FORMATS[entry.format] : 'talk').toLowerCase()}`
      : entry.type === 'publication'
        ? 'the paper'
        : undefined;
  return (
    <>
      {action !== undefined && entry.url !== undefined ? (
        <p className="kc-actions">
          <a className="kc-link-action" href={hrefFor(entry.url, ctx.input)}>
            {action}
          </a>
        </p>
      ) : null}
      {doi ? (
        <p className="kc-doi">
          <a href={doi.url}>{doi.text}</a>
        </p>
      ) : null}
      <UrlRow
        urls={[
          ['pdfUrl', entry.pdfUrl],
          ['slidesUrl', entry.slidesUrl],
          ['videoUrl', entry.videoUrl],
        ]}
        ctx={ctx}
        {...(subject !== undefined ? { subject } : {})}
      />
      <LinkRow links={entry.links} ctx={ctx} />
    </>
  );
}

/** The entry's title as its heading, linked when it has an address and no action label. */
function Title({
  entry,
  ctx,
  className,
}: {
  entry: Evidence;
  ctx: RenderContext;
  className: string;
}) {
  if (!present(entry.title)) return null;
  const linked = [entry.buttonText, entry.urlLabel].some(present) ? undefined : entry.url;
  return (
    <Heading level={ctx.itemLevel} className={className}>
      <MaybeLink url={linked} ctx={ctx}>
        {entry.title}
      </MaybeLink>
    </Heading>
  );
}

/** A figure as a planet: the number on the body, and what it counts and where from on its plate. */
function planetOf(entry: Evidence, ctx: RenderContext, anchor?: string): Planet {
  const value = entry.metric?.value;
  return {
    key: entry.id,
    ...(anchor !== undefined ? { id: anchor } : {}),
    ...(entry.lang !== undefined ? { lang: entry.lang } : {}),
    type: entry.type,
    value: value !== undefined ? <data value={value}>{formatFigure(value, ctx)}</data> : null,
    ...(typeof value === 'number' ? { magnitude: value } : {}),
    ...(present(entry.metric?.unit) ? { unit: entry.metric.unit } : {}),
    plate: (
      <>
        {present(entry.title) ? <span className="kc-planet__title">{entry.title}</span> : null}
        {present(entry.statement) ? (
          <RichText
            source={entry.statement}
            inline
            input={ctx.input}
            className="kc-planet__words"
          />
        ) : null}
        <Phrase
          className="kc-planet__source"
          role="label"
          parts={[
            entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
            entry.asOf !== undefined && (
              <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
            ),
          ]}
        />
      </>
    ),
  };
}

/** A quotation: a testimonial's words or a press excerpt, then who said it and where. */
function Quotation({
  entry,
  ctx,
  anchor,
  lead,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
  lead: boolean;
}) {
  const words = entry.type === 'testimonial' ? entry.statement : (entry.excerpt ?? entry.statement);
  const avatar = placedPhoto(entry.source?.avatar, ctx);
  return (
    <li
      id={anchor}
      className="kc-quote"
      data-lead={lead ? '' : undefined}
      data-evidence-type={entry.type}
      lang={entry.lang}
    >
      <figure className="kc-quote__figure">
        {present(words) ? (
          <blockquote
            cite={
              entry.source?.url !== undefined ? hrefFor(entry.source.url, ctx.input) : undefined
            }
          >
            <RichText source={words} input={ctx.input} />
          </blockquote>
        ) : null}
        <figcaption className="kc-quote__caption">
          {avatar ? (
            <MediaFigure placed={avatar} ctx={ctx} className="kc-avatar" sizes="3rem" inline />
          ) : null}
          <Phrase
            parts={[
              entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
              entry.author,
              entry.source?.role,
              entry.source?.organization,
              entry.publication,
              entry.publishedAt !== undefined && (
                <DateText key="published" raw={entry.publishedAt} ctx={ctx} field="publishedAt" />
              ),
              present(entry.title) &&
                (entry.url !== undefined ? (
                  <a key="title" href={hrefFor(entry.url, ctx.input)}>
                    {entry.title}
                  </a>
                ) : (
                  <cite key="title">{entry.title}</cite>
                )),
            ]}
          />
        </figcaption>
      </figure>
      {entry.type === 'testimonial' && entry.asOf !== undefined ? (
        <p className="kc-quote__as-of" data-type-role="label">
          <LabeledDate label="As of" raw={entry.asOf} ctx={ctx} />
        </p>
      ) : null}
    </li>
  );
}

/**
 * A talk as an object: where, its title and words, and a foot with its
 * format and date. Its abstract and its links open in a dialog of their own
 * (the engagements as dialogs, P2), from a button named for the talk; with
 * no script the dialog's content sits in the object, as it would read.
 */
function TalkObject({
  entry,
  ctx,
  anchor,
  lead,
  dialogId,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
  lead: boolean;
  dialogId: string;
}) {
  const more = present(entry.description) && present(entry.title);
  return (
    <li
      id={anchor}
      className="kc-object"
      data-lead={lead ? '' : undefined}
      data-evidence-type={entry.type}
      lang={entry.lang}
    >
      <div className="kc-object__head">
        <Phrase
          className="kc-object__venue"
          parts={[entry.venue ?? entry.source?.name, shownPlace(entry.location)]}
        />
        <span className="kc-object__mark" aria-hidden="true">
          <span />
        </span>
      </div>
      <Title entry={entry} ctx={ctx} className="kc-object__title" />
      {present(entry.statement) ? (
        <RichText source={entry.statement} className="kc-summary" input={ctx.input} />
      ) : null}
      {present(entry.description) && !more ? (
        <RichText source={entry.description} className="kc-summary" input={ctx.input} />
      ) : null}
      <div className="kc-object__foot">
        <Phrase
          role="label"
          parts={[
            entry.format !== undefined && (
              <Ui key="format" ctx={ctx}>
                {TALK_FORMATS[entry.format]}
              </Ui>
            ),
            entry.presentedAt !== undefined && (
              <DateText key="presented" raw={entry.presentedAt} ctx={ctx} field="presentedAt" />
            ),
          ]}
        />
        {more ? (
          <IndexTrigger target={dialogId} className="kc-object__more kc-link-action">
            <Ui ctx={ctx}>About the talk</Ui>
            <span className="kc-sr"> {entry.title}</span>
          </IndexTrigger>
        ) : (
          <Outbound entry={entry} ctx={ctx} />
        )}
      </div>
      {more ? (
        <InkDialog id={dialogId} className="kc-talk-dialog" labelledBy={`${dialogId}--title`}>
          <div className="kc-talk-dialog__head">
            <p className="kc-talk-dialog__title" id={`${dialogId}--title`}>
              {entry.title}
            </p>
            <IndexClose target={dialogId} className="kc-index__close">
              <Ui ctx={ctx}>Close</Ui>
            </IndexClose>
          </div>
          <RichText source={entry.description!} className="kc-prose" input={ctx.input} />
          <Outbound entry={entry} ctx={ctx} />
        </InkDialog>
      ) : null}
    </li>
  );
}

/** A citation: its year hanging in the margin, the title, the authors and venue, the abstract folded. */
function Citation({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  return (
    <li id={anchor} className="kc-record" data-evidence-type={entry.type} lang={entry.lang}>
      <p className="kc-record__year" aria-hidden={yearOf(entry) ? undefined : true}>
        {yearOf(entry)}
      </p>
      <div className="kc-record__main">
        <Title entry={entry} ctx={ctx} className="kc-record__title" />
        {/* A citation written whole stands for the authors, venue, and date (A4). */}
        {citesWhole(entry) ? null : (
          <Phrase
            className="kc-record__meta"
            parts={[
              entry.authors?.length ? formatNames(entry.authors, ctx) : undefined,
              entry.venue ?? entry.publication,
              entry.publishedAt !== undefined && (
                <DateText key="published" raw={entry.publishedAt} ctx={ctx} field="publishedAt" />
              ),
            ]}
          />
        )}
        {present(entry.citation) ? <p className="kc-record__meta">{entry.citation}</p> : null}
        {present(entry.statement) ? (
          <RichText source={entry.statement} className="kc-summary" input={ctx.input} />
        ) : null}
        {present(entry.abstract) ? (
          <Disclosure className="kc-abstract" summary={<Ui ctx={ctx}>Abstract</Ui>}>
            <RichText source={entry.abstract} className="kc-prose" input={ctx.input} />
          </Disclosure>
        ) : null}
      </div>
      <div className="kc-record__side">
        {entry.awards?.length ? (
          <ul className="kc-record__awards" role="list" data-type-role="label">
            {entry.awards.filter(present).map((award, index) => (
              <li key={index}>{award}</li>
            ))}
          </ul>
        ) : null}
        <Outbound entry={entry} ctx={ctx} />
      </div>
    </li>
  );
}

/** An award, a patent, or any other record: a ruled row under its year. */
function Record({ entry, ctx, anchor }: { entry: Evidence; ctx: RenderContext; anchor?: string }) {
  const patent = entry.type === 'patent';
  return (
    <li
      id={anchor}
      className="kc-record kc-record--compact"
      data-evidence-type={entry.type}
      lang={entry.lang}
    >
      <p className="kc-record__year">{yearOf(entry)}</p>
      <div className="kc-record__main">
        <Title entry={entry} ctx={ctx} className="kc-record__title" />
        <Phrase
          className="kc-record__meta"
          parts={[
            entry.organization,
            entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
            entry.venue,
            shownPlace(entry.location),
            !patent && entry.receivedAt !== undefined && (
              <DateText key="received" raw={entry.receivedAt} ctx={ctx} field="receivedAt" />
            ),
          ]}
        />
        {present(entry.statement) ? (
          <RichText source={entry.statement} className="kc-summary" input={ctx.input} />
        ) : null}
        {present(entry.description) ? (
          <RichText source={entry.description} className="kc-summary" input={ctx.input} />
        ) : null}
        {patent ? (
          <Facts
            className="kc-facts kc-facts--small"
            rows={[
              [
                <Ui key="l" ctx={ctx}>
                  Number
                </Ui>,
                entry.number,
                'number',
              ],
              [
                <Ui key="l" ctx={ctx}>
                  Status
                </Ui>,
                entry.status !== undefined ? (
                  <Ui ctx={ctx}>{PATENT_STATUSES[entry.status]}</Ui>
                ) : undefined,
                'status',
              ],
              [
                <Ui key="l" ctx={ctx}>
                  Filed
                </Ui>,
                entry.filedAt !== undefined ? (
                  <DateText raw={entry.filedAt} ctx={ctx} field="filedAt" />
                ) : undefined,
                'filed',
              ],
              [
                <Ui key="l" ctx={ctx}>
                  Granted
                </Ui>,
                entry.grantedAt !== undefined ? (
                  <DateText raw={entry.grantedAt} ctx={ctx} field="grantedAt" />
                ) : undefined,
                'granted',
              ],
              [
                <Ui key="l" ctx={ctx}>
                  Inventors
                </Ui>,
                entry.inventors?.length ? formatNames(entry.inventors, ctx) : undefined,
                'inventors',
              ],
              [
                <Ui key="l" ctx={ctx}>
                  Assignee
                </Ui>,
                entry.assignee,
                'assignee',
              ],
            ]}
          />
        ) : null}
        <Outbound entry={entry} ctx={ctx} />
      </div>
    </li>
  );
}

/** Work kept elsewhere: a body with its title, words, its own figures, and where it lives. */
/** A label set inside a sentence: its first letter lowered, unless the word is an acronym. */
const lowered = (text: string | undefined) =>
  text === undefined || /^\p{Lu}{2}/u.test(text)
    ? text
    : text.charAt(0).toLowerCase() + text.slice(1);

function Elsewhere({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  return (
    <li id={anchor} className="kc-elsewhere" data-evidence-type={entry.type} lang={entry.lang}>
      <Title entry={entry} ctx={ctx} className="kc-elsewhere__title" />
      {present(entry.description) ? (
        <RichText source={entry.description} className="kc-summary" input={ctx.input} />
      ) : null}
      {present(entry.statement) ? (
        <RichText source={entry.statement} className="kc-summary" input={ctx.input} />
      ) : null}
      <Phrase
        className="kc-caption"
        role="label"
        parts={[
          ...(entry.categories ?? []),
          shownPlace(entry.locationLabel) ?? shownPlace(entry.location),
        ]}
      />
      {entry.highlights?.length ? (
        <p className="kc-elsewhere__figures">
          {entry.highlights.map((highlight, index) => (
            <span key={index}>
              {index > 0 ? (index === entry.highlights!.length - 1 ? ' and ' : ', ') : null}
              <strong>{highlight.label}</strong>
              {'\u00a0'}
              {lowered(highlight.sub)}
            </span>
          ))}
        </p>
      ) : null}
      <Outbound entry={entry} ctx={ctx} />
    </li>
  );
}

export function EvidenceBodies({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const ctx = renderContext(input, section, level);
  const listed = evidenceOf(section, input);
  const shape = dominantType(listed);
  // Papers newest first, as a publication list reads; everything else in the owner's order.
  const entries =
    shape === 'publication'
      ? listed
          .map((entry, index) => ({ entry, index, at: entry.publishedAt ?? '' }))
          .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.index - b.index))
          .map(({ entry }) => entry)
      : listed;
  const anchor = (entry: Evidence) => recordAnchor(section, entry, input);
  if (shape === 'metric') {
    return <Planets items={entries.map((entry) => planetOf(entry, ctx, anchor(entry)))} />;
  }
  const quoted = shape === 'testimonial' || shape === 'press';
  // The words of others lead with one quotation; the rest fold away, one tap or link from view.
  const folded = shape === 'testimonial' && entries.length > 1 ? entries.length - 1 : 0;
  const item = (entry: Evidence, index: number) => {
    const id = anchor(entry);
    switch (entry.type) {
      case 'metric':
        return (
          <li key={entry.id}>
            <Planets items={[planetOf(entry, ctx, id)]} />
          </li>
        );
      case 'testimonial':
      case 'press':
        return (
          <Quotation
            key={entry.id}
            entry={entry}
            ctx={ctx}
            anchor={id}
            lead={quoted && index === 0}
          />
        );
      case 'talk':
        return (
          <TalkObject
            key={entry.id}
            entry={entry}
            ctx={ctx}
            anchor={id}
            lead={index === 0}
            dialogId={`${input.ids.prefix}${section.id}--${entry.id}--talk`}
          />
        );
      case 'publication':
        return <Citation key={entry.id} entry={entry} ctx={ctx} anchor={id} />;
      case 'external-work':
        return <Elsewhere key={entry.id} entry={entry} ctx={ctx} anchor={id} />;
      default:
        return <Record key={entry.id} entry={entry} ctx={ctx} anchor={id} />;
    }
  };
  const list = (items: readonly Evidence[], from: number) => (
    <ul className="kc-evidence" role="list" data-shape={shape} data-count={items.length}>
      {items.map((entry, index) => item(entry, from + index))}
    </ul>
  );
  if (folded === 0) return list(entries, 0);
  return (
    <>
      {list(entries.slice(0, 1), 0)}
      {/* In a wrapper of its own, so a link to the section doesn't open it: only one inside does. */}
      <div className="kc-evidence__more">
        <FoldOnPhone
          className="kc-fold--inline kc-fold--earlier"
          closed
          summary={
            <Ui ctx={ctx}>{folded === 1 ? '1 more quotation' : `${folded} more quotations`}</Ui>
          }
        >
          {list(entries.slice(1), 1)}
        </FoldOnPhone>
      </div>
    </>
  );
}
