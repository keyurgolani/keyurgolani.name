import type { Capability } from './capabilities';
import type { CapabilityPolicy, Session } from './policy';

// authorize() (#1, item 12): the dispatcher's step 4. It returns a branded
// token only when the policy allows the capability, and every owner service
// method takes that token first and re-checks it with assertAuthorized().

declare const brand: unique symbol;

/** Proof that the policy allowed `capability` for one request. Only authorize() makes one. */
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
  policy: CapabilityPolicy,
  capability: C,
  session: Session | null,
): Authorized<C> | null {
  if (!policy.allows(capability, session)) return null;
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
