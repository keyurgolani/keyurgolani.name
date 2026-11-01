import type { Evidence, Section } from '@portfolio/schema';
import { hrefFor, recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { present } from '../model';
import { LinkLine, Out, Phrase, uiLang, When } from '../parts';

// Record rows (brief §5.2; AG-M3): publications, talks, awards, patents,
// press and every other dated record as ruled rows inside the section's
// lite, never free-standing cards: the title (its link, when it has one),
// one line of where and who, the date on the row's end, and the owner's
// statement under it.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

/** The date a record is known by: when it was published, presented, received, granted or filed. */
const dateOf = (entry: Evidence) =>
  entry.publishedAt ??
  entry.presentedAt ??
  entry.receivedAt ??
  entry.grantedAt ??
  entry.filedAt ??
  entry.asOf;

/** Where and who, one line: the venue or publication, the location, the organization, the authors. */
function whereOf(entry: Evidence): string[] {
  const parts = [
    entry.venue,
    entry.publication,
    entry.location,
    entry.organization,
    entry.assignee,
    entry.number,
    entry.author,
  ].filter(present);
  if (entry.authors?.length) parts.push(entry.authors.filter(present).join(', '));
  if (entry.inventors?.length) parts.push(entry.inventors.filter(present).join(', '));
  return [...new Set(parts)];
}

/** The link a record's title takes: its URL, else its PDF or slides, else its first link. */
const linkOf = (entry: Evidence) =>
  entry.url ??
  entry.pdfUrl ??
  entry.slidesUrl ??
  entry.videoUrl ??
  entry.links?.find((link) => present(link.url))?.url;

export function RecordRows({
  entries,
  section,
  input,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <ul className="ag-rows ag-records" role="list">
      {entries.map((entry) => {
        const link = linkOf(entry);
        const href = link ? hrefFor(link, input) : undefined;
        const title = present(entry.title)
          ? entry.title
          : present(entry.citation)
            ? entry.citation
            : undefined;
        const words = entry.statement ?? entry.abstract ?? entry.excerpt ?? entry.description;
        const where = whereOf(entry);
        return (
          <li
            key={entry.id}
            className="ag-row ag-record"
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
          >
            <p className="ag-row__title" data-type-role="title">
              {title ? (
                href ? (
                  <a href={href}>
                    {title}
                    <Out href={href} />
                  </a>
                ) : (
                  title
                )
              ) : present(words) ? (
                <Phrase source={words} input={input} />
              ) : null}
            </p>
            {where.length > 0 ? (
              <p className="ag-row__where" data-type-role="caption">
                {where.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </p>
            ) : null}
            {dateOf(entry) ? (
              <p className="ag-row__date" data-type-role="caption">
                <When raw={dateOf(entry)} lang={lang} />
              </p>
            ) : null}
            {title && present(words) ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={words} input={input} />
              </p>
            ) : null}
            {/* A talk's or a record's description, when the row's words were its statement. */}
            {present(entry.description) && entry.description !== words ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={entry.description} input={input} />
              </p>
            ) : null}
            {present(entry.doi) ? (
              <p className="ag-row__where" data-type-role="caption">
                <a href={hrefFor(`https://doi.org/${entry.doi.trim()}`, input)}>
                  <span lang="en">DOI</span> <span className="ag-num">{entry.doi.trim()}</span>
                  <Out href="https://doi.org/" />
                </a>
              </p>
            ) : null}
            <LinkLine links={entry.links} input={input} />
            {entry.awards?.length ? (
              <p className="ag-row__chips" data-type-role="caption">
                {entry.awards.filter(present).map((award) => (
                  <span key={award} className="ag-chip">
                    {award}
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
