// First-party coverage. A first-party composition
// owns its markup: it renders every core kind itself and its own case-study
// page, so none of its pages falls back to the kit's shared renderers or to
// the fallback composition. Its quality unit says coverage: 'pending' while
// its redesign gets there, and then the gap is only reported. The fallback
// composition, third-party variants, and extension kinds keep the shared
// renderers.

import { CORE_SECTION_KINDS } from '@portfolio/schema';
import { FIRST_PARTY_PINS } from '../ids';

/** What the coverage check reads from a manifest. */
export interface CoverageManifest {
  readonly id: string;
  readonly renderedKinds: readonly string[];
  readonly routes: { readonly work: string };
}

/** What a first-party composition's manifest still lacks, or nothing when it covers everything. */
export function coverageGaps(
  manifest: Pick<CoverageManifest, 'renderedKinds' | 'routes'>,
): readonly string[] {
  const gaps: string[] = [];
  const rendered = new Set<string>(manifest.renderedKinds);
  const missing = CORE_SECTION_KINDS.filter((kind) => !rendered.has(kind));
  if (missing.length > 0) gaps.push(`renderedKinds leaves out ${missing.join(', ')}`);
  if (manifest.routes.work !== 'bespoke') {
    gaps.push(
      `routes.work is ${manifest.routes.work}, so its case studies render as the fallback's`,
    );
  }
  return gaps;
}

/**
 * The coverage problems of one registered composition: none for a variant
 * that isn't first-party; its gaps when its unit doesn't say pending; and a
 * stale pending when it has none left, so the flag can't outlive the work.
 */
export function coverageProblems(manifest: CoverageManifest, pending: boolean): readonly string[] {
  if (!(manifest.id in FIRST_PARTY_PINS)) return [];
  const gaps = coverageGaps(manifest);
  if (pending) {
    return gaps.length === 0
      ? [
          `${manifest.id} renders every core kind and its own case-study page, so its unit's coverage: 'pending' is stale: remove it`,
        ]
      : [];
  }
  return gaps.map(
    (gap) =>
      `${manifest.id}, a first-party composition, renders every core kind and its own case-study page, but ${gap}. Until it does, its quality unit says coverage: 'pending'.`,
  );
}

/**
 * Whether a quality unit's source says `export const coverage = 'pending'`, read from its
 * text with its comments gone, so check:variants needn't import() it by a computed path.
 * tests/quality/lib/units-coverage.test.ts holds this to each unit's real export.
 */
export function unitSaysCoveragePending(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return /^export const coverage\s*=\s*(['"])pending\1\s*;?\s*$/m.test(code);
}

/** Whether rendered HTML holds a section the kit's shared renderers drew (data-renderer="shared"). */
export function rendersSharedSection(html: string): boolean {
  return /<[a-z][^>]*\sdata-renderer=(["'])shared\1/i.test(html);
}
