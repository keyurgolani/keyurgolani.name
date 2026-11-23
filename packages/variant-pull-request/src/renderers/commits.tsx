import type { ReactNode } from 'react';
import type { ChronologyEntry, Section } from '@portfolio/schema';
import {
  chronologyOf,
  hrefFor,
  MediaFigure,
  PeriodText,
  placedMedia,
  present,
  recordAnchor,
  renderContext,
  RichText,
  worksByIds,
  type RenderContext,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { commitMessage, commitsByYear, hashOf } from '../model';
import { Message, recordHref, reviewOf, uiLangOf, Words, type Review } from '../parts';

// The commits (issue #270, behaviour 2): the record, newest first and
// grouped by the year each starts. Each is a native disclosure: its summary
// is the short hash of its id, the message its kind builds, and its period;
// opening it shows its description, its highlights and achievements, and
// git-style trailers (where, the field, the skills, the works it links as
// files, the organization's page).

export const Commits: SectionRenderer<SectionOf<'chronology'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  const Heading = `h${ctx.itemLevel}` as 'h4';
  return (
    <>
      {commitsByYear(chronologyOf(section, input)).map(({ year, entries }) => (
        <div className="pr-yr" key={year}>
          <Heading className="pr-yr__h">
            <Words lang={lang}>Commits in</Words> {year}
          </Heading>
          <ol className="pr-commits" role="list">
            {entries.map((entry) => (
              <Commit
                key={entry.id}
                entry={entry}
                section={section}
                input={input}
                review={review}
                ctx={ctx}
                lang={lang}
              />
            ))}
          </ol>
        </div>
      ))}
    </>
  );
};

function Trailer({
  name,
  lang,
  children,
}: {
  name: string;
  lang: 'en' | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <Words lang={lang}>{name}</Words>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Commit({
  entry,
  section,
  input,
  review,
  ctx,
  lang,
}: {
  entry: ChronologyEntry;
  section: Section;
  input: VariantRenderInput;
  review: Review;
  ctx: RenderContext;
  lang: 'en' | undefined;
}) {
  const works = worksByIds(entry.works ?? [], input);
  const highlights = (entry.highlights ?? []).filter(present);
  const achievements = (entry.achievements ?? []).filter(present);
  const skills = (entry.skills ?? []).filter(present);
  const logo = entry.logo ? placedMedia(entry.logo, ctx) : undefined;
  return (
    <li className="pr-commit" id={recordAnchor(section, entry, input)} lang={entry.lang}>
      <details className="pr-commit__d">
        <summary className="pr-commit__s">
          <span className="pr-dot" aria-hidden="true" />
          <code className="pr-hash" aria-hidden="true">
            {hashOf(entry.id)}
          </code>
          <span className="pr-commit__m">
            <Message segments={commitMessage(entry)} lang={lang} />
          </span>
          <span className="pr-commit__w">
            <PeriodText period={entry.period} ctx={ctx} />
          </span>
        </summary>
        <div className="pr-commit__b">
          {logo ? <MediaFigure placed={logo} ctx={ctx} className="pr-logo" /> : null}
          {present(entry.description) ? (
            <RichText source={entry.description} input={input} className="pr-prose" />
          ) : null}
          {highlights.length > 0 ? (
            <ul className="pr-list">
              {highlights.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {achievements.length > 0 ? (
            <ul className="pr-list">
              {achievements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          <dl className="pr-trailers">
            {present(entry.organization) && entry.organizationUrl ? (
              <Trailer name="Organization:" lang={lang}>
                <a href={hrefFor(entry.organizationUrl, input)}>{entry.organization}</a>
              </Trailer>
            ) : null}
            {present(entry.field) ? (
              <Trailer name="Field:" lang={lang}>
                {entry.field}
              </Trailer>
            ) : null}
            {present(entry.location) ? (
              <Trailer name="Location:" lang={lang}>
                {entry.location}
              </Trailer>
            ) : null}
            <Trailer name="Period:" lang={lang}>
              <PeriodText period={entry.period} ctx={ctx} />
            </Trailer>
            {skills.length > 0 ? (
              <Trailer name="Skills:" lang={lang}>
                {skills.join(', ')}
              </Trailer>
            ) : null}
            {works.length > 0 ? (
              <Trailer name="Files:" lang={lang}>
                {works.map((work, i) => {
                  const href = recordHref(input, work, review);
                  const file = review.files.find((each) => each.id === work.id);
                  const text = file ? file.path : work.title;
                  return (
                    <span key={work.id}>
                      {i > 0 ? ', ' : null}
                      {href ? (
                        <a href={href}>
                          <code>{text}</code>
                        </a>
                      ) : (
                        <code>{text}</code>
                      )}
                      {file ? <span className="pr-sr"> ({work.title})</span> : null}
                    </span>
                  );
                })}
              </Trailer>
            ) : null}
          </dl>
        </div>
      </details>
    </li>
  );
}
