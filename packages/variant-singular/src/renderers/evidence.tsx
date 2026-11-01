import { evidenceOf, type SectionOf, type SectionRendererProps } from '@portfolio/kit/sections';
import type { Evidence } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, listAnd, planOf, plainInline, present, squash } from '../model';
import { NumbersLedger } from '../panels/numbers';
import { References } from '../panels/references';
import { Phrase, Prose, uiLang, urlHref, When, Words } from '../parts';
import { Entries, Entry, Facts } from './entry';

// The evidence kind (brief §5.7): panel 3's ledger and panel 5's voices
// when the plan gives a section a panel; otherwise, in the record, each
// entry by its type, its title or statement on the main track and its
// venue, place and date on the facts track.

const deeper = (level: number) => Math.min(6, level + 1) as 3 | 4 | 5 | 6;

/** One evidence record in the record's entry form, by its type: the home's record and the case page's Notes. */
export function EvidenceItem({
  entry,
  input,
  level,
}: {
  entry: Evidence;
  input: VariantRenderInput;
  level: number;
}) {
  const lang = uiLang(input.portfolio.locale);
  const raw = [
    entry.url,
    entry.links?.[0]?.url,
    entry.videoUrl,
    entry.slidesUrl,
    entry.pdfUrl,
  ].find(present);
  const href = raw ? urlHref(raw, input) : undefined;
  const title = present(entry.title) ? squash(entry.title) : undefined;
  const statement = present(entry.statement) ? entry.statement : undefined;
  const description = present(entry.description) ? entry.description : undefined;
  // Each labelled link, the title's own too, so its words show; and the card's own address under its words.
  const links = [
    ...(entry.links ?? [])
      .filter((link) => present(link.url) && present(link.label))
      .map((link) => ({ url: link.url, text: squash(link.label!) })),
    ...(present(entry.url) && (present(entry.buttonText) || present(entry.urlLabel))
      ? [
          {
            url: entry.url!,
            text: [entry.buttonText, entry.urlLabel].filter(present).map(squash).join(', '),
          },
        ]
      : []),
  ];
  switch (entry.type) {
    case 'testimonial':
      return (
        <Entry
          level={deeper(level)}
          lang={entry.lang}
          meta={
            entry.source ? (
              <Facts
                parts={[
                  <b key="n">{squash(entry.source.name)}</b>,
                  ...[entry.source.role, entry.source.organization].filter(present).map(squash),
                ]}
              />
            ) : undefined
          }
        >
          {statement ? (
            <blockquote className="sg-rec__said">
              <p>
                “<Phrase source={statement} input={input} />”
              </p>
            </blockquote>
          ) : null}
        </Entry>
      );
    case 'metric': {
      const value = entry.metric?.value;
      return (
        <Entry
          level={deeper(level)}
          lang={entry.lang}
          title={
            <>
              {typeof value === 'number' ? (
                <span className="sg-num">{formatNumber(value, input.portfolio.locale)}</span>
              ) : null}
              {typeof value === 'number' && present(entry.metric?.unit)
                ? ` ${squash(entry.metric!.unit!)}`
                : null}{' '}
              {statement ? plainInline(statement) : (title ?? '')}
            </>
          }
          meta={
            description || entry.source ? (
              <Facts
                parts={[
                  description ? plainInline(description) : null,
                  entry.source ? squash(entry.source.name) : null,
                ]}
              />
            ) : undefined
          }
        />
      );
    }
    default: {
      const where = [entry.venue, entry.publication, entry.organization, entry.assignee].find(
        present,
      );
      const when =
        entry.publishedAt ??
        entry.presentedAt ??
        entry.receivedAt ??
        entry.grantedAt ??
        entry.filedAt ??
        entry.asOf;
      const people = entry.authors?.length
        ? listAnd(entry.authors.map(squash))
        : entry.inventors?.length
          ? listAnd(entry.inventors.map(squash))
          : present(entry.author)
            ? squash(entry.author)
            : undefined;
      return (
        <Entry
          level={deeper(level)}
          lang={entry.lang}
          title={title ?? (statement ? plainInline(statement) : undefined)}
          href={href}
          meta={
            <Facts
              parts={[
                where ? squash(where) : null,
                present(entry.location) ? squash(entry.location) : null,
                present(entry.number) ? squash(entry.number) : null,
                entry.status ? (
                  <Words key="s" lang={lang}>
                    {entry.status}
                  </Words>
                ) : null,
                when ? <When key="w" raw={when} input={input} /> : null,
              ]}
            />
          }
        >
          {title && statement && entry.type !== 'press' ? (
            <p className="sg-rec__muted">
              <Phrase source={statement} input={input} />
            </p>
          ) : null}
          {present(entry.abstract) ? (
            <Prose source={entry.abstract} input={input} className="sg-rec__prose" />
          ) : null}
          {present(entry.excerpt) ? (
            <p className="sg-rec__muted">
              “<Phrase source={entry.excerpt} input={input} />”
            </p>
          ) : null}
          {description ? (
            <p className="sg-rec__muted">
              <Phrase source={description} input={input} />
            </p>
          ) : null}
          {people ? <p className="sg-rec__muted">{people}</p> : null}
          {entry.awards?.length ? (
            <p className="sg-rec__muted">{entry.awards.filter(present).map(squash).join(', ')}</p>
          ) : null}
          {present(entry.citation) || present(entry.doi) ? (
            <p className="sg-rec__muted">
              <Facts
                parts={[
                  present(entry.citation) ? squash(entry.citation) : null,
                  present(entry.doi) ? <span key="d">doi:{squash(entry.doi)}</span> : null,
                ]}
              />
            </p>
          ) : null}
          {present(entry.locationLabel) || entry.categories?.some(present) ? (
            <p className="sg-rec__muted">
              <Facts
                parts={[
                  present(entry.locationLabel) ? squash(entry.locationLabel) : null,
                  ...(entry.categories ?? []).filter(present).map(squash),
                ]}
              />
            </p>
          ) : null}
          {entry.highlights?.length ? (
            <ul className="sg-rec__list" role="list">
              {entry.highlights.map((highlight) => (
                <li key={highlight.label}>
                  <b>{squash(highlight.label)}</b> {squash(highlight.sub)}
                </li>
              ))}
            </ul>
          ) : null}
          {links.length > 0 ? (
            <p className="sg-rec__links">
              {links.map((link, i) => (
                <span key={`${i}-${link.url}`}>
                  {i > 0 ? ', ' : null}
                  <a href={urlHref(link.url, input)}>{link.text}</a>
                </span>
              ))}
            </p>
          ) : null}
        </Entry>
      );
    }
  }
}

export function EvidenceRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const panel = planOf(input).panelOf.get(section.id);
  if (panel?.key === 'numbers') return <NumbersLedger input={input} panel={panel} />;
  if (panel?.key === 'refs') return <References input={input} panel={panel} section={section} />;
  return (
    <Entries>
      {evidenceOf(section, input).map((entry) => (
        <EvidenceItem key={entry.id} entry={entry} input={input} level={level} />
      ))}
    </Entries>
  );
}
