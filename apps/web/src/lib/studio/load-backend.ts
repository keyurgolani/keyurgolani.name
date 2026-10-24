import type { StudioPolicy } from './backend';

// The one place a Studio shell loads its backend from (#9): Owner Studio's
// adapter only under owner, and Demo Studio's browser backend only under
// demo, each its own chunk, which neither profile's page loads for the
// other. Nothing else imports either module, outside tests.

type OwnerModule = typeof import('./owner-backend');
type DemoModule = typeof import('~/lib/demo/browser-backend');

/** The module of the profile's backend, or null under a profile with none. */
export function loadBackend(profile: 'owner'): Promise<OwnerModule>;
export function loadBackend(profile: 'demo'): Promise<DemoModule>;
export function loadBackend(
  profile: StudioPolicy['profile'],
): Promise<OwnerModule | DemoModule> | null;
export function loadBackend(
  profile: StudioPolicy['profile'],
): Promise<OwnerModule | DemoModule> | null {
  if (profile === 'owner') return import('./owner-backend');
  if (profile === 'demo') return import('~/lib/demo/browser-backend');
  return null;
}
