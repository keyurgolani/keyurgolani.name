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
    return [{ name: label, selection: label, composition: null, profile: null, fixture: null }];
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
  // One hash per process, made only when an owner target needs it.
  let hash: string | undefined;
  const ownerHash = () => (hash ??= ownerSecret().hash);
  const fixture = contractFixture(TRACE_FIXTURE);
  return profiles.flatMap((profile) =>
    chosen.map((entry) => {
      const app = fixtureApp(fixture, { manifest: { id: entry.id } });
      return {
        name: profile === 'read-only' ? entry.id : `${entry.id} (${profile})`,
        selection: entry.selection.variant,
        composition: entry.id,
        profile,
        fixture: TRACE_FIXTURE,
        appOptions: profile === 'owner' ? asOwner(app, ownerHash()) : app,
      };
    }),
  );
}
