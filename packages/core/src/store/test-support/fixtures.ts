// For the store's tests: #4's fixture pairs as unit input, a UnitChecks
// built on the real composite validator, and temporary data directories.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyEdits,
  validatePublicationUnit,
  type DocumentFormat,
  type ParsedPair,
  type UnitValidator,
} from '@portfolio/schema';
import { memoryAuditSink } from '../../audit/sink';
import { memorySessionStore } from '../../auth/session-store';
import { createSessions, type SessionHold } from '../../auth/sessions';
import { preflight } from '../preflight';
import type { HeldMove, PublicationOutcome, PublicationService } from '../publication';
import { openStore, type Store, type StoreOptions } from '../store';
import { isSha256, type Sha256 } from '../layout';
import type { UnitChecks, UnitInput } from '../../catalog/unit';
import { recordOwnerModule } from '../../load-trace';

recordOwnerModule('core/store/test-support/fixtures');

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_FIXTURES = path.resolve(here, '../../../../schema/src/__fixtures__');

export type PairName =
  | 'academic'
  | 'consulting'
  | 'design'
  | 'engineering'
  | 'mixed'
  | 'music'
  | 'photography'
  | 'writing';

export const PAIR_NAMES: readonly PairName[] = [
  'academic',
  'consulting',
  'design',
  'engineering',
  'mixed',
  'music',
  'photography',
  'writing',
];

const extension = (format: DocumentFormat) => (format === 'yaml' ? 'yml' : 'json');

/** A fixture pair from #4's __fixtures__/pairs, in one format. */
export function pairInput(name: PairName, format: DocumentFormat = 'yaml'): UnitInput {
  const dir = path.join(SCHEMA_FIXTURES, 'pairs', name, format);
  const read = (document: 'portfolio' | 'site') => ({
    format,
    sourceText: readFileSync(path.join(dir, `${document}.${extension(format)}`), 'utf8'),
  });
  return { portfolio: read('portfolio'), site: read('site') };
}

/** One of #4's invalid fixtures, by its code. */
export function invalidInput(code: string): UnitInput {
  const dir = path.join(SCHEMA_FIXTURES, 'invalid', code);
  const read = (document: 'portfolio' | 'site') => {
    const file = readdirSync(dir).find((name) => name.startsWith(`${document}.`));
    if (!file) throw new Error(`${code} has no ${document} document.`);
    const format: DocumentFormat = file.endsWith('.json') ? 'json' : 'yaml';
    return { format, sourceText: readFileSync(path.join(dir, file), 'utf8') };
  };
  return { portfolio: read('portfolio'), site: read('site') };
}

/** A media document for tests: `{blobs: [...]}`, its references. */
export function mediaDocument(blobs: readonly Sha256[]) {
  return { format: 'json' as const, sourceText: `${JSON.stringify({ blobs })}\n` };
}

/**
 * The checks a test store runs: #4's composite validator with an empty
 * context, a `controls` snapshot from the site's visitor controls, the test
 * media document's blobs, and the site's variant as the rendering.
 */
export function testChecks(overrides: Partial<UnitChecks> = {}): UnitChecks {
  return {
    validate: (pair) => validatePublicationUnit(pair),
    snapshots: (pair: ParsedPair) => ({
      controls: {
        visitorControls: (pair.site as { visitorControls?: unknown }).visitorControls ?? null,
      },
    }),
    referencedBlobs: (media) => {
      const blobs = (media as { blobs?: unknown } | null)?.blobs;
      return Array.isArray(blobs) ? blobs.filter(isSha256) : [];
    },
    rendering: (pair: ParsedPair) => {
      const variant = (pair.site as { appearance?: { variant?: string } }).appearance?.variant;
      return {
        variant: variant ? { id: variant, version: '1.0.0' } : null,
        packs: [],
        contracts: { variant: '2' },
      };
    },
    appVersion: '0.0.0-test',
    ...overrides,
  };
}

/**
 * The checks of a build that registers only the `registered` variants, as
 * #5's contract validators check a selection: any other is
 * variant.unavailable, which blocks a publish (`validate`) and only warns
 * live (`validateLive`), where the fallback composition renders. The
 * fixture pairs select `missing-variant`.
 */
