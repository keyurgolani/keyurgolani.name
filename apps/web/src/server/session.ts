// Owner sessions. #2 decides what one carries and how a request proves it.
// Only an auth provider makes one, through the mintSession() the composition
// root hands it (server/owner/session-mint.ts). The policy, authorize(), and
// the dispatcher treat any other object as no session.

export interface Session {
  readonly kind: 'owner';
}

// Minted sessions, on a globalThis symbol: a provider and the dispatcher can
// sit in different server bundles. owner/session-mint.ts adds to it.
const MINTED = Symbol.for('keyurgolani.portfolio.minted-sessions');
type Holder = typeof globalThis & { [MINTED]?: WeakSet<object> };

/** Whether a provider minted `value` through mintSession(). */
export function isMintedSession(value: unknown): value is Session {
  const minted = (globalThis as Holder)[MINTED];
  return typeof value === 'object' && value !== null && minted !== undefined && minted.has(value);
}
