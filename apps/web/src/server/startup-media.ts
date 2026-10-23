import 'server-only';
import {
  deriveStartupMedia,
  localMediaRoot,
  remoteImageFetcher,
  type StartupMedia,
  type StartupMediaOptions,
} from '@portfolio/core';
import { isPlainObject } from '@portfolio/schema';
import type { CatalogReader } from '@portfolio/core';
import type { Profile } from './capabilities';
import { log } from './log';

// Startup media derivation for read-only and demo (#10, slice 2 item 3,
// Risk 3). Once the server has started, it derives the pair's media
// document into the media cache, in the background, so it never holds up
// startup or a visitor request: read-only from PORTFOLIO_MEDIA_ROOT, with
// its https sources fetched; demo from the bundled sample's media, fetching
// nothing. Each asset revision's hash goes to the log (media.startup.asset),
// so a changed file shows on the next start. Owner never derives here: its
// media comes from draft saves and imports, into its AssetStore.
//
// No route serves the cache yet, so the view doesn't take the derived
// document either: an image renders as unavailable, as before, rather than
// pointing at a rendition nothing answers. The /media route reads it from
// startupMedia() once it lands.

export interface StartupMediaInput {
  readonly profile: Profile;
  /** What serves: read-only's mounted pair, or demo's sample. */
  readonly reader: CatalogReader;
  /** PORTFOLIO_MEDIA_ROOT (read-only). */
  readonly mediaRoot?: string;
  /** The bundled sample's media directory (demo). */
  readonly sampleMedia?: string;
  /** Tests' cache, fetcher, and sharp. */
  readonly options?: Partial<
    Pick<StartupMediaOptions, 'cacheDir' | 'fetchRemote' | 'sharp' | 'now'>
  >;
}

const SLOT = Symbol.for('keyurgolani.portfolio.startup-media');
type Holder = typeof globalThis & { [SLOT]?: Promise<StartupMedia | null> };

/** The startup derivation this process started, if it started one. */
export function startupMedia(): Promise<StartupMedia | null> | undefined {
  return (globalThis as Holder)[SLOT];
}

/** Whether a portfolio model names an https media source. */
function namesRemote(portfolio: unknown): boolean {
  const media = isPlainObject(portfolio) ? portfolio.media : undefined;
  return (
    Array.isArray(media) &&
    media.some((item) => isPlainObject(item) && /^https:/i.test(String(item.source ?? '')))
  );
}

/**
 * Starts the derivation for read-only or demo and returns it, settling to
 * null when there is nothing to derive from or it fails. It never throws.
 */
export function startStartupMedia(input: StartupMediaInput): Promise<StartupMedia | null> {
  const running = derive(input).catch((error: unknown) => {
    log({
      level: 'warn',
      event: 'media.startup.failed',
      code: String((error as { code?: unknown })?.code ?? 'derivation_failed'),
    });
    return null;
  });
  (globalThis as Holder)[SLOT] = running;
  return running;
}

async function derive({
  profile,
  reader,
  mediaRoot,
  sampleMedia,
  options = {},
}: StartupMediaInput): Promise<StartupMedia | null> {
  if (profile !== 'read-only' && profile !== 'demo') return null;
  const live = await reader.getLive();
  const portfolio = live.unit?.portfolio;
  const root = profile === 'demo' ? sampleMedia : mediaRoot;
  // demo fetches nothing; read-only fetches its https sources.
  const fetches = profile === 'read-only' && namesRemote(portfolio);
  if (!root && !fetches) {
    log({ level: 'info', event: 'media.startup.skipped', code: 'no_media_source' });
    return null;
  }
  const { fetchRemote, ...rest } = options;
  const derived = await deriveStartupMedia({
    portfolio,
    ...(root ? { root: localMediaRoot(root) } : {}),
    ...(fetches ? { fetchRemote: fetchRemote ?? remoteImageFetcher() } : {}),
    ...rest,
    log: (entry) => log({ ...entry }),
  });
  log({ level: 'info', event: 'media.startup.derived', count: derived.document.assets.length });
  return derived;
}
