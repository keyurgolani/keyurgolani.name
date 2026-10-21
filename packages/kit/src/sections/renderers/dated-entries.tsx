import type {
  Awards,
  Education,
  Episodes,
  Experience,
  Patents,
  Projects,
  Publications,
  Talks,
  Writings,
} from '@portfolio/schema';
import { formatEpisodeDuration } from '../../format';
import {
  ContentImage,
  DateText,
  formatNames,
  ItemTitle,
  LabeledDate,
  LinkList,
  MaybeLink,
  Meta,
  NamedLinks,
  PeriodText,
  present,
  renderContext,
  SectionHeader,
  TagList,
  Ui,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

// Sections of dated entries: one list item per entry, each with a heading one
// level below the section's.

const TALK_TYPES = {
  keynote: 'Keynote',
  workshop: 'Workshop',
  panel: 'Panel',
  lightning: 'Lightning talk',
  session: 'Session',
  interview: 'Interview',
} as const;

const PATENT_STATUSES = { granted: 'Granted', pending: 'Pending', expired: 'Expired' } as const;

/**
 * A DOI as written, without a `doi:` or resolver prefix, and the doi.org link
 * to it, each `/`-separated part encoded, so a `#` or `?` in the DOI stays in
 * its path. Nothing to link once the prefix is gone.
 */
export function doiLink(raw: string): { text: string; url: string } | undefined {
  const text = raw.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
  if (!present(text)) return undefined;
  return { text, url: `https://doi.org/${text.split('/').map(encodeURIComponent).join('/')}` };
}

/** Labeled facts, such as a patent's inventors. Absent ones are left out. */
function Facts({
  facts,
  ctx,
}: {
  facts: ReadonlyArray<readonly [label: string, value: string | undefined]>;
  ctx: RenderContext;
}) {
  const shown = facts.filter((fact): fact is readonly [string, string] => present(fact[1]));
  if (shown.length === 0) return null;
  return (
    <dl className="pf-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>
            <Ui ctx={ctx}>{label}</Ui>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExperienceSection({ section, input, level }: SectionRendererProps<Experience>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Experience" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.logo ? (
              // The organization's name beside it says whose logo it is.
              <ContentImage image={item.logo} ctx={ctx} className="pf-logo" inline decorative />
            ) : null}
            <ItemTitle text={item.role} ctx={ctx} />
            <Meta
              parts={[
                <MaybeLink key="organization" url={item.organizationUrl} ctx={ctx}>
                  {item.organization}
                </MaybeLink>,
                item.location,
                <PeriodText key="period" period={item.period} ctx={ctx} />,
              ]}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            <TagList items={item.highlights} className="pf-highlights" />
            <TagList items={item.skills} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function EducationSection({ section, input, level }: SectionRendererProps<Education>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Education" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.logo ? (
              // The institution's name beside it says whose logo it is.
              <ContentImage image={item.logo} ctx={ctx} className="pf-logo" inline decorative />
            ) : null}
            <ItemTitle text={item.degree} ctx={ctx} />
            <Meta
              parts={[
                item.field,
                <MaybeLink key="institution" url={item.institutionUrl} ctx={ctx}>
                  {item.institution}
                </MaybeLink>,
                item.location,
                <PeriodText key="period" period={item.period} ctx={ctx} />,
              ]}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            <TagList items={item.achievements} className="pf-highlights" />
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProjectsSection({ section, input, level }: SectionRendererProps<Projects>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Projects" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.image ? (
              // The project's name beside it says what the cover is of.
              <ContentImage image={item.image} ctx={ctx} className="pf-cover" decorative />
            ) : null}
            <ItemTitle text={item.name} ctx={ctx} />
            <Meta
              parts={[
                item.role,
                item.organization,
                item.period && <PeriodText key="period" period={item.period} ctx={ctx} />,
              ]}
            />
            {present(item.summary) ? (
              <RichText source={item.summary} className="pf-summary" input={input} />
            ) : null}
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            <TagList items={item.highlights} className="pf-highlights" />
            <TagList items={item.technologies} />
            {item.images?.length ? (
              <ul className="pf-gallery" role="list">
                {item.images.map((image, imageIndex) => (
                  <li key={imageIndex}>
                    {/* Nothing beside a screenshot says what it shows, so without alt text it has none. */}
                    <ContentImage image={image} ctx={ctx} />
                  </li>
                ))}
              </ul>
            ) : null}
            <LinkList links={item.links} ctx={ctx} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function WritingsSection({ section, input, level }: SectionRendererProps<Writings>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Writing" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <ItemTitle text={item.title} url={item.url} ctx={ctx} />
            <Meta
              parts={[
                item.publication,
                item.publishedAt !== undefined && (
                  <DateText key="published" raw={item.publishedAt} ctx={ctx} />
                ),
                item.readingTimeMinutes !== undefined && (
                  <span key="reading-time">
                    {item.readingTimeMinutes} <Ui ctx={ctx}>min read</Ui>
                  </span>
                ),
              ]}
            />
            {present(item.summary) ? (
              <RichText source={item.summary} className="pf-summary" input={input} />
            ) : null}
            {present(item.excerpt) ? (
              <blockquote className="pf-excerpt">
                <p>{item.excerpt}</p>
              </blockquote>
            ) : null}
            <TagList items={item.tags} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function PublicationsSection({ section, input, level }: SectionRendererProps<Publications>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Publications" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => {
          const doi = item.doi !== undefined ? doiLink(item.doi) : undefined;
          return (
            <li key={index} className="pf-item">
              <ItemTitle text={item.title} url={item.url} ctx={ctx} />
              {item.authors?.some(present) ? (
                <p className="pf-authors">{formatNames(item.authors, ctx)}</p>
              ) : null}
              <Meta
                parts={[
                  item.venue,
                  item.publishedAt !== undefined && (
                    <DateText key="published" raw={item.publishedAt} ctx={ctx} />
                  ),
                ]}
              />
              {present(item.abstract) ? (
                <RichText source={item.abstract} className="pf-abstract" input={input} />
              ) : null}
              {present(item.citation) ? <p className="pf-citation">{item.citation}</p> : null}
              <TagList items={item.awards} className="pf-highlights" />
              <NamedLinks
                links={[
                  ['DOI', doi?.url, doi?.text],
                  ['PDF', item.pdfUrl],
                ]}
                ctx={ctx}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function TalksSection({ section, input, level }: SectionRendererProps<Talks>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Talks" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item" data-talk-type={item.type}>
            <ItemTitle text={item.title} ctx={ctx} />
            <Meta
              parts={[
                item.type !== undefined && (
                  <Ui key="type" ctx={ctx}>
                    {TALK_TYPES[item.type]}
                  </Ui>
                ),
                item.venue,
                item.location,
                item.presentedAt !== undefined && (
                  <DateText key="presented" raw={item.presentedAt} ctx={ctx} />
                ),
              ]}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            {present(item.abstract) ? (
              <RichText source={item.abstract} className="pf-abstract" input={input} />
            ) : null}
            <NamedLinks
              links={[
                ['Slides', item.slidesUrl],
                ['Video', item.videoUrl],
              ]}
              ctx={ctx}
            />
            <LinkList links={item.links} ctx={ctx} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function AwardsSection({ section, input, level }: SectionRendererProps<Awards>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Awards" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <ItemTitle text={item.name} url={item.url} ctx={ctx} />
            <Meta
              parts={[
                item.organization,
                item.receivedAt !== undefined && (
                  <DateText key="received" raw={item.receivedAt} ctx={ctx} />
                ),
              ]}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Episodes take the show's name as their heading when the section has no title. */
export function EpisodesSection({ section, input, level }: SectionRendererProps<Episodes>) {
  const ctx = renderContext(input, section, level);
  const showNameIsHeading = !present(section.title) && present(section.showName);
  return (
    <>
      <SectionHeader
        section={showNameIsHeading ? { ...section, title: section.showName } : section}
        ctx={ctx}
        fallback="Episodes"
      />
      {present(section.showName) && !showNameIsHeading ? (
        <p className="pf-show-name">{section.showName}</p>
      ) : null}
      {present(section.showDescription) ? (
        <RichText source={section.showDescription} className="pf-summary" input={input} />
      ) : null}
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <ItemTitle
              text={item.title}
              ctx={ctx}
              before={
                item.number !== undefined ? (
                  <span className="pf-episode-number">#{item.number} </span>
                ) : null
              }
            />
            <Meta
              parts={[
                item.publishedAt !== undefined && (
                  <DateText key="published" raw={item.publishedAt} ctx={ctx} />
                ),
                item.durationMinutes !== undefined && (
                  <Ui key="duration" ctx={ctx}>
                    {formatEpisodeDuration(item.durationMinutes)}
                  </Ui>
                ),
                item.guests?.some(present) ? (
                  <span key="guests">
                    <Ui ctx={ctx}>With</Ui> {formatNames(item.guests, ctx)}
                  </span>
                ) : null,
              ]}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
            {present(item.showNotes) ? (
              <RichText source={item.showNotes} className="pf-show-notes" input={input} />
            ) : null}
            <NamedLinks
              links={[
                ['Listen', item.audioUrl],
                ['Watch', item.videoUrl],
              ]}
              ctx={ctx}
            />
            <LinkList links={item.links} ctx={ctx} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function PatentsSection({ section, input, level }: SectionRendererProps<Patents>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Patents" />
      <ul className="pf-list" role="list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item" data-patent-status={item.status}>
            <ItemTitle text={item.title} url={item.url} ctx={ctx} />
            <Meta
              parts={[
                item.number,
                item.status !== undefined && (
                  <Ui key="status" ctx={ctx}>
                    {PATENT_STATUSES[item.status]}
                  </Ui>
                ),
                item.filedAt !== undefined && (
                  <LabeledDate key="filed" label="Filed" raw={item.filedAt} ctx={ctx} />
                ),
                item.grantedAt !== undefined && (
                  <LabeledDate key="granted" label="Granted" raw={item.grantedAt} ctx={ctx} />
                ),
              ]}
            />
            <Facts
              facts={[
                [
                  'Inventors',
                  item.inventors?.some(present) ? formatNames(item.inventors, ctx) : undefined,
                ],
                ['Assignee', item.assignee],
              ]}
              ctx={ctx}
            />
            {present(item.description) ? (
              <RichText source={item.description} input={input} />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
