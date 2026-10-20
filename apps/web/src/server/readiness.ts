import type { Access, Capability, Profile } from './capabilities';
import type { DeploymentState } from './config-store';
import { HOST_SITE } from './host-defaults';
import { capabilityPolicy } from './policy';

// Readiness (#1, item 19): whether this process can serve its profile, from
// checks that read no paths, values, or content and say only ok or fail.

export type CheckStatus = 'ok' | 'fail';

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
  /** Whether the variant's module loads. */
  readonly variantLoads: (variant: string) => Promise<boolean>;
  readonly loadedOwnerModules: () => readonly string[];
}

/**
 * The checks: `catalog` (the live revision loads), `packs` (the host's
 * variant loads; #19 adds packs), and, under demo and read-only,
 * `owner-modules` (no owner module has loaded). #3 adds `data-directory`
 * for owner. A failed check is a 503; a startup requirement that failed
 * with `failure: 'degraded'` makes it `degraded`, still 200.
 */
export async function readiness(
  state: DeploymentState | undefined,
  probes: ReadinessProbes,
): Promise<Readiness> {
  if (!state) return { httpStatus: 503, body: { status: 'starting' } };
  const { profile } = state.config;
  const checks: ReadinessCheck[] = [
    { id: 'catalog', status: await settle(async () => Boolean(await state.catalog.getLive())) },
    { id: 'packs', status: await settle(() => probes.variantLoads(HOST_SITE.appearance.variant)) },
  ];
  if (profile !== 'owner') {
    checks.push({
      id: 'owner-modules',
      status: probes.loadedOwnerModules().length === 0 ? 'ok' : 'fail',
    });
  }
  const failed = checks.some((check) => check.status === 'fail');
  const status = failed ? 'unavailable' : state.degraded.length > 0 ? 'degraded' : 'ready';
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
