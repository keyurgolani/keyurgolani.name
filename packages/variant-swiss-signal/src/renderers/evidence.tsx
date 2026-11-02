import type { ReactNode } from 'react';
import type { Evidence, Section } from '@portfolio/schema';
import {
  DateText,
  evidenceOf,
  hrefFor,
  recordAnchor,
  renderContext,
  type RenderContext,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { FiguresBand } from '../figures-band';
import { figureOf, figuresBand, formatNumber, present, shortVenue, yearOf } from '../model';
import { Out, Paren, Phrase, Prose, uiLang, When as Day, Words } from '../parts';
import { RuledTable, type Row } from './ruled-table';

// Evidence (brief §5.1, components 8, 11, 12 and 13): the figures band's
// section is the band; testimonials sit in three ruled columns with
// hanging quotation marks; publications are IEEE-style citations with a
// hanging [n] and an Abstract disclosure; press is wide quotes; talks,
// awards, patents and everything else are ruled tables.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

const majority = (entries: readonly Evidence[]) => {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

function When({ raw, ctx }: { raw: string | undefined; ctx: RenderContext }) {
  return raw ? <DateText raw={raw} ctx={ctx} /> : null;
}

/** An entry's links: its own address, then its others, each named by the owner or its host. */
function EntryLinks({
  entry,
  input,
  lang,
}: {
  entry: Evidence;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  const own: { url: string; label: string; ownWords: boolean }[] = [];
  if (entry.slidesUrl) own.push({ url: entry.slidesUrl, label: 'Slides', ownWords: true });
  if (entry.videoUrl) own.push({ url: entry.videoUrl, label: 'Video', ownWords: true });
  if (entry.pdfUrl) own.push({ url: entry.pdfUrl, label: 'PDF', ownWords: true });
  for (const link of entry.links ?? []) {
    own.push({ url: link.url, label: link.label ?? link.platform ?? link.url, ownWords: false });
  }
  if (own.length === 0) return null;
  return (
    <span className="ss-links">
      {own.map((link) => (
        <a key={link.url} href={hrefFor(link.url, input)}>
          {link.ownWords ? <Words lang={lang}>{link.label}</Words> : link.label}
          <Out href={link.url} />
        </a>
      ))}
    </span>
  );
}

/**
 * What an entry holds back for whoever asks: its abstract, and the owner's
 * own citation to copy, each a disclosure that print opens.
 */
function EntryMore({
  entry,
  input,
  lang,
}: {
  entry: Evidence;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  return (
    <>
      {present(entry.abstract) ? (
        <details className="ss-more">
          <summary data-type-role="label">
            <Words lang={lang}>Abstract</Words>
          </summary>
          <Prose source={entry.abstract} input={input} role="body-compact" />
        </details>
      ) : null}
      {present(entry.citation) ? (
        <details className="ss-more">
          <summary data-type-role="label">
            <Words lang={lang}>Cite</Words>
          </summary>
          <p data-type-role="body-compact">{entry.citation}</p>
        </details>
      ) : null}
    </>
  );
}

/** Who a figure or a claim is from: the source's name, linked to it where the owner gave its address. */
function SourceOf({ entry, input }: { entry: Evidence; input: VariantRenderInput }) {
  const source = entry.source;
  if (!source || !present(source.name)) return null;
  return source.url ? (
    <a href={hrefFor(source.url, input)}>
      {source.name}
      <Out href={source.url} />
    </a>
  ) : (
    <>{source.name}</>
  );
}

const titleOf = (entry: Evidence, locale: string) => {
  const figure = figureOf(entry, locale);
  if (figure) return [figure.value, figure.caption].filter(present).join(' ');
  return present(entry.title) ? entry.title : present(entry.statement) ? entry.statement : '';
};

function Title({ entry, input }: { entry: Evidence; input: VariantRenderInput }) {
  const text = titleOf(entry, input.portfolio.locale);
  return (
    <span className="ss-strong" data-type-role="body">
      {entry.url ? (
        <a href={hrefFor(entry.url, input)}>
          {text}
          <Out href={entry.url} />
        </a>
      ) : (
        text
      )}
    </span>
  );
}

/** Testimonials: three ruled columns, the quotation marks hanging in the margin. */
function Testimonials({ section, input }: { section: EvidenceSection; input: VariantRenderInput }) {
  return (
    <ul className="ss-quotes">
      {evidenceOf(section, input).map((entry) => (
        <li key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
          <figure className="ss-quote">
            <blockquote data-type-role="quote">
              <p>
                {'“'}
                <Phrase source={entry.statement ?? ''} input={input} />
                {'”'}
              </p>
            </blockquote>
            {entry.source ? (
              <figcaption data-type-role="body-compact">
                <span className="ss-strong">{entry.source.name}</span>
                {present(entry.source.role) || present(entry.source.organization) ? (
                  <span className="ss-muted">
                    {[entry.source.role, entry.source.organization].filter(present).join(', ')}
                  </span>
                ) : null}
              </figcaption>
            ) : null}
          </figure>
        </li>
      ))}
    </ul>
  );
}

/** Press: wide quotes, the publication and the piece beside each. */
function Press({ section, input }: { section: EvidenceSection; input: VariantRenderInput }) {
  return (
    <ul className="ss-press-list">
      {evidenceOf(section, input).map((entry) => (
        <li key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
          <figure className="ss-press">
            {present(entry.excerpt ?? entry.statement) ? (
              <blockquote data-type-role="quote">
                <p>
                  {'“'}
                  <Phrase source={(entry.excerpt ?? entry.statement)!} input={input} />
                  {'”'}
                </p>
              </blockquote>
            ) : null}
            <figcaption data-type-role="body-compact">
              {present(entry.publication) ? (
                <span className="ss-strong">{entry.publication}</span>
              ) : null}
              <span className="ss-muted">
                {entry.author}
                {entry.author && entry.publishedAt ? ', ' : null}
                <Day raw={entry.publishedAt} lang={uiLang(input.portfolio.locale)} />
              </span>
              {present(entry.title) ? <Title entry={entry} input={input} /> : null}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

/** Publications: IEEE-style citations, a hanging [n], and the abstract in a disclosure. */
function Citations({ section, input }: { section: EvidenceSection; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const ctx = renderContext(input, section, 3);
  return (
    <ol className="ss-cites">
      {evidenceOf(section, input).map((entry, index) => (
        <li
          key={entry.id}
          className="ss-cite"
          id={recordAnchor(section, entry, input)}
          lang={entry.lang}
        >
          <span className="ss-cite__no ss-num" data-type-role="numeric" aria-hidden="true">
            [{formatNumber(index + 1, input.portfolio.locale)}]
          </span>
          <div className="ss-cite__text">
            <p data-type-role="body">
              {entry.authors?.length ? <span>{entry.authors.join(', ')}, </span> : null}
              {'“'}
              <Title entry={entry} input={input} />
              {',” '}
              {present(entry.venue) ? (
                <em className={shortVenue(entry.venue) ? 'ss-cite__venue' : undefined}>
                  {entry.venue}
                </em>
              ) : null}
              {entry.venue && entry.publishedAt ? ', ' : null}
              <When raw={entry.publishedAt} ctx={ctx} />.
              {present(entry.doi) ? (
                <span className="ss-muted ss-num"> doi: {entry.doi}</span>
              ) : null}
            </p>
            {entry.awards?.length ? (
              <p data-type-role="body-compact">
                <Paren>{entry.awards.join(', ')}</Paren>
              </p>
            ) : null}
            <EntryMore entry={entry} input={input} lang={lang} />
            <EntryLinks entry={entry} input={input} lang={lang} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Talks, awards and the rest: one ruled table, the date first, its columns by the entries' type. */
function EvidenceTable({
  section,
  input,
  type,
}: {
  section: EvidenceSection;
  input: VariantRenderInput;
  type: string | undefined;
}) {
  const lang = uiLang(input.portfolio.locale);
  const entries = evidenceOf(section, input);
  const where = (entry: Evidence) =>
    [
      entry.venue,
      entry.location,
      entry.organization,
      entry.publication,
      entry.locationLabel,
      entry.format,
    ]
      .filter(present)
      .join(', ');
  const dateOf = (entry: Evidence) =>
    entry.presentedAt ??
    entry.receivedAt ??
    entry.grantedAt ??
    entry.filedAt ??
    entry.publishedAt ??
    entry.asOf;
  const labels: Record<string, [string, string, string]> = {
    talk: ['Given', 'Talk', 'Where'],
    award: ['Year', 'Award', 'From'],
    metric: ['As of', 'Figure', 'Source'],
  };
  const [first, second, third] = labels[type ?? ''] ?? ['When', 'Name', 'Where'];
  const year = type === 'award';
  const rows: Row[] = entries.map((entry) => {
    const place = where(entry);
    const source =
      entry.type !== 'testimonial' && present(entry.source?.name) ? (
        <SourceOf entry={entry} input={input} />
      ) : null;
    const detail =
      place || source ? (
        <>
          {place}
          {place && source ? ', ' : null}
          {source}
        </>
      ) : null;
    const date = dateOf(entry);
    const description = entry.description ?? (present(entry.title) ? entry.statement : undefined);
    const shown = year ? (
      <span className="ss-num">{yearOf(date)}</span>
    ) : (
      <Day raw={date} lang={lang} />
    );
    return {
      key: entry.id,
      id: recordAnchor(section, entry, input),
      lang: entry.lang,
      narrowAt: 1,
      cells: [
        date ? shown : null,
        <>
          <Title entry={entry} input={input} />
          {present(description) ? (
            <span className="ss-sub">
              <Phrase source={description} input={input} />
            </span>
          ) : null}
          <EntryMore entry={entry} input={input} lang={lang} />
          <EntryLinks entry={entry} input={input} lang={lang} />
        </>,
        detail,
      ],
      narrow:
        detail || date ? (
          <span className="ss-sub">
            {date ? shown : null}
            {detail && date ? ', ' : null}
            {detail}
          </span>
        ) : undefined,
    };
  });
  return (
    <RuledTable
      caption={section.title ?? second}
      lang={lang}
      columns={[
        { label: first, span: 2, wide: true },
        { label: second, span: 7 },
        { label: third, span: 3, wide: true, end: year },
      ]}
      rows={rows}
    />
  );
}

/** Patents and work elsewhere: each a plate of its own, its title beside a ruled fact sheet. */
function FactSheets({ section, input }: { section: EvidenceSection; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const status: Record<string, string> = {
    granted: 'Granted',
    pending: 'Pending',
    expired: 'Expired',
  };
  return (
    <ul className="ss-facts-sheets">
      {evidenceOf(section, input).map((entry) => {
        const facts: [string, ReactNode][] = [];
        if (present(entry.number))
          facts.push([
            'Number',
            <span key="n" className="ss-num">
              {entry.number}
            </span>,
          ]);
        if (entry.status)
          facts.push([
            'Status',
            <Words key="s" lang={lang}>
              {status[entry.status] ?? entry.status}
            </Words>,
          ]);
        if (entry.filedAt) facts.push(['Filed', <Day key="f" raw={entry.filedAt} lang={lang} />]);
        if (entry.grantedAt)
          facts.push(['Granted', <Day key="g" raw={entry.grantedAt} lang={lang} />]);
        if (entry.inventors?.length) facts.push(['Inventors', entry.inventors.join(', ')]);
        if (present(entry.assignee)) facts.push(['Assignee', entry.assignee]);
        for (const highlight of entry.highlights ?? []) {
          facts.push([highlight.label, highlight.sub]);
        }
        const tags = [...(entry.categories ?? []), entry.locationLabel].filter(present);
        return (
          <li
            key={entry.id}
            className="ss-sheet-fact"
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
          >
            <div className="ss-sheet-fact__main">
              <h4 data-type-role="title">
                {entry.url ? (
                  <a href={hrefFor(entry.url, input)}>
                    {titleOf(entry, input.portfolio.locale)}
                    <Out href={entry.url} />
                  </a>
                ) : (
                  titleOf(entry, input.portfolio.locale)
                )}
              </h4>
              {present(entry.description) ? (
                <Prose source={entry.description} input={input} />
              ) : null}
              {tags.length ? (
                <p className="ss-muted" data-type-role="body-compact">
                  {tags.join(', ')}
                </p>
              ) : null}
              <EntryLinks entry={entry} input={input} lang={lang} />
              {/* Its address, in the owner's words for it: "Visit the shop". */}
              {entry.url && present(entry.buttonText) ? (
                <p className="ss-links" data-type-role="body-compact">
                  <a href={hrefFor(entry.url, input)}>
                    {entry.buttonText}
                    <Out href={entry.url} />
                  </a>
                </p>
              ) : null}
            </div>
            {facts.length ? (
              <dl className="ss-dl" data-type-role="body-compact">
                {facts.map(([term, value], index) => (
                  <div key={index}>
                    <dt>
                      {entry.highlights?.some((h) => h.label === term) ? (
                        term
                      ) : (
                        <Words lang={lang}>{term}</Words>
                      )}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceRenderer({ section, input }: SectionRendererProps<EvidenceSection>) {
  if (figuresBand(input)?.section.id === section.id)
    return <FiguresBand section={section} input={input} />;
  const type = majority(evidenceOf(section, input));
  if (type === 'testimonial') return <Testimonials section={section} input={input} />;
  if (type === 'press') return <Press section={section} input={input} />;
  if (type === 'publication') return <Citations section={section} input={input} />;
  if (type === 'patent' || type === 'external-work')
    return <FactSheets section={section} input={input} />;
  return <EvidenceTable section={section} input={input} type={type} />;
}
