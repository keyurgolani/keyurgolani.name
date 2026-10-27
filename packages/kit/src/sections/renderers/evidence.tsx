import type { Evidence } from '@portfolio/schema';
import { citesWhole, shownPlace } from '../evidence-facts';
import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
import {
  DateText,
  formatFigure,
  formatNames,
  hostLabelled,
  hrefFor,
  ItemTitle,
  LabeledDate,
  labelParts,
  LinkRow,
  MaybeLink,
  Meta,
  present,
  renderContext,
  SectionHeader,
  TagList,
  Ui,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import { evidenceOf, recordAnchor } from '../view';

// Evidence (#10, slice 1, item 7): typed, attributable facts. Each shows the
// owner's words, its source by the owner's name for it, and when it was
// true, as As of. A metric shows its value formatted in the content's
// language, with its unit, and nothing around it: no plus, no counter. A
// section of figures alone is a stats list, a `dl` of what's counted and
// its value (C6). A testimonial is a quote, captioned with who said it. A
// field's own name is never shown: a talk's format and a patent's status
// show as their values, a link the owner gave no label for shows its host,
// and a date or such a link carries its field name on a data attribute,
// for a composition that labels it.

const TALK_FORMATS = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
} as const;

const PATENT_STATUSES = { granted: 'Granted', pending: 'Pending', expired: 'Expired' } as const;

