import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import {
  EvidenceEntry,
  evidenceByIds,
  hrefFor,
  LinkText,
  MediaFigure,
  RichText,
  type PlacedImage,
  type RenderContext,
} from '@portfolio/kit/sections';
import { present } from './model';
import { Words } from './parts';

// The rest of a chapter's case (#15), what Unfold the case opens: the
// work's own words, its case study's fields under their fixed labels, the
// rest of its media in the order the owner placed it, the evidence it
// cites, and its links. Everything here is server markup inside a native
// details element, so it opens with no script, from the keyboard, and in
// every browser, and a find in the page finds what it holds. A field the
// owner didn't write has no heading at all.

type Level = 3 | 4 | 5 | 6;

/** The case study's fields shown before its decisions, by their fixed labels. */
const BEFORE = [
  ['challenge', 'Challenge'],
  ['context', 'Context'],
  ['role', 'Role'],
  ['constraints', 'Constraints'],
] as const;

/** The fields shown after its evidence. */
const AFTER = [
  ['outcomes', 'Outcomes'],
  ['reflection', 'Reflection'],
] as const;

function Heading({ level, children }: { level: Level; children: ReactNode }) {
  const Tag = `h${level}` as const;
  return (
    <Tag className="oa-case__heading" data-type-role="title">
      {children}
    </Tag>
  );
}

/** One part of the case under its fixed label. */
function Part({
  label,
  level,
  ctx,
  children,
}: {
  label: string;
  level: Level;
  ctx: RenderContext;
  children: ReactNode;
}) {
  return (
    <section className="oa-case__part">
      <Heading level={level}>
        <Words input={ctx.input}>{label}</Words>
      </Heading>
      {children}
    </section>
  );
}

/** Short facts as a list, such as the tools a system was built with. */
function Facts({ items, className }: { items: readonly string[] | undefined; className: string }) {
  const shown = (items ?? []).filter(present);
  if (shown.length === 0) return null;
  return (
    <ul className={`oa-facts ${className}`} role="list">
      {shown.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Whether the case has anything to unfold. */
export function hasCase(work: Work, media: readonly PlacedImage[], leadExcerpt: boolean): boolean {
  const study = work.caseStudy;
  return (
    present(work.description) ||
    (!leadExcerpt && present(work.excerpt)) ||
    present(work.showNotes) ||
    Boolean(work.highlights?.length || work.tools?.length || work.tags?.length) ||
    Boolean(work.tracks?.length) ||
    (study !== undefined && Object.keys(study).some((key) => key !== 'extensions')) ||
    media.length > 0 ||
    Boolean(work.evidence?.length) ||
    Boolean(work.links?.length) ||
    present(work.url) ||
    present(work.audioUrl) ||
    present(work.videoUrl)
  );
}

export function Case({
  work,
  ctx,
  media,
  leadExcerpt,
  level,
}: {
  work: Work;
  ctx: RenderContext;
  /** The work's media the room didn't show as its artifact. */
  media: readonly PlacedImage[];
  /** Whether the room already shows the excerpt as its artifact. */
  leadExcerpt: boolean;
  /** The level of the case's own headings: one below the chapter's title. */
  level: Level;
}) {
  const { input } = ctx;
  const study = work.caseStudy;
  const deeper = Math.min(level + 1, 6) as Level;
  const evidence = evidenceByIds(work.evidence, input);
  const nested: RenderContext = { ...ctx, level: deeper, itemLevel: deeper };
  const links = [...(present(work.url) ? [{ url: work.url }] : []), ...(work.links ?? [])];
  const listen: (readonly [string, string])[] = [];
  if (present(work.audioUrl)) listen.push(['Audio', work.audioUrl]);
  if (present(work.videoUrl)) listen.push(['Video', work.videoUrl]);
  return (
    <div className="oa-case__body" lang={work.lang}>
      {present(work.description) ? <RichText source={work.description} input={input} /> : null}
      {!leadExcerpt && present(work.excerpt) ? (
        <blockquote className="oa-case__excerpt">
          <RichText source={work.excerpt} input={input} />
        </blockquote>
      ) : null}
      {present(work.showNotes) ? <RichText source={work.showNotes} input={input} /> : null}
      <Facts items={work.highlights} className="oa-facts--highlights" />
      <Facts items={work.tools} className="oa-facts--tools" />
      <Facts items={work.tags} className="oa-facts--tags" />
      {work.tracks?.length ? (
        <ol className="oa-case__tracks">
          {work.tracks.map((track, index) => (
            <li key={index}>
              {present(track.url) ? (
                <LinkText link={{ url: track.url, label: track.title }} ctx={ctx} />
              ) : (
                track.title
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {study
        ? BEFORE.filter(([key]) => present(study[key])).map(([key, label]) => (
            <Part key={key} label={label} level={level} ctx={ctx}>
              <RichText source={study[key]!} input={input} />
            </Part>
          ))
        : null}
      {study?.decisions?.length ? (
        <Part label="Decisions" level={level} ctx={ctx}>
          <ol className="oa-case__decisions">
            {study.decisions.map((decision, index) => (
              <li key={index}>
                <RichText source={decision.decision} input={input} />
                {present(decision.rationale) ? (
                  <>
                    <Heading level={deeper}>
                      <Words input={input}>Rationale</Words>
                    </Heading>
                    <RichText source={decision.rationale} input={input} />
                  </>
                ) : null}
                {present(decision.alternatives) ? (
                  <>
                    <Heading level={deeper}>
                      <Words input={input}>Alternatives</Words>
                    </Heading>
                    <RichText source={decision.alternatives} input={input} />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </Part>
      ) : null}
      {media.length > 0 ? (
        <ul className="oa-case__media" role="list">
          {media.map((placed, index) => (
            <li key={`${placed.asset}-${index}`}>
              <MediaFigure placed={placed} ctx={ctx} className="oa-case__image" />
            </li>
          ))}
        </ul>
      ) : null}
      {present(study?.evidence) || evidence.length > 0 ? (
        <Part label="Evidence" level={level} ctx={ctx}>
          {present(study?.evidence) ? <RichText source={study.evidence} input={input} /> : null}
          {evidence.length > 0 ? (
            <ul className="pf-evidence oa-case__evidence" role="list">
              {evidence.map((entry) => (
                <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
              ))}
            </ul>
          ) : null}
        </Part>
      ) : null}
      {study
        ? AFTER.filter(([key]) => present(study[key])).map(([key, label]) => (
            <Part key={key} label={label} level={level} ctx={ctx}>
              <RichText source={study[key]!} input={input} />
            </Part>
          ))
        : null}
      {links.length > 0 || listen.length > 0 ? (
        <ul className="oa-case__links" role="list">
          {listen.map(([label, url]) => (
            <li key={label}>
              <a href={hrefFor(url, input)}>
                <Words input={input}>{label}</Words>
              </a>
            </li>
          ))}
          {links.map((link, index) => (
            <li key={index}>
              <LinkText link={link} ctx={ctx} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