export function registryChecks(
  registered: readonly string[],
  overrides: Partial<UnitChecks> = {},
): UnitChecks {
  const selection = (live: boolean): UnitValidator => ({
    id: 'test-variant-selection',
    covers: ['site.appearance.variant'],
    validate: (pair) =>
      registered.includes(pair.site.appearance.variant)
        ? { diagnostics: [] }
        : {
            diagnostics: [
              {
                code: 'variant.unavailable',
                severity: live ? 'warning' : 'blocks-publish',
                document: 'site',
                pointer: '/appearance/variant',
                message: "/appearance/variant names a variant this build doesn't register.",
                remediation: 'Install its package and rebuild.',
              },
            ],
          },
  });
  return testChecks({
    validate: (pair) => validatePublicationUnit(pair, { validators: [selection(false)] }),
    validateLive: (pair) => validatePublicationUnit(pair, { validators: [selection(true)] }),
    ...overrides,
  });
}

/** A new empty directory under the system temp directory, removed when the test ends. */
export function tempDir(t: { after(fn: () => void): void }, prefix = 'store-'): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A store over a new data directory that passed preflight. */
export async function newStore(
  t: { after(fn: () => void): void },
  options: Partial<StoreOptions> = {},
): Promise<Store> {
  const dataDir = options.dataDir ?? tempDir(t);
  const problem = await preflight({ dataDir });
  if (problem) throw new Error(`preflight: ${problem}`);
  return openStore({ checks: testChecks(), ...options, dataDir });
}

/**
 * Publishes `input` as the store's next revision through a draft, as Studio
 * would, and returns the revision ID.
 */
/** An owner session in memory, as #2 issues one at sign-in. */
export async function ownerSession(options: { readonly commitTimeoutMs?: number } = {}) {
  const sessions = createSessions({
    store: memorySessionStore(),
    audit: memoryAuditSink(),
    fingerprint: 'test-fingerprint',
    ...options,
  });
  const { token, record } = await sessions.issue({ uaFamily: 'firefox' });
  /** The store's holdSession(), the way a Studio command passes commitWithSession(). */
  const holdSession = async <T>(move: (hold: SessionHold) => Promise<T>): Promise<HeldMove<T>> => {
    const holding = await sessions.holding(token, (hold) => move(hold));
    return holding.status === 'valid' ? { ok: true, value: holding.value } : { ok: false };
  };
  return { sessions, token, digest: record.digest, holdSession };
}

type Owned = Pick<PublicationService, 'publish' | 'rollback' | 'recover'>;
const owners = new WeakMap<Store, Promise<Awaited<ReturnType<typeof ownerSession>>>>();

/**
 * The store's publication service with the owner's pointer moves held in an
 * owner session, as Studio's commands hold them. The operator's pass
 * straight through.
 */
export function owned(store: Store): Owned {
  const session = () => {
    if (!owners.has(store)) owners.set(store, ownerSession());
    return owners.get(store)!;
  };
  const through =
    <K extends keyof Owned>(name: K) =>
    async (...[input, actor, context = {}]: Parameters<Owned[K]>) => {
      const holdSession = actor === 'operator' ? undefined : (await session()).holdSession;
      return (store.publication[name] as (...args: unknown[]) => Promise<PublicationOutcome>)(
        input,
        actor,
        { ...context, ...(holdSession ? { holdSession } : {}) },
      );
    };
  return {
    publish: through('publish'),
    rollback: through('rollback'),
    recover: through('recover'),
  };
}

export async function publishInput(store: Store, input: UnitInput, expectedVersion?: number) {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents: input, ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  if (created.kind !== 'saved') throw new Error(`draft: ${created.code}`);
  const live = await store.publication.status();
  const outcome = await owned(store).publish(
    {
      draftId: created.draft.draftId,
      draftVersion: expectedVersion ?? created.draft.version,
      expectedLiveRevisionId: live.liveRevisionId,
    },
    'owner',
  );
  if (outcome.kind !== 'committed') throw new Error(`publish: ${outcome.code}`);
  return outcome.revisionId;
}

/** Every file under `dir`, relative to it. */
export function filesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return files.sort();
}

/** A copy of `input` with a comment added to its YAML portfolio: new bytes, same content. */
export function commentedVariant(input: UnitInput, marker: string): UnitInput {
  const { portfolio } = input;
  if (portfolio.format !== 'yaml') throw new Error('A comment needs a YAML portfolio.');
  return {
    ...input,
    portfolio: { ...portfolio, sourceText: `${portfolio.sourceText}# ${marker}\n` },
  };
}

/** A copy of `input` whose portfolio's meta description names `marker`: new content. */
export function contentVariant(input: UnitInput, marker: string): UnitInput {
  const { portfolio } = input;
  const sourceText = applyEdits(portfolio.sourceText, portfolio.format, [
    { op: 'set', pointer: '/meta/description', value: `A portfolio, version ${marker}.` },
  ]);
  return { ...input, portfolio: { ...portfolio, sourceText } };
}
