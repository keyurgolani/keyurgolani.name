import type { Evidence } from '@portfolio/schema';
import type { ReactNode } from 'react';
import {
  evidenceOf,
  formatFigure,
  formatNames,
  renderContext,
  RichText,
  type RenderContext,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { bibtexOf, evidenceForm, present } from '../model';
import { Link, uiLangOf, When, Words } from '../parts';
import { More, type MorePart } from './more';

// Evidence (brief §5.6), by its majority type: `cat <id>.txt` prints
// metrics as key ........ value lines; `cat <id>.bib` prints publications
// as BibTeX; `mail -f <id>` prints testimonials and press as quoted
// messages; `cat <id>/*` prints patents as key and value blocks; `ls -l`
// prints everything else as a dated table, with external work as symlinks.

type Input = VariantRenderInput;

/** The words an entry is known by: its title, else its statement's. */
function nameOf(entry: Evidence): string | undefined {
  return present(entry.title) ? entry.title : undefined;
}

/**
 * A figure's note, on its line as a `#` comment: what it covers, and who counted it (linked
 * where the source has an address). Nothing when it has neither.
 */
function MetricNote({ entry, input }: { entry: Evidence; input: Input }) {
  const source = present(entry.source?.name) ? entry.source : undefined;
  if (!present(entry.description) && !source) return null;
  return (
    <span className="sh-faint">
      {' # '}
      {present(entry.description) ? (
        <RichText source={entry.description} inline input={input} />
      ) : null}
      {source ? (
        <>
          {present(entry.description) ? ', ' : ''}
          {source.url ? (
            <Link url={source.url} input={input}>
              {source.name}
            </Link>
          ) : (
            source.name
          )}
        </>
      ) : null}
    </span>
  );
}

/**
 * What a record cited on its own is called, where it stands with no listing round it (the
 * case page, cat): its title, else what a metric counts, else who it's from as Mail names them
 * (the source, the author, the publication), else where it ran or who gave it.
 */
export function recordNameOf(entry: Evidence): string | undefined {
  return [
    entry.title,
    entry.type === 'metric' ? entry.metric?.key : undefined,
    entry.source?.name,
    entry.author,
    entry.publication,
    entry.venue,
    entry.organization,
  ].find(present);
}

/** A record's own links, as the dated table lists them: its address, its slides, its video. */
export function recordLinksOf(entry: Evidence): { url: string; text: string }[] {
  return [
    entry.url && entry.type !== 'external-work' ? { url: entry.url, text: 'Open' } : undefined,
    entry.slidesUrl ? { url: entry.slidesUrl, text: 'Slides' } : undefined,
    entry.videoUrl ? { url: entry.videoUrl, text: 'Video' } : undefined,
  ].filter((link): link is { url: string; text: string } => link !== undefined);
}

/** A DOI as written, less a `doi:` or resolver prefix, and its doi.org address (the kit's form). */
function doiOf(raw: string): { url: string; text: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!text) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/**
 * Every link a cited record has, each target once: the table's (less its address when the
 * name already links it), then its PDF, its DOI and the links the owner gave it. `words` is
 * whether the text is the composition's own word, which takes the interface language.
 */
export function citedLinksOf(
  entry: Evidence,
  { named = false }: { named?: boolean } = {},
): { url: string; text: string; words: boolean }[] {
  const doi = entry.doi !== undefined ? doiOf(entry.doi) : undefined;
  const all = [
    ...recordLinksOf(entry)
      .filter((link) => !(named && link.url === entry.url))
      .map((link) => ({ ...link, words: true })),
    ...(entry.pdfUrl ? [{ url: entry.pdfUrl, text: 'PDF', words: true }] : []),
    ...(doi ? [{ ...doi, words: false }] : []),
    ...(entry.links ?? [])
      .filter((link) => !(named && link.url === entry.url))
      .map((link) => ({
        url: link.url,
        text: link.label ?? link.platform ?? link.url,
        words: false,
      })),
  ];
  return all.filter((link, i) => all.findIndex((each) => each.url === link.url) === i);
}

/** A cited record's links as a list, `ls`'s: nothing when it has none. */
export function CitedLinks({
  entry,
  input,
  named,
}: {
  entry: Evidence;
  input: Input;
  named?: boolean;
}) {
  const links = citedLinksOf(entry, { named });
  if (links.length === 0) return null;
  const uiLang = uiLangOf(input);
  return (
    <ul className="sh-kv__list">
      {links.map((link) => (
        <li key={link.url}>
          <Link url={link.url} input={input}>
            {link.words ? <Words lang={uiLang}>{link.text}</Words> : link.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A cited record's type, in the composition's words: what leads its line, or names it. */
export const RECORD_WORDS: Readonly<Record<string, string>> = {
  award: 'award',
  press: 'written up in',
  publication: 'published in',
  metric: 'figure',
  testimonial: 'in their words',
  talk: 'talk',
  patent: 'patent',
  exhibition: 'shown at',
  client: 'client',
  recording: 'recording',
  repository: 'repository',
  'external-work': 'elsewhere',
};

/** A talk's format and a patent's status, in words, never the schema's value. */
const TALK_FORMATS: Readonly<Record<string, string>> = {
  keynote: 'keynote',
  workshop: 'workshop',
  panel: 'panel',
  lightning: 'lightning talk',
  session: 'session',
  interview: 'interview',
};
const PATENT_STATUSES: Readonly<Record<string, string>> = {
  granted: 'granted',
  pending: 'pending',
  expired: 'expired',
};

/** The date a record is from. */
export const dateOfRecord = (record: Evidence) =>
  record.publishedAt ??
  record.presentedAt ??
  record.receivedAt ??
  record.grantedAt ??
  record.filedAt ??
  record.asOf;

/** What a cited record is called: its own name, else the composition's word for its type. */
export function RecordName({ record, ctx }: { record: Evidence; ctx: RenderContext }) {
  const name = recordNameOf(record);
  return name !== undefined ? (
    <>{name}</>
  ) : (
    <Words lang={ctx.uiLang}>{RECORD_WORDS[record.type] ?? record.type}</Words>
  );
}

/**
 * A cited record's name, linked to its address (or its source's, when the source names it), or
 * to `href` when that's given (its place on home).
 */
export function RecordTerm({
  record,
  ctx,
  href,
}: {
  record: Evidence;
  ctx: RenderContext;
  href?: string;
}) {
  const name = <RecordName record={record} ctx={ctx} />;
  if (href !== undefined) return <a href={href}>{name}</a>;
  // Named by its source, it links where the source does when it has no address of its own.
  const url =
    record.url ??
    (record.source?.url && recordNameOf(record) === record.source.name
      ? record.source.url
      : undefined);
  return url ? (
    <Link url={url} input={ctx.input}>
      {name}
    </Link>
  ) : (
    <b>{name}</b>
  );
}

/**
 * What a cited record says of itself past its name, each part once and never the name again:
 * where it ran, who it's from (the source linked to its address), its people, what it is, and
 * where it was.
 */
export function metaOf(record: Evidence, ctx: RenderContext): { text: string; node: ReactNode }[] {
  const name = recordNameOf(record);
  const words = (text: string) => <Words lang={ctx.uiLang}>{text}</Words>;
  const source = record.source;
  const parts: { text: string | undefined; node?: ReactNode }[] = [
    { text: record.venue ?? record.publication },
    {
      text: source?.name,
      node:
        source?.url && present(source.name) ? (
          <Link url={source.url} input={ctx.input}>
            {source.name}
          </Link>
        ) : undefined,
    },
    { text: source?.role },
    { text: source?.organization },
    { text: record.author },
    { text: record.authors?.length ? formatNames(record.authors, ctx) : undefined },
    { text: record.inventors?.length ? formatNames(record.inventors, ctx) : undefined },
    { text: record.assignee },
    { text: record.type === 'award' ? undefined : record.organization },
    {
      text: record.format,
      node: record.format ? words(TALK_FORMATS[record.format] ?? record.format) : undefined,
    },
    { text: record.location },
    { text: record.number },
    {
      text: record.status,
      node: record.status ? words(PATENT_STATUSES[record.status] ?? record.status) : undefined,
    },
  ];
  const seen = new Set<string>();
  return parts.flatMap(({ text, node }) => {
    if (!present(text) || text === name || seen.has(text)) return [];
    seen.add(text);
    return [{ text, node: node ?? text }];
  });
}

/**
 * A record cited on its own, where no listing holds it (the case page's SEE ALSO, `cat <id>`):
 * its name as the term, then its type's word and what it says of itself, its date, its figure,
 * its words, its description and every link it has. `id` is its anchor, when it has one here.
 */
export function CitedRecord({
  record,
  ctx,
  id,
}: {
  record: Evidence;
  ctx: RenderContext;
  id?: string;
}) {
  const { input } = ctx;
  const date = dateOfRecord(record);
  const words = RECORD_WORDS[record.type];
  const name = recordNameOf(record);
  const quote = record.excerpt ?? record.statement;
  const metric = record.type === 'metric' ? record.metric : undefined;
  // The type's word leads the line, unless the name is already that word.
  const lead = words !== undefined && name !== undefined;
  return (
    <div id={id} lang={record.lang}>
      <dt>
        <RecordTerm record={record} ctx={ctx} />
      </dt>
      <dd>
        <span className="sh-faint">
          {lead ? <Words lang={ctx.uiLang}>{words}</Words> : null}
          {metaOf(record, ctx).map((part, i) => (
            <span key={part.text}>
              {i > 0 ? ', ' : lead ? ' ' : ''}
              {part.node}
            </span>
          ))}
          {date !== undefined ? (
            <>
              {', '}
              <When raw={date} />
            </>
          ) : null}
        </span>
        {metric && (metric.value !== undefined || present(metric.key)) ? (
          <span className="sh-fig">
            {present(metric.key) && metric.key !== name ? ` ${metric.key}` : ''}
            {metric.value !== undefined ? ` ${formatFigure(metric.value, ctx)}` : ''}
            {metric.value !== undefined && present(metric.unit) ? ` ${metric.unit}` : ''}
          </span>
        ) : null}
        {present(quote) ? (
          <RichText source={quote} input={input} className="sh-prose sh-dim" />
        ) : null}
        {present(record.description) ? (
          <RichText source={record.description} input={input} className="sh-prose sh-dim" />
        ) : null}
        <CitedLinks entry={record} input={input} named />
      </dd>
    </div>
  );
}

function Metrics({ entries, input }: { entries: readonly Evidence[]; input: Input }) {
  const ctx = renderContext(input, { id: 'metrics', lang: undefined, title: undefined }, 2);
  return (
    <dl className="sh-lead">
      {entries.map((entry) => {
        const metric = entry.metric;
        const figure =
          metric?.value !== undefined
            ? [formatFigure(metric.value, ctx), metric.unit].filter(Boolean).join(' ')
            : undefined;
        return (
          <div key={entry.id} lang={entry.lang}>
            <dt>{metric?.key ?? nameOf(entry) ?? entry.id}</dt>
            <dd className="sh-lead__v">{figure ?? ''}</dd>
            <dd className="sh-lead__s">
              {entry.statement ? (
                <RichText source={entry.statement} inline input={input} />
              ) : (
                nameOf(entry)
              )}
              <MetricNote entry={entry} input={input} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Bibtex({ entries, input }: { entries: readonly Evidence[]; input: Input }) {
  return (
    <>
      {entries.map((entry) => {
        const bib = bibtexOf(entry);
        return (
          <article className="sh-bib" key={entry.id} lang={entry.lang}>
            {bib.comment ? <p className="sh-faint">% {bib.comment}</p> : null}
            <p>
              <span className="sh-bib__at">@{bib.type}</span>
              {'{'}
              <span className="sh-bib__key">{bib.key}</span>,
            </p>
            <dl>
              {bib.fields.map(({ name, value }) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <span className="sh-faint" aria-hidden="true">
                      = {'{'}
                    </span>
                    {name === 'title' && entry.url ? (
                      <cite>
                        <Link url={entry.url} input={input}>
                          {value}
                        </Link>
                      </cite>
                    ) : name === 'title' ? (
                      <cite>{value}</cite>
                    ) : name === 'abstract' && present(entry.abstract) ? (
                      <RichText source={entry.abstract} inline input={input} />
                    ) : name === 'url' ? (
                      <Link url={value} input={input}>
                        {value}
                      </Link>
                    ) : (
                      value
                    )}
                    <span className="sh-faint" aria-hidden="true">
                      {'},'}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p aria-hidden="true">{'}'}</p>
          </article>
        );
      })}
    </>
  );
}

function Mail({ entries, input }: { entries: readonly Evidence[]; input: Input }) {
  const uiLang = uiLangOf(input);
  return (
    <div className="sh-mails">
      {entries.map((entry) => {
        const from = entry.source?.name ?? entry.author ?? entry.publication;
        const role = [entry.source?.role, entry.source?.organization ?? entry.publication]
          .filter(Boolean)
          .join(', ');
        const words = entry.statement ?? entry.excerpt;
        return (
          <figure className="sh-mail" key={entry.id} lang={entry.lang}>
            <figcaption className="sh-mail__hdr">
              {from ? (
                <span>
                  <span className="sh-mail__k">
                    <Words lang={uiLang}>From:</Words>
                  </span>{' '}
                  <b>{from}</b>
                  {role && role !== from ? `, ${role}` : ''}
                  {entry.publishedAt ? (
                    <>
                      , <When raw={entry.publishedAt} />
                    </>
                  ) : null}
                </span>
              ) : null}
              {entry.title ? (
                <span>
                  <span className="sh-mail__k">
                    <Words lang={uiLang}>Subject:</Words>
                  </span>{' '}
                  {entry.url ? (
                    <Link url={entry.url} input={input}>
                      {entry.title}
                    </Link>
                  ) : (
                    entry.title
                  )}
                </span>
              ) : null}
            </figcaption>
            {words ? (
              <blockquote className="sh-mail__q">
                <RichText source={words} input={input} />
              </blockquote>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}

function Patents({ entries, input }: { entries: readonly Evidence[]; input: Input }) {
  const uiLang = uiLangOf(input);
  const row = (key: string, value: React.ReactNode) =>
    value ? (
      <div key={key}>
        <dt>
          <Words lang={uiLang}>{key}</Words>
        </dt>
        <dd>{value}</dd>
      </div>
    ) : null;
  return (
    <>
      {entries.map((entry) => (
        <div className="sh-patent" key={entry.id} lang={entry.lang}>
          <p>
            <b>{entry.number ?? entry.title}</b>
            {entry.status ? <span className="sh-fig"> {entry.status}</span> : null}
          </p>
          <dl className="sh-kv">
            {row(
              'title',
              entry.title ? (
                entry.url ? (
                  <Link url={entry.url} input={input}>
                    {entry.title}
                  </Link>
                ) : (
                  entry.title
                )
              ) : null,
            )}
            {row('filed', entry.filedAt ? <When raw={entry.filedAt} /> : null)}
            {row('granted', entry.grantedAt ? <When raw={entry.grantedAt} /> : null)}
            {row('inventors', entry.inventors?.join(', '))}
            {row('assignee', entry.assignee)}
            {row(
              'description',
              present(entry.description) ? (
                <RichText source={entry.description} inline input={input} />
              ) : null,
            )}
          </dl>
        </div>
      ))}
    </>
  );
}

/**
 * Where an entry ran or stands, as the table's dim line: its venue (or who gave it, or where it
 * was published), its place in the owner's words, and its categories, each once.
 */
function placeOf(entry: Evidence): string[] {
  const parts = [
    entry.venue ?? entry.organization ?? entry.publication,
    entry.location,
    entry.locationLabel,
    ...(entry.categories ?? []),
  ].filter(present);
  return parts.filter((part, i) => parts.indexOf(part) === i);
}

/**
 * The links an entry carries in the owner's words, after the table's own: those the owner
 * listed, then an external work's call to visit, on its address, each address once.
 */
function ownLinksOf(entry: Evidence): { url: string; text: string }[] {
  const all = [
    ...(entry.links ?? []).map((link) => ({
      url: link.url,
      text: link.label ?? link.platform ?? link.url,
    })),
    ...(entry.url && present(entry.buttonText) ? [{ url: entry.url, text: entry.buttonText }] : []),
  ];
  return all.filter((link, i) => all.findIndex((each) => each.url === link.url) === i);
}

/**
 * What a table entry says past its line, as its fold's parts (each a `cat` body): its words
 * when its title already names it, and its abstract.
 */
function recordParts(entry: Evidence, input: Input): MorePart[] {
  const parts: MorePart[] = [];
  if (nameOf(entry) !== undefined && present(entry.statement)) {
    parts.push({
      key: 'statement',
      label: 'statement',
      body: <RichText source={entry.statement} input={input} className="sh-prose" />,
    });
  }
  if (present(entry.abstract)) {
    parts.push({
      key: 'abstract',
      label: 'abstract',
      body: <RichText source={entry.abstract} input={input} className="sh-prose" />,
    });
  }
  return parts;
}

/** When an entry happened, by its type's own date. */
const dateOf = (entry: Evidence) =>
  entry.presentedAt ?? entry.receivedAt ?? entry.publishedAt ?? entry.grantedAt ?? entry.asOf;

function Table({ entries, input }: { entries: readonly Evidence[]; input: Input }) {
  const uiLang = uiLangOf(input);
  const links = recordLinksOf;
  return (
    <>
      <p className="sh-total" lang={uiLang}>
        total {entries.length}
      </p>
      <table className="sh-tab">
        <thead>
          <tr lang={uiLang}>
            <th>Date</th>
            <th>Type</th>
            <th>Entry</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} lang={entry.lang}>
              <td className="sh-tab__d">
                <When raw={dateOf(entry)} />
              </td>
              <td className="sh-tab__k">{entry.format ?? entry.type}</td>
              <td className="sh-tab__wide">
                {entry.type === 'external-work' && entry.url ? (
                  <>
                    <span className="sh-tab__ttl sh-dir">{entry.title ?? entry.urlLabel}</span>
                    <span className="sh-faint" aria-hidden="true">
                      {' -> '}
                    </span>
                    <Link url={entry.url} input={input}>
                      {entry.urlLabel ?? entry.url}
                    </Link>
                  </>
                ) : (
                  <span className="sh-tab__ttl">
                    {nameOf(entry) ??
                      (entry.statement ? (
                        <RichText source={entry.statement} inline input={input} />
                      ) : null)}
                  </span>
                )}{' '}
                <span className="sh-dim">{placeOf(entry).join(', ')}</span>
                {entry.highlights?.length ? (
                  <ul className="sh-figs">
                    {entry.highlights.map((highlight, i) => (
                      <li key={i}>
                        {highlight.label} <span className="sh-figs__sub">{highlight.sub}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {entry.description ? (
                  <span className="sh-tab__desc">
                    <RichText source={entry.description} inline input={input} />
                  </span>
                ) : null}
                {links(entry).length > 0 || ownLinksOf(entry).length > 0 ? (
                  <span className="sh-tab__links">
                    {links(entry).map((link) => (
                      <Link key={link.url} url={link.url} input={input}>
                        <Words lang={uiLang}>{link.text}</Words>
                      </Link>
                    ))}
                    {ownLinksOf(entry).map((link) => (
                      <Link key={`own-${link.url}`} url={link.url} input={input}>
                        {link.text}
                      </Link>
                    ))}
                  </span>
                ) : null}
                <More
                  parts={recordParts(entry, input)}
                  uiLang={uiLang}
                  of={nameOf(entry) ?? entry.venue ?? entry.publication}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export const Record: SectionRenderer<SectionOf<'evidence'>> = ({ section, input }) => {
  const entries = evidenceOf(section, input);
  switch (evidenceForm(entries)) {
    case 'kv':
      return <Metrics entries={entries} input={input} />;
    case 'bibtex':
      return <Bibtex entries={entries} input={input} />;
    case 'mail':
      return <Mail entries={entries} input={input} />;
    case 'patents':
      return <Patents entries={entries} input={input} />;
    default:
      return <Table entries={entries} input={input} />;
  }
};
