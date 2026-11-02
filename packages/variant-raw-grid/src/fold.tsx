import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import { githubSnapshot, present } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { countOf, type Sheet } from './model';
import { Fit, Words } from './parts';
import { titleOf } from './frame';

// The home outline (design gate item 8, lead A's ruling for Raw Grid): the
// minor parts of Record and About fold behind closed native disclosures at
// the end of their sheet: education, publications, talks, awards, patents,
// press, the links elsewhere and any other records that aren't figures or
// words from collaborators, GitHub, the engagements, and the stack when it's
// long, and on About what the owner is focused on and the oddities off the
// page (the lead's ruling, round 8, for page length at 390). Experience,
// Skills, each sheet's lead, At a glance, the words from collaborators and a
// mixed timeline stay open. A fold is a ruled cell
// whose summary reads as content (the section's title as tape, its first
// item, its count) a ring's reach inside the cell's rules, and the section's
// own band inside, with its id, so its Contents and Index links still land:
// a fragment opens it (natively in Chromium, and the client module wherever
// the engine doesn't), print opens every fold, and with no script it's a
// native disclosure all the same. Display grouping only: nothing moves.

/** Evidence types that stay open: the figures and the words from collaborators. */
const OPEN = new Set(['metric', 'testimonial']);
/** A stack longer than this folds. */
const LONG_STACK = 8;

function evidenceIn(section: Extract<Section, { kind: 'evidence' }>, input: VariantRenderInput) {
  const byId = new Map(input.portfolio.evidence.map((record) => [record.id, record]));
  return section.items.flatMap((id) => byId.get(id) ?? []);
}

function chronologyIn(
  section: Extract<Section, { kind: 'chronology' }>,
  input: VariantRenderInput,
) {
  const byId = new Map(input.portfolio.chronology.map((entry) => [entry.id, entry]));
  return (section.items ?? [...byId.keys()]).flatMap((id) => byId.get(id) ?? []);
}

/** Whether a section on a sheet folds. */
export function folds(sheet: Sheet, section: Section, input: VariantRenderInput): boolean {
  if (sheet.id !== 'record' && sheet.id !== 'about') return false;
  switch (section.kind) {
    case 'evidence': {
      const types = evidenceIn(section, input).map((record) => record.type);
      return types.length > 0 && types.filter((type) => !OPEN.has(type)).length * 2 > types.length;
    }
    case 'chronology': {
      // Education folds; Experience and a mixed timeline stay open.
      const entries = chronologyIn(section, input);
      return entries.length > 0 && entries.every((entry) => entry.kind === 'study');
    }
    case 'github':
    case 'focus':
    case 'fun-facts':
      return true;
    case 'practice':
      return (
        section.part === 'services' ||
        (section.part === 'tools' && (countOf(section, input)?.n ?? 0) > LONG_STACK)
      );
    default:
      return false;
  }
}

/**
 * A sheet's outline entries in the page's reading order: the folds last, as the sheet sets them,
 * so its Contents and the Index read as the page does.
 */
export function foldedLast<T extends { readonly id: string }>(
  sheet: Sheet,
  entries: readonly T[],
  input: VariantRenderInput,
): readonly T[] {
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const folded = (entry: T) => {
    const section = byId.get(entry.id);
    return section !== undefined && folds(sheet, section, input);
  };
  return [...entries.filter((entry) => !folded(entry)), ...entries.filter(folded)];
}

const nameOf = (item: unknown) =>
  typeof item === 'string' ? item : (item as { name?: string } | undefined)?.name;

/** A closed fold's summary line: the first thing it holds, and how many, in its own noun. */
export function foldLine(
  section: Section,
  input: VariantRenderInput,
): { readonly first?: string; readonly count?: string } {
  const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
  switch (section.kind) {
    case 'evidence': {
      const lead = evidenceIn(section, input)[0];
      const n = countOf(section, input)?.n ?? 0;
      return {
        first: lead
          ? [lead.title, lead.venue, lead.organization, lead.statement].find(present)
          : undefined,
        count: n > 0 ? entries(n) : undefined,
      };
    }
    case 'chronology': {
      const lead = chronologyIn(section, input)[0];
      const n = countOf(section, input)?.n ?? 0;
      return {
        first: lead ? [lead.title, lead.organization].filter(present).join(', ') : undefined,
        count: n > 0 ? entries(n) : undefined,
      };
    }
    case 'focus':
    case 'fun-facts': {
      const n = section.items.length;
      return { first: section.items[0], count: n > 0 ? entries(n) : undefined };
    }
    case 'github': {
      const snapshot = githubSnapshot(section, input);
      const repos = snapshot?.state === 'ready' ? snapshot.value.totalRepos : 0;
      return {
        first: `@${section.username}`,
        count: repos > 0 ? `${repos} ${repos === 1 ? 'repository' : 'repositories'}` : '1 profile',
      };
    }
    case 'practice': {
      const groups = input.portfolio.practice?.[section.part];
      const list = Array.isArray(groups) ? groups : [];
      const first = list
        .flatMap((group: { items?: readonly unknown[] }) => group.items ?? [])
        .map(nameOf)
        .find(present);
      const n = countOf(section, input)?.n ?? 0;
      return { first, count: n > 0 ? entries(n) : undefined };
    }
    default:
      return {};
  }
}

export function Fold({
  section,
  input,
  uiLang,
  children,
}: {
  section: Section;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
  children: ReactNode;
}) {
  const title = titleOf(section);
  const line = foldLine(section, input);
  return (
    <details className="rg-fold" data-rg-fold="">
      <summary>
        {/* The section's heading, in the summary, so a closed fold stays in heading navigation;
            the band's own head inside is display: none, still naming it through aria-labelledby. */}
        {title !== undefined ? (
          <h3 className="rg-tab">
            <Fit text={title} />
          </h3>
        ) : null}
        {line.first ? (
          <span className="rg-band__sub rg-fold__first" aria-hidden="true">
            {line.first}
          </span>
        ) : null}
        {line.count ? (
          <span className="rg-band__count">
            <span className="rg-hidden">, </span>
            <Words lang={uiLang}>{line.count}</Words>
          </span>
        ) : null}
      </summary>
      {children}
    </details>
  );
}
