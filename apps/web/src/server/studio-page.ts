import { authorize, type Authorized } from './authorize';
import type { Capability } from './capabilities';
import type { DeploymentState } from './config-store';
import { capabilityPolicy } from './policy';
import { safeReturnTo, signInLocation, type SignInState } from './return-to';
import { STUDIO_PATH_HEADER } from './studio-headers';
import type { PageResolution } from './studio-port';

// What the Studio page guards in studio-guard.ts decide (#2), apart from
// Next's redirect() and notFound(), so tests can run them outside a request.

/** What an owner Studio page gets once its session counts. */
export interface OwnerPage {
  readonly authorized: Authorized;
  /** The session's CSRF token, for the page's own commands through studioFetch. */
  readonly csrfToken: string;
}

export type OwnerPageDecision =
  | { readonly kind: 'page'; readonly page: OwnerPage }
  /** A 307 to sign-in, keeping the path asked for. */
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'not-found' };

/** Why the sign-in page shows, by what the cookie came to: nothing for no cookie at all. */
const SIGN_IN_STATE: Readonly<
  Record<Exclude<PageResolution['status'], 'valid'>, SignInState | null>
> = Object.freeze({ none: null, ended: 'session_ended', unavailable: 'error' });

/**
 * What an owner Studio page does with a request whose headers are `sent`:
 * render with its session, go to sign-in, or 404 when the deployment isn't
 * owner or binds no page sessions. The path to come back to is the one
 * proxy.ts put in x-studio-path.
 */
export async function ownerPageDecision(
  capability: Capability,
  state: DeploymentState | undefined,
  sent: Headers,
): Promise<OwnerPageDecision> {
  if (!state || state.config.profile !== 'owner' || !state.pages) return { kind: 'not-found' };
  const returnTo = safeReturnTo(sent.get(STUDIO_PATH_HEADER));
  const at = new URL(returnTo, state.config.origin);
  const resolution = await state.pages.resolve(new Request(at, { headers: sent }));
  if (resolution.status !== 'valid') {
    return {
      kind: 'redirect',
      location: signInLocation(SIGN_IN_STATE[resolution.status], returnTo),
    };
  }
  const authorized = authorize(capability, resolution.session);
  if (!authorized) return { kind: 'not-found' };
  return { kind: 'page', page: { authorized, csrfToken: resolution.csrfToken } };
}

/** Whether a demo Studio page may render: under demo, when its policy allows `capability` with no session. */
export function demoPageAllowed(
  capability: Capability,
  state: DeploymentState | undefined,
): boolean {
  return state?.config.profile === 'demo' && capabilityPolicy('demo').allows(capability, null);
}
