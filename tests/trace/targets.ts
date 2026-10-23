// What pnpm test:trace traces (#6, Slices 1 and 2): one target per
// selection and profile. By default each entry of the trace matrix that
// registry generation writes (apps/web/src/lib/generated/trace-matrix.json)
// is a selection, under read-only and under owner, the two profiles whose
// public pages the purity assertion covers, or the one --profile names. Each
// runs on the #12 app-under-test fixture, with #5's complete fixture as the
// source directory, its site document selecting the entry's variant (the
// fallback composition's entry selects an id nothing registers), its bundled
// media, and the variant specs' fixed clock. Owner adds the password provider,
// with a hash made for the run, and a data directory of its own; the trace
// never signs in. With --base-url there is one target, the server at that
// origin, under the --selection label it names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppOptions } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { TRACE_PROFILES } from '../harness/trace/options.mjs';
import type { TraceMatrixFile } from '../../packages/variant-contract/src/node/codegen';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureApp, WEB } from '../variants/target';

/** The contract fixture every app-under-test trace renders. */
export const TRACE_FIXTURE = 'complete';

/** Where registry generation writes the trace matrix, for the build the trace starts. */
export const TRACE_MATRIX = path.join(WEB, 'src', 'lib', 'generated', 'trace-matrix.json');
const ASSET_MANIFEST = path.join(WEB, 'src', 'lib', 'generated', 'asset-manifest.json');

/**
 * The typography profile the trace's site publishes when the build
 * registers it, as BUDGET_FIXTURES=1 does: #6's font fixture, which ships a
 * font file, so the font budget counts one and the fonts-blocked mode blocks
 * one. Any other build publishes the fixture's own, which falls back.
 */
export const TRACE_TYPOGRAPHY = 'fixture-type-font';

function registersTypography(id: string, file = ASSET_MANIFEST): boolean {
  try {
    const { units } = JSON.parse(readFileSync(file, 'utf8')) as {
      units: { kind: string; id: string }[];
    };
    return units.some((unit) => unit.kind === 'typography' && unit.id === id);
  } catch {
    return false;
  }
}

/** `site` publishing `typography`, in place of the fixture's own. */
export function publishingTypography(site: string, typography: string): string {
  const published = site.replace(/^(\s+typography:\s*)[a-z][a-z0-9-]*\s*$/m, `$1${typography}`);
  if (published === site)
    throw new Error("The trace fixture's site publishes no typography to replace.");
  return published;
}

export interface TraceTarget {
  /** The Playwright project's name. */
  readonly name: string;
  /** What the site document selects, or the label --selection gave an outside server. */
  readonly selection: string;
  /**
   * Whether the site publishes TRACE_TYPOGRAPHY, whose font a page then
   * loads, so the fonts-blocked modes must refuse at least one (#6).
   */
  readonly publishesFont: boolean;
  /** The composition that renders, when the trace knows it. */
  readonly composition: string | null;
  readonly profile: string | null;
  readonly fixture: string | null;
  /** The app under test's options; none for an outside server. */
  readonly appOptions?: AppOptions;
}

/** The trace matrix this checkout's registry generation wrote. */
export function readTraceMatrix(file = TRACE_MATRIX): TraceMatrixFile {
  let matrix: TraceMatrixFile;
  try {
    matrix = JSON.parse(readFileSync(file, 'utf8')) as TraceMatrixFile;
  } catch (error) {
    throw new Error(
      `The trace reads ${file}, which pnpm build writes: build first. (${(error as Error).message})`,
    );
  }
  if (matrix.version !== 1 || !Array.isArray(matrix.entries)) {
    throw new Error(`${file} isn't a version 1 trace matrix.`);
  }
  return matrix;
}

/** One owner secret per process, made only when an owner target needs it. */
let secret: { password: string; hash: string } | undefined;

/**
 * The owner secret this process's owner targets start with: the catalog
 * trace signs in with its password (catalog.spec.ts). Each worker evaluates
 * the config, and so makes its own, for the apps it starts.
 */
export function traceOwner(): { password: string; hash: string } {
  return (secret ??= ownerSecret());
}

/**
 * `options` under owner: the password provider with `hash` in a _FILE, and a
 * data directory made for the run.
 */
export function asOwner(options: AppOptions, hash: string): AppOptions {
  return {
    ...options,
    dataName: 'data',
    env: { ...options.env, PORTFOLIO_PROFILE: 'owner' },
    envFiles: {
      ...options.envFiles,
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: {
        path: 'secrets/owner_password_hash',
        text: `${hash}\n`,
      },
    },
  };
}

/**
 * Every target for these options.
 *
 * @param options what tests/trace/run.mjs passed on
 * @param matrix the trace matrix, read from the build by default
 */
export function traceTargets(
  options: { baseUrl: string | null; selection: string | null; profile?: string | null },
  matrix: () => TraceMatrixFile = readTraceMatrix,
): TraceTarget[] {
  if (options.baseUrl) {
    const label = options.selection ?? 'external';
    // An outside server's site is its own, so nothing says it publishes the font.
    return [
      {
        name: label,
        selection: label,
        publishesFont: false,
        composition: null,
        profile: null,
        fixture: null,
      },
    ];
  }
  const entries = matrix().entries.filter((entry) => entry.kind === 'variant');
  const chosen =
    options.selection === null
      ? entries
      : entries.filter(
          (entry) =>
            entry.id === options.selection || entry.selection.variant === options.selection,
        );
  if (chosen.length === 0) {
    const known = entries.map((entry) => entry.id).join(', ');
    throw new Error(`--selection ${options.selection} names no registered variant (${known})`);
  }
  const profiles = options.profile ? [options.profile] : TRACE_PROFILES;
  const ownerHash = () => traceOwner().hash;
  const fixture = contractFixture(TRACE_FIXTURE);
  const fonts = registersTypography(TRACE_TYPOGRAPHY);
  return profiles.flatMap((profile) =>
    chosen.map((entry) => {
      const own = fixtureApp(fixture, { manifest: { id: entry.id } });
      const app =
        fonts && own.siteText
          ? { ...own, siteText: publishingTypography(own.siteText, TRACE_TYPOGRAPHY) }
          : own;
      return {
        name: profile === 'read-only' ? entry.id : `${entry.id} (${profile})`,
        selection: entry.selection.variant,
        publishesFont: app !== own,
        composition: entry.id,
        profile,
        fixture: TRACE_FIXTURE,
        appOptions: profile === 'owner' ? asOwner(app, ownerHash()) : app,
      };
    }),
  );
}
