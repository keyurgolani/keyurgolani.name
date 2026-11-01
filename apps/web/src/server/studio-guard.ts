import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Capability } from './capabilities';
import { getDeploymentState } from './config-store';
import { demoPageAllowed, ownerPageDecision, type OwnerPage } from './studio-page';

// The guards Studio pages call first, before any Suspense boundary, since a
// layout doesn't run again on client navigation (#2). Under owner a page
// calls requireOwnerPage(capability); under demo, requireDemoPage(capability)
// on the capability its entry serves there (#7, #9). routes.test.ts fails on
// a Studio page other than /studio/sign-in without the guard for each
// profile its entries serve. Neither imports owner code: the composition
// root's owner branch binds the session lookup into the deployment state.
// studio-page.ts holds what they decide.

export type { OwnerPage } from './studio-page';

/**
 * An owner Studio page's guard: its session, or Next's redirect() (307) to
 * /studio/sign-in, with no state when no session cookie came,
 * `session_ended` when one came and counts for nothing, and `error` when
 * the session store couldn't be read. Outside owner it is the 404.
 */
export async function requireOwnerPage(capability: Capability): Promise<OwnerPage> {
  const decision = await ownerPageDecision(
    capability,
    getDeploymentState(),
    new Headers(await headers()),
  );
  if (decision.kind === 'redirect') redirect(decision.location);
  if (decision.kind === 'not-found') notFound();
  return decision.page;
}

/**
 * A demo Studio page's guard (#7, #9): the 404 unless the deployment is demo
 * and its policy allows `capability` with no session.
 */
export function requireDemoPage(capability: Capability): void {
  if (!demoPageAllowed(capability, getDeploymentState())) notFound();
}
