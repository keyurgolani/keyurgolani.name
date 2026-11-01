// The site's name as Studio's top bar tags it (round 4, P2-9).
/** A loopback or bare address, which names a machine, not a site. */
const ADDRESS = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[0-9a-f:]+:[0-9a-f:]*)$/i;

/**
 * The site's name for the top bar (P2-9): its host, as keyurgolani.name, or,
 * where the host is only an address, as on 127.0.0.1, the portfolio's own name.
 */
export function siteName(
  host: string,
  from:
    { readonly documents: { readonly portfolio: { readonly model?: unknown } } } | null | undefined,
): string {
  if (host !== '' && !ADDRESS.test(host)) return host;
  const identity = (
    from?.documents.portfolio.model as { identity?: { name?: unknown } } | undefined
  )?.identity;
  return typeof identity?.name === 'string' && identity.name.trim() !== '' ? identity.name : host;
}
