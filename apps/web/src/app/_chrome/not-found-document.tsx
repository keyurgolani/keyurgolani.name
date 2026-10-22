import { themeInitScript } from '@portfolio/kit/theme-init';
import { startingTheme } from '~/lib/starting-theme';
import { getDeploymentState } from '~/server/config-store';
import { getLive } from '~/server/live-revision';
import { NotFoundBody } from './not-found-body';

// The global 404's own document (#2): in the portfolio's language and
// writing direction, with the site's theme script, as the site's layout
// renders, around the 404 body, and with none of the site's JSON-LD. A
// preview's 404 has no theme script (#7). It reads only the live pair's
// locale, direction, and display mode, and falls back to neutral ones before
// startup and while the catalog can't serve.

/** The live pair's portfolio and site, as far as the document needs them, or null: the request's own read. */
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
 * which proxy.ts sets on a Studio path, so the theme script runs there too.
 * A preview's 404 renders without the theme script (`theme: false`), as a
 * preview document does (#7).
 */
export async function NotFoundDocument({
  nonce,
  theme = true,
}: {
  readonly nonce?: string;
  readonly theme?: boolean;
}) {
  const pair = await livePair();
  const displayMode = pair?.site?.appearance?.displayMode;
  // The first paint's theme, as on every site page: the site's display mode.
  const initScript = themeInitScript(displayMode ? startingTheme(displayMode) : 'system');
  return (
    <html
      lang={pair?.portfolio?.locale ?? 'en'}
      dir={pair?.portfolio?.direction ?? 'ltr'}
      suppressHydrationWarning
    >
      <head>
        {theme ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: initScript }} /> : null}
      </head>
      <body>{await NotFoundBody()}</body>
    </html>
  );
}
