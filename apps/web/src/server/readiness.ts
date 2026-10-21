import type { Access, Capability, Profile } from './capabilities';
import type { DeploymentState } from './config-store';
import { capabilityPolicy } from './policy';
import { STARTING } from './ready-starting';
import type { VariantHealth } from './variant-health';

// Readiness (#1, item 19): whether this process can serve its profile, from
// checks that read no paths, values, or content and say only ok, degraded, or
// fail.

/** `degraded` is the packs check's alone: the fallback composition stands in for the site's variant (#5). */
export type CheckStatus = 'ok' | 'degraded' | 'fail';

export interface ReadinessCheck {
  readonly id: 'catalog' | 'packs' | 'owner-modules';
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
  readonly loadedOwnerModules: () => readonly string[];
}

/**
 * The checks: `catalog` (the live revision loads), `packs` (what renders the
 * live site's variant loads, `degraded` when the fallback composition stands
 * in for it; #19 adds packs; with no live revision there's none to load, so
 * it fails too), and, under demo and read-only, `owner-modules` (no owner
 * module has loaded). #3 adds `data-directory` for owner. A failed check is
 * a 503. A degraded check, or a startup requirement that failed with
 * `failure: 'degraded'`, makes it `degraded`, still 200.
 */
export async function readiness(
  state: DeploymentState | undefined,
  probes: ReadinessProbes,
): Promise<Readiness> {
  if (!state) return { httpStatus: 503, body: STARTING };
  const { profile } = state.config;
  let variant: string | undefined;
  const catalog = await settle(async () => {
    variant = (await state.catalog.getLive()).unit.site.appearance.variant;
    return true;
  });
  const site = variant;
  const checks: ReadinessCheck[] = [
    { id: 'catalog', status: catalog },
    {
      id: 'packs',
      status: site === undefined ? 'fail' : await packs(() => probes.variantHealth(site)),
    },
  ];
  if (profile !== 'owner') {
    checks.push({
      id: 'owner-modules',
      status: probes.loadedOwnerModules().length === 0 ? 'ok' : 'fail',
    });
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

/** ok when `probe` resolves true; fail when it resolves false or throws. */
async function settle(probe: () => Promise<boolean>): Promise<CheckStatus> {
  try {
    return (await probe()) ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

/** The health's own status; fail when the module that renders doesn't load. */
async function packs(probe: () => Promise<VariantHealth>): Promise<CheckStatus> {
  try {
    return (await probe()).status;
  } catch {
    return 'fail';
  }
}
