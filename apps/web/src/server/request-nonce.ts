import 'server-only';
import { headers } from 'next/headers';

// The nonce of the Content-Security-Policy proxy.ts puts on a Studio or a
// preview request (#2, #7), for a tag of ours that the policy needs it on:
// the compiled stylesheet of the variant a preview frame renders (#6, Slice
// 2). Next reads the same header for its own scripts and stylesheets. On
// those paths proxy.ts sets it in place of any the client sent, and this
// reads that one header and nothing else of the request.

/** The nonce `policy` names, or undefined when it names none. */
export function policyNonce(policy: string | null | undefined): string | undefined {
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy ?? '')?.[1];
}

/** The nonce of the request's Content-Security-Policy, or undefined. */
export async function requestNonce(): Promise<string | undefined> {
  return policyNonce((await headers()).get('content-security-policy'));
}
