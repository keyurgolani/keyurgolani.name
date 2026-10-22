// What pnpm test:trace traces (#6, Slice 1): one target per selection. By
// default each registered variant is one, on the #12 app-under-test fixture
// under read-only, with #5's complete fixture as the source directory, its
// site document selecting the variant (the fallback composition through a
// selection nothing registers), its bundled media, and the variant specs'
// fixed clock. With --base-url there is one target, the server at that
// origin, under the --selection label it names.
import type { AppOptions } from '../harness/fixtures';
import { VARIANTS } from '../harness/registry';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureApp, selection } from '../variants/target';

/** The contract fixture every app-under-test trace renders. */
export const TRACE_FIXTURE = 'complete';

export interface TraceTarget {
  /** The Playwright project's name. */
  readonly name: string;
  /** What the site document selects, or the label --selection gave an outside server. */
  readonly selection: string;
  /** The composition that renders, when the trace knows it. */
  readonly composition: string | null;
  readonly profile: string | null;
  readonly fixture: string | null;
  /** The app under test's options; none for an outside server. */
  readonly appOptions?: AppOptions;
}

/**
 * Every target for these options.
 *
 * @param options what tests/trace/run.mjs passed on
 */
export function traceTargets(options: {
  baseUrl: string | null;
  selection: string | null;
}): TraceTarget[] {
  if (options.baseUrl) {
    const label = options.selection ?? 'external';
    return [{ name: label, selection: label, composition: null, profile: null, fixture: null }];
  }
  const fixture = contractFixture(TRACE_FIXTURE);
  const targets = VARIANTS.map((variant) => ({
    name: variant.manifest.id,
    selection: selection(variant),
    composition: variant.manifest.id,
    profile: 'read-only',
    fixture: TRACE_FIXTURE,
    appOptions: fixtureApp(fixture, variant),
  }));
  if (options.selection === null) return targets;
  const chosen = targets.filter(
    (target) => target.name === options.selection || target.selection === options.selection,
  );
  if (chosen.length === 0) {
    const known = targets.map((target) => target.name).join(', ');
    throw new Error(`--selection ${options.selection} names no registered variant (${known})`);
  }
  return chosen;
}
