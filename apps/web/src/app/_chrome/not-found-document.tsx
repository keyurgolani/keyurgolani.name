import { getDeploymentState } from '~/server/config-store';
import { getLive } from '~/server/live-revision';
import { NotFoundBody } from './not-found-body';

// The global 404's own document (#2): in the portfolio's language and
// writing direction, as the site's layout renders, around the 404 body, and
// with none of the site's JSON-LD. <html> carries nothing else: the body's
// document boundary is the appearance (#19), so a preview's 404 and the
// site's are the same document. It reads only the live pair's locale and
// direction, and falls back to neutral ones before startup and while the
// catalog can't serve.

/** The live pair's portfolio, as far as the document needs it, or null: the request's own read. */
async function livePair() {
  if (!getDeploymentState()) return null;
  try {
    return (await getLive()).unit;
  } catch {
    return null;
  }
}

/**
 * The document. `nonce` is the one in the request's Content-Security-Policy,
 * which proxy.ts sets on a Studio path and on a preview path, where the
 * boundary's stylesheets carry it.
 */
export async function NotFoundDocument({ nonce }: { readonly nonce?: string }) {
  const pair = await livePair();
  return (
    <html lang={pair?.portfolio?.locale ?? 'en'} dir={pair?.portfolio?.direction ?? 'ltr'}>
      <head />
      <body>{await NotFoundBody({ nonce })}</body>
    </html>
  );
}
