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
  deeper,
  formatNames,
  Heading,
  LabeledDate,
  LinkList,
  MaybeLink,
  Meta,
  NamedLinks,
  PeriodText,
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

/** Labeled facts, such as a patent's inventors. Absent ones are left out. */
function Facts({
  facts,
  ctx,
}: {
  facts: ReadonlyArray<readonly [label: string, value: string | undefined]>;
  ctx: RenderContext;
}) {
  const shown = facts.filter((fact): fact is readonly [string, string] => fact[1] !== undefined);
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.logo ? <ContentImage image={item.logo} className="pf-logo" inline /> : null}
            <Heading level={deeper(level)} className="pf-item__title">
              {item.role}
            </Heading>
            <Meta
              parts={[
                <MaybeLink key="organization" url={item.organizationUrl} ctx={ctx}>
                  {item.organization}
                </MaybeLink>,
                item.location,
                <PeriodText key="period" period={item.period} ctx={ctx} />,
              ]}
            />
            {item.description !== undefined ? <RichText source={item.description} /> : null}
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.logo ? <ContentImage image={item.logo} className="pf-logo" inline /> : null}
            <Heading level={deeper(level)} className="pf-item__title">
              {item.degree}
            </Heading>
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
            {item.description !== undefined ? <RichText source={item.description} /> : null}
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            {item.image ? <ContentImage image={item.image} className="pf-cover" /> : null}
            <Heading level={deeper(level)} className="pf-item__title">
              {item.name}
            </Heading>
            <Meta
              parts={[
                item.role,
                item.organization,
                item.period && <PeriodText key="period" period={item.period} ctx={ctx} />,
              ]}
            />
            {item.summary !== undefined ? (
              <RichText source={item.summary} className="pf-summary" />
            ) : null}
            {item.description !== undefined ? <RichText source={item.description} /> : null}
            <TagList items={item.highlights} className="pf-highlights" />
            <TagList items={item.technologies} />
            {item.images?.length ? (
              <ul className="pf-gallery">
                {item.images.map((image, imageIndex) => (
                  <li key={imageIndex}>
                    <ContentImage image={image} />
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.title}
              </MaybeLink>
            </Heading>
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
            {item.summary !== undefined ? (
              <RichText source={item.summary} className="pf-summary" />
            ) : null}
            {item.excerpt !== undefined ? (
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.title}
              </MaybeLink>
            </Heading>
            {item.authors?.length ? (
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
            {item.abstract !== undefined ? (
              <RichText source={item.abstract} className="pf-abstract" />
            ) : null}
            {item.citation !== undefined ? <p className="pf-citation">{item.citation}</p> : null}
            <TagList items={item.awards} className="pf-highlights" />
            <NamedLinks
              links={[
                [
                  'DOI',
                  item.doi !== undefined ? `https://doi.org/${encodeURI(item.doi)}` : undefined,
                  item.doi,
                ],
                ['PDF', item.pdfUrl],
              ]}
              ctx={ctx}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

export function TalksSection({ section, input, level }: SectionRendererProps<Talks>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Talks" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item" data-talk-type={item.type}>
            <Heading level={deeper(level)} className="pf-item__title">
              {item.title}
            </Heading>
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
            {item.description !== undefined ? <RichText source={item.description} /> : null}
            {item.abstract !== undefined ? (
              <RichText source={item.abstract} className="pf-abstract" />
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.name}
              </MaybeLink>
            </Heading>
            <Meta
              parts={[
                item.organization,
                item.receivedAt !== undefined && (
                  <DateText key="received" raw={item.receivedAt} ctx={ctx} />
                ),
              ]}
            />
            {item.description !== undefined ? <RichText source={item.description} /> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Episodes take the show's name as their heading when the section has no title. */
export function EpisodesSection({ section, input, level }: SectionRendererProps<Episodes>) {
  const ctx = renderContext(input, section, level);
  const showNameIsHeading = section.title === undefined && section.showName !== undefined;
  return (
    <>
      <SectionHeader
        section={showNameIsHeading ? { ...section, title: section.showName } : section}
        ctx={ctx}
        fallback="Episodes"
      />
      {section.showName !== undefined && !showNameIsHeading ? (
        <p className="pf-show-name">{section.showName}</p>
      ) : null}
      {section.showDescription !== undefined ? (
        <RichText source={section.showDescription} className="pf-summary" />
      ) : null}
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              {item.number !== undefined ? (
                <span className="pf-episode-number">#{item.number} </span>
              ) : null}
              {item.title}
            </Heading>
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
                item.guests?.length ? (
                  <span key="guests">
                    <Ui ctx={ctx}>With</Ui> {formatNames(item.guests, ctx)}
                  </span>
                ) : null,
              ]}
            />
            {item.description !== undefined ? <RichText source={item.description} /> : null}
            {item.showNotes !== undefined ? (
              <RichText source={item.showNotes} className="pf-show-notes" />
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
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item" data-patent-status={item.status}>
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.title}
              </MaybeLink>
            </Heading>
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
                  item.inventors?.length ? formatNames(item.inventors, ctx) : undefined,
                ],
                ['Assignee', item.assignee],
              ]}
              ctx={ctx}
            />
            {item.description !== undefined ? <RichText source={item.description} /> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
