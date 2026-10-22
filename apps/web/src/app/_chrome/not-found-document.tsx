import { themeInitScript } from '@portfolio/kit';
import { startingTheme } from '~/lib/starting-theme';
import { getDeploymentState } from '~/server/config-store';
import { NotFoundBody } from './not-found-body';

// The global 404's own document (#2): in the portfolio's language and
// writing direction, with the site's theme script, as the site's layout
// renders, around the 404 body, and with none of the site's JSON-LD. It reads
// only the live pair's locale, direction, and display mode, and falls back to
// neutral ones before startup and while the catalog can't serve.

/** The live pair's portfolio and site, as far as the document needs them, or null. */
async function livePair() {
  const state = getDeploymentState();
  if (!state) return null;
  try {
    return (await state.catalog.getLive()).unit;
  } catch {
    return null;
  }
}

/**
 * The document. `nonce` is the one in the request's Content-Security-Policy,
 * which proxy.ts sets on a Studio path, so the theme script runs there too.
 */
export async function NotFoundDocument({ nonce }: { readonly nonce?: string }) {
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
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>{await NotFoundBody()}</body>
    </html>
  );
}
