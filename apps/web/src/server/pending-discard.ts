import 'server-only';
import { headers } from 'next/headers';
import {
  discardMarkerAt,
  discardMarkerName,
  type PendingDiscard,
} from '~/lib/studio/discard-marker';
import { requireDeploymentConfig } from './config-store';
import { readCookies, sessionCookieName } from './session-cookie';

// The pending discard a Studio page hands its script as it renders (row 88c-RC2, the coordinator's
// ruling, 2026-11-10): the HttpOnly marker's value, the sign-out's time, and the time this page
// rendered at, from which the script takes its own clock's skew. A page reads only its own mode's
// name, as the session cookie is read (server/session-cookie.ts): over https a plain
// studio_discard is a cookie a sibling origin could set, and a far-future time in it would prune
// every unsaved draft. Two markers of the mode's name hold one somebody else set: neither counts.
// It reads a request cookie and holds no owner state, so it's no owner module: /studio's page, which
// demo serves too, loads it, and demo's owner load trace stays empty (server/owner/trace.test.ts).

/** The pending discard `request` carries for the canonical `origin`'s mode; else null. */
export function pendingDiscardOf(
  request: Pick<Request, 'headers'>,
  origin: string,
  now: number,
): PendingDiscard | null {
  const name = discardMarkerName(sessionCookieName(origin) === '__Host-studio_session');
  const sent = readCookies(request, name);
  if (sent.length !== 1) return null;
  const at = discardMarkerAt(sent[0]);
  return at === null ? null : { at, renderedAt: now };
}

/** The request's pending discard, read server-side as the page renders; else null. */
export async function pendingDiscard(): Promise<PendingDiscard | null> {
  return pendingDiscardOf(
    { headers: await headers() },
    requireDeploymentConfig().origin,
    Date.now(),
  );
}
