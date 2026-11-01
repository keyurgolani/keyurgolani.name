import type { ChronologyEntry } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  MaybeLink,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  shownPlace,
  worksByIds,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Vitrine } from './labels';
import { SectionTitle } from './title';

// The record (redesign, stream C, C1): a chronology as the catalogue's
// checklist in a vitrine (labels.tsx), not a ruled table: each entry's
// number, the role and where it was on one line, what it did and the works
// it produced under it, its skills on a quiet line of their own, who it
// was with, and its years in tabular figures. An entry's id is its
// record's on the first section that lists it.

/** Whether the section's entries say what they did, which takes a column of its own. */
export function hasWork(entries: readonly ChronologyEntry[]): boolean {
  return entries.some(
    (entry) =>
      present(entry.description) ||
      Boolean(entry.highlights?.length || entry.achievements?.length || entry.works?.length),
  );
}

function Work({ entry, ctx }: { entry: ChronologyEntry; ctx: RenderContext }) {
  const { input } = ctx;
  const produced = worksByIds(entry.works, input);
  const more = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
  return (
    <>
      {present(entry.description) ? <RichText source={entry.description} input={input} /> : null}
      {more.length > 0 ? <p className="oa-quiet">{more.join('. ')}</p> : null}
      {produced.length > 0 ? (
        <p className="oa-quiet">
          {produced.map((work, index) => (
            <span key={work.id}>
              {index > 0 ? ', ' : null}
              <MaybeLink url={anchorSection(work, input) ? `#${work.id}` : undefined} ctx={ctx}>
                {work.title}
              </MaybeLink>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

export function ChronologySection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  const study = entries.length > 0 && entries.every((entry) => entry.kind === 'study');
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      <Vitrine
        input={input}
        title={study ? 'Study' : 'Role'}
        where={study ? 'School' : 'With'}
        when="Years"
        rows={entries.map((entry) => ({
          key: entry.id,
          id: recordAnchor(section, entry, input),
          lang: entry.lang,
          type: entry.kind,
          // The role and where it was, on one line; then what it did, and its skills on a quiet line of their own.
          title: (
            <>
              <b>{entry.title}</b>
              {present(entry.field) ? `, ${entry.field}` : null}
              {present(shownPlace(entry.location)) ? `, ${shownPlace(entry.location)}` : null}
            </>
          ),
          more: [
            <Work key="work" entry={entry} ctx={ctx} />,
            entry.skills?.length ? (
              <span key="skills" className="oa-quiet">
                {entry.skills.join(', ')}
              </span>
            ) : undefined,
          ],
          where: present(entry.organization) ? (
            <MaybeLink url={entry.organizationUrl} ctx={ctx}>
              {entry.organization}
            </MaybeLink>
          ) : undefined,
          when: <PeriodText period={entry.period} ctx={ctx} />,
        }))}
      />
    </>
  );
}
