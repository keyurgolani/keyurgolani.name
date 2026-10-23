import type { Access, Capability, Profile } from './capabilities';
import type { LiveRevision } from './catalog-port';
import type { DeploymentState } from './config-store';
import { capabilityPolicy } from './policy';
import { STARTING } from './ready-starting';
import type { VariantHealth } from './variant-health';

// Readiness (#1, item 19): whether this process can serve its profile, from
// checks that read no paths, values, or content and say only ok, degraded, or
// fail.

/**
 * `degraded`, which passes, is the packs check's when the fallback
 * composition stands in for the site's variant (#5), and the catalog
 * check's when the last known good stands in for the live revision (#3).
 */
export type CheckStatus = 'ok' | 'degraded' | 'fail';

export interface ReadinessCheck {
  readonly id: 'catalog' | 'packs' | 'owner-modules' | 'data-directory';
  readonly status: CheckStatus;
}

export type ReadinessBody =
  | { readonly status: 'starting' }
  | {
      readonly status: 'ready' | 'degraded' | 'unavailable';
      readonly profile: Profile;
      readonly capabilities: readonly { readonly id: Capability; readonly access: Access }[];
      readonly checks: readonly ReadinessCheck[];
    };

export interface Readiness {
  /** 200 for ready and degraded; 503 before startup finishes and when a check fails. */
  readonly httpStatus: 200 | 503;
  readonly body: ReadinessBody;
}

/** What the checks read besides the deployment: the variant registry and the owner load trace. */
export interface ReadinessProbes {
  /** The health of the site's selection, once the module that renders it has loaded; it throws when that fails. */
  readonly variantHealth: (variant: string) => Promise<VariantHealth>;
  /** The health of the site's packs, `degraded` while one falls back (#19, Slice 4), for the serving revision. */
  readonly appearanceHealth: (
    site: PublicSite,
    revision: { readonly revisionId: string; readonly profile: Profile },
  ) => { readonly status: 'ok' | 'degraded' };
  readonly loadedOwnerModules: () => readonly string[];
}

/** What the packs check reads of the serving revision's site. */
type PublicSite = NonNullable<
  Extract<LiveRevision, { state: 'live' | 'degraded' }>['unit']
>['site'];

/**
 * The checks: `catalog`, from the serving state alone, never the revision's
 * IDs (#3, item 23): `ok` live, `degraded` while the last known good serves,
 * and `fail` when nothing is servable, `incompatible` or `empty`; `packs`
 * (what renders the live site's variant loads, `degraded` when the fallback
 * composition stands in for it or one of its packs falls back, #19's
 * appearanceHealth(); with nothing served there's none to load, so it fails
 * too); under demo and read-only, `owner-modules`
 * (no owner module has loaded); and under owner, `data-directory` (#3, item
 * 23): the data directory's write, sync, and rename probe, run at most every
 * 30 s. A failed check is a 503. A degraded check, or a startup requirement
 * that failed with `failure: 'degraded'`, makes it `degraded`, still 200.
 */
export async function readiness(
  state: DeploymentState | undefined,
  probes: ReadinessProbes,
): Promise<Readiness> {
  if (!state) return { httpStatus: 503, body: STARTING };
  const { profile } = state.config;
  let site: PublicSite | undefined;
  let revisionId: string | null = null;
  let catalog: CheckStatus = 'fail';
  try {
    const live = await state.catalog.getLive();
    catalog = SERVING[live.state];
    site = live.unit?.site;
    revisionId = live.revisionId;
  } catch {
    catalog = 'fail';
  }
  const served = site;
  const checks: ReadinessCheck[] = [
    { id: 'catalog', status: catalog },
    {
      id: 'packs',
      status:
        served === undefined || revisionId === null
          ? 'fail'
          : worst(
              await packs(() => probes.variantHealth(served.appearance.variant)),
              appearance(() =>
                probes.appearanceHealth(served, { revisionId: revisionId!, profile }),
              ),
            ),
    },
  ];
  if (profile !== 'owner') {
    checks.push({
      id: 'owner-modules',
      status: probes.loadedOwnerModules().length === 0 ? 'ok' : 'fail',
    });
  }
  if (profile === 'owner' && state.dataDirectory) {
    const probe = state.dataDirectory;
    checks.push({ id: 'data-directory', status: await settle(() => probe()) });
  }
  const failed = checks.some((check) => check.status === 'fail');
  const degraded = state.degraded.length > 0 || checks.some((check) => check.status === 'degraded');
  const status = failed ? 'unavailable' : degraded ? 'degraded' : 'ready';
  return {
    httpStatus: failed ? 503 : 200,
    body: {
      status,
      profile,
      capabilities: capabilityPolicy(profile).summary().capabilities,
      checks,
    },
  };
}

/** The catalog check by serving state: nothing servable fails, and the last known good passes, degraded. */
const SERVING: Readonly<Record<LiveRevision['state'], CheckStatus>> = {
  live: 'ok',
  degraded: 'degraded',
  incompatible: 'fail',
  empty: 'fail',
};

/** ok when `probe` resolves true; fail when it resolves false or throws. */
async function settle(probe: () => Promise<boolean>): Promise<CheckStatus> {
  try {
    return (await probe()) ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

/** The appearance's status; fail when it can't be told. */
function appearance(probe: () => { readonly status: 'ok' | 'degraded' }): CheckStatus {
  try {
    return probe().status;
  } catch {
    return 'fail';
  }
}

const RANK: Readonly<Record<CheckStatus, number>> = { ok: 0, degraded: 1, fail: 2 };

/** The worse of two statuses. */
function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The health's own status; fail when the module that renders doesn't load. */
async function packs(probe: () => Promise<VariantHealth>): Promise<CheckStatus> {
  try {
    return (await probe()).status;
  } catch {
    return 'fail';
  }
}
