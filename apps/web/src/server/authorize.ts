import type { Capability } from './capabilities';
import { getDeploymentConfig } from './config-store';
import { capabilityPolicy } from './policy';
import { isMintedSession, type Session } from './session';

// authorize() (#1, item 12): the dispatcher's step 4. It decides with the
// policy of the deployment register() froze, never one a caller passes, and
// accepts only a session a provider minted. Every owner service method takes
// the token it returns first and re-checks it with assertAuthorized().

declare const brand: unique symbol;

/** Proof that the deployment's policy allowed `capability` for one request. Only authorize() makes one. */
export interface Authorized<C extends Capability = Capability> {
  readonly capability: C;
  readonly session: Session | null;
  readonly [brand]: true;
}

// Issued tokens, on a globalThis symbol: the dispatcher and the owner
// services it calls can sit in different server bundles.
const ISSUED = Symbol.for('keyurgolani.portfolio.authorized');
type Holder = typeof globalThis & { [ISSUED]?: WeakSet<object> };

function issued(): WeakSet<object> {
  const holder = globalThis as Holder;
  return (holder[ISSUED] ??= new WeakSet());
}

export function authorize<C extends Capability>(
  capability: C,
  session: Session | null,
): Authorized<C> | null {
  const deployment = getDeploymentConfig();
  if (!deployment) return null;
  // A session no provider minted is a forgery, not an absent session.
  if (session !== null && !isMintedSession(session)) return null;
  if (!capabilityPolicy(deployment.profile).allows(capability, session)) return null;
  const token = Object.freeze({ capability, session }) as unknown as Authorized<C>;
  issued().add(token);
  return token;
}

/** Throws unless authorize() issued `token`, for `capability`. */
export function assertAuthorized<C extends Capability>(
  token: Authorized,
  capability: C,
): asserts token is Authorized<C> {
  if (!issued().has(token) || token.capability !== capability) {
    throw new Error(`The request is not authorized for ${capability}.`);
  }
}