/** A DOI as written, without a `doi:` or resolver prefix, and its doi.org link, each part encoded. */
export function doiLink(raw: string): { text: string; url: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** The source by the owner's name for it, linked when it has an address. */
function SourceName({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { source } = entry;
  if (!source) return null;
  return (
    <MaybeLink url={source.url} ctx={ctx}>
      {source.name}
    </MaybeLink>
  );
}

/** A metric's value and unit, or nothing when the metric names what it counts alone. */
function MetricFigure({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { metric } = entry;
  if (metric?.value === undefined) return null;
  return (
    <>
      <data className="pf-metric__value" value={metric.value}>
        {formatFigure(metric.value, ctx)}
      </data>
      {present(metric.unit) ? (
        <>
          {/* No break between a figure and its unit (T8). */}
          {'\u00a0'}
          <span className="pf-metric__unit">{metric.unit}</span>
        </>
      ) : null}
    </>
  );
}

/** The figure on its own line, among an entry's other facts. */
function MetricValue({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  if (entry.metric?.value === undefined) return null;
  return (
    <p className="pf-metric">
      <MetricFigure entry={entry} ctx={ctx} />
    </p>
  );
}

/** A testimonial: the words, then who said them, with their role, organization, and portrait. */
function Testimonial({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const { input } = ctx;
  const avatar = placedMedia(entry.source?.avatar, ctx);
  return (
    <figure className="pf-quote">
      <blockquote
        cite={entry.source?.url !== undefined ? hrefFor(entry.source.url, input) : undefined}
        data-type-role="quote"
      >
        {present(entry.statement) ? <RichText source={entry.statement} input={input} /> : null}
      </blockquote>
      <figcaption>
        {avatar ? (
          <MediaFigure placed={avatar} ctx={ctx} className="pf-avatar" sizes="3rem" inline />
        ) : null}
        <Meta
          parts={[
            entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
            entry.source?.role,
            entry.source?.organization,
            entry.asOf !== undefined && (
              <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
            ),
          ]}
        />
      </figcaption>
    </figure>
  );
}

/** Any other evidence: its title, figure, words, and every fact the owner gave about it. */
function Fact({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  return (
    <>
      <ItemTitle text={entry.title} url={entry.url} ctx={ctx} />
      <MetricValue entry={entry} ctx={ctx} />
      {/* With no title to link, the record's address joins its links. */}
      <FactDetails entry={entry} ctx={ctx} statement url={!present(entry.title)} />
    </>
  );
}

/**
 * Every fact the owner gave about a piece of evidence but its title and its
 * figure: its words, unless `statement` is false because they're shown
 * already, its people, its meta line, and its links, with `url` among them
 * when nothing else links it.
 */
function FactDetails({
  entry,
  ctx,
  statement,
  url = false,
}: {
  entry: Evidence;
  ctx: RenderContext;
  statement: boolean;
  url?: boolean;
}) {
  const { input } = ctx;
  const doi = entry.doi !== undefined ? doiLink(entry.doi) : undefined;
  const action = [entry.buttonText, entry.urlLabel].find(present);
  // A citation written whole stands for the authors, venue, and date (A4).
  const whole = citesWhole(entry);
  return (
    <>
      {statement && present(entry.statement) ? (
        <RichText source={entry.statement} className="pf-statement" input={input} />
      ) : null}
      {entry.authors?.length && !whole ? (
        <p className="pf-authors">{formatNames(entry.authors, ctx)}</p>
      ) : null}
      {entry.inventors?.length ? (
        <p className="pf-authors" data-field="inventors">
          {formatNames(entry.inventors, ctx)}
        </p>
      ) : null}
      <Meta
        parts={[
          entry.format !== undefined && (
            <Ui key="format" ctx={ctx}>
              {TALK_FORMATS[entry.format]}
            </Ui>
          ),
          entry.source !== undefined && <SourceName key="source" entry={entry} ctx={ctx} />,
          entry.source?.role,
          entry.source?.organization,
          !whole && entry.venue,
          entry.publication,
          entry.author,
          entry.organization,
          entry.assignee,
          shownPlace(entry.location),
          shownPlace(entry.locationLabel),
          entry.number,
          entry.status !== undefined && (
            <Ui key="status" ctx={ctx}>
              {PATENT_STATUSES[entry.status]}
            </Ui>
          ),
          entry.publishedAt !== undefined && !whole && (
            <DateText key="published" raw={entry.publishedAt} ctx={ctx} field="publishedAt" />
          ),
          entry.presentedAt !== undefined && (
            <DateText key="presented" raw={entry.presentedAt} ctx={ctx} field="presentedAt" />
          ),
          entry.receivedAt !== undefined && (
            <DateText key="received" raw={entry.receivedAt} ctx={ctx} field="receivedAt" />
          ),
          entry.filedAt !== undefined && (
            <DateText key="filed" raw={entry.filedAt} ctx={ctx} field="filedAt" />
          ),
          entry.grantedAt !== undefined && (
            <DateText key="granted" raw={entry.grantedAt} ctx={ctx} field="grantedAt" />
          ),
          entry.asOf !== undefined && (
            <LabeledDate key="as-of" label="As of" raw={entry.asOf} ctx={ctx} />
          ),
          ...labelParts(entry.categories, 'categories', ctx),
        ]}
      />
      {present(entry.abstract) ? (
        <RichText source={entry.abstract} className="pf-abstract" input={input} />
      ) : null}
      {present(entry.excerpt) ? (
        <blockquote className="pf-excerpt">
          <RichText source={entry.excerpt} input={input} />
        </blockquote>
      ) : null}
      {present(entry.description) ? <RichText source={entry.description} input={input} /> : null}
      {present(entry.citation) ? <p className="pf-citation">{entry.citation}</p> : null}
      <TagList items={entry.awards} className="pf-highlights" />
      {entry.highlights?.length ? (
        // What's counted is the term and the figure its value, as in a stats list.
        <dl className="pf-stats pf-facts" data-count={entry.highlights.length}>
          {entry.highlights.map((highlight, index) => (
            <div key={index} className="pf-stat">
              <dt>{highlight.sub}</dt>
              <dd className="pf-stat__value">{highlight.label}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {doi ? (
        <p className="pf-doi">
          <a href={doi.url}>{doi.text}</a>
        </p>
      ) : null}
      {action !== undefined && entry.url !== undefined ? (
        <p className="pf-external-link">
          <a className="pf-action" href={hrefFor(entry.url, input)}>
            {action}
          </a>
          {present(entry.buttonText) && present(entry.urlLabel) ? (
            <>
              {' '}
              <span className="pf-url">{entry.urlLabel}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <LinkRow
        fields={[
          ['pdfUrl', entry.pdfUrl],
          ['slidesUrl', entry.slidesUrl],
          ['videoUrl', entry.videoUrl],
          ...(url && action === undefined ? ([['url', entry.url]] as const) : []),
        ]}
        links={entry.links}
        ctx={ctx}
      />
    </>
  );
}

/** Whether every entry is a metric with a value and words for what it counts, which a stats list shows. */
function allFigures(entries: readonly Evidence[]): boolean {
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry.type === 'metric' &&
        entry.metric?.value !== undefined &&
        (present(entry.title) || present(entry.statement)),
    )
  );
}

/** What a stat's term and value show, so its note needn't. */
const IN_TERM = new Set(['id', 'type', 'visibility', 'lang', 'title', 'metric', 'iconName']);

/** Whether a field holds something to show. */
function holds(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return present(value);
  return value !== undefined && value !== null;
}

/**
 * A metric in a stats list, as one cell of a `dl`: its title, linked, then
 * its value and unit, or, with no title, the value first and the statement
 * it counts after it; then, in a note in the caption role, every other fact
 * the owner gave about it, as an evidence entry shows them, so a stats list
 * loses nothing a list of the same entries shows.
 */
function Stat({ entry, ctx, anchor }: { entry: Evidence; ctx: RenderContext; anchor?: string }) {
  const titled = present(entry.title);
  const noted = Object.entries(entry).some(
    ([key, value]) =>
      !IN_TERM.has(key) &&
      !(key === 'statement' && !titled) &&
      !(key === 'url' && titled) &&
      holds(value),
  );
  return (
    <div
      id={anchor}
      className="pf-stat"
      data-evidence-type={entry.type}
      data-metric={entry.metric?.key}
      data-icon={entry.iconName}
      lang={entry.lang}
    >
      {titled ? (
        <>
          <dt>
            <MaybeLink url={entry.url} ctx={ctx}>
              {entry.title}
            </MaybeLink>
          </dt>
          <dd className="pf-stat__value">
            <MetricFigure entry={entry} ctx={ctx} />
          </dd>
        </>
      ) : (
        // A statement is a sentence, so the figure comes first, never as its tail.
        <>
          <dt className="pf-stat__value">
            <MetricFigure entry={entry} ctx={ctx} />
          </dt>
          <dd>
            {present(entry.statement) && (
              <RichText source={entry.statement} inline input={ctx.input} />
            )}
          </dd>
        </>
      )}
      {noted ? (
        <dd className="pf-stat__note" data-type-role="caption">
          <FactDetails entry={entry} ctx={ctx} statement={titled} url={!titled} />
        </dd>
      ) : null}
    </div>
  );
}

/** One piece of evidence, as a list item whose id is the record's on the first section that lists it. */
export function EvidenceEntry({
  entry,
  ctx,
  anchor,
}: {
  entry: Evidence;
  ctx: RenderContext;
  anchor?: string;
}) {
  return (
    <li
      id={anchor}
      className="pf-item"
      data-evidence-type={entry.type}
      data-metric={entry.metric?.key}
      data-icon={entry.iconName}
      lang={entry.lang}
    >
      {entry.type === 'testimonial' ? (
        <Testimonial entry={entry} ctx={ctx} />
      ) : (
        <Fact entry={entry} ctx={ctx} />
      )}
    </li>
  );
}

export function EvidenceSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const entries = evidenceOf(section, input);
  // A link shown by its host reads apart from its siblings' on the same host.
  const ctx: RenderContext = {
    ...renderContext(input, section, level),
    linkSiblings: entries.flatMap((entry) =>
      hostLabelled(
        [
          entry.pdfUrl,
          entry.slidesUrl,
          entry.videoUrl,
          present(entry.title) || [entry.buttonText, entry.urlLabel].some(present)
            ? undefined
            : entry.url,
        ],
        entry.links,
      ),
    ),
  };
  if (allFigures(entries)) {
    // Figures alone are a stats list, laid out by how many there are (C6).
    return (
      <>
        <SectionHeader section={section} ctx={ctx} />
        <dl className="pf-stats pf-evidence" data-count={entries.length}>
          {entries.map((entry) => (
            <Stat
              key={entry.id}
              entry={entry}
              ctx={ctx}
              anchor={recordAnchor(section, entry, input)}
            />
          ))}
        </dl>
      </>
    );
  }
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="pf-list pf-evidence" role="list">
        {entries.map((entry) => (
          <EvidenceEntry
            key={entry.id}
            entry={entry}
            ctx={ctx}
            anchor={recordAnchor(section, entry, input)}
          />
        ))}
      </ul>
    </>
  );
}
