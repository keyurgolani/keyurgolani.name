import 'server-only';
import { recordOwnerModule } from '../load-trace';
import type { Session } from '../session';

// Makes owner sessions. It is owner code, so demo and read-only never load
// it. The composition root hands mintSession() to the auth provider it
// loads, and the dispatcher, authorize(), and the policy treat any session
// it didn't make as none.

recordOwnerModule('server/owner/session-mint');

const MINTED = Symbol.for('keyurgolani.portfolio.minted-sessions');
type Holder = typeof globalThis & { [MINTED]?: WeakSet<object> };

/** A frozen owner session that isMintedSession() accepts, carrying `fields`. */
export function mintSession<T extends object>(fields: T = {} as T): Session & Readonly<T> {
  const session = Object.freeze({ ...fields, kind: 'owner' as const });
  const holder = globalThis as Holder;
  (holder[MINTED] ??= new WeakSet()).add(session);
  return session;
}
