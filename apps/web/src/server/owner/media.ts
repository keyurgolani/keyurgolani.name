import 'server-only';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import {
  loadSharp,
  localMediaRoot,
  mediaIngestion,
  remoteImageFetcher,
  type AssetStore,
  type MediaIngestion,
} from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';

// Owner's media ingestion (#10, items 5 and 6): what a Studio draft save
// derives with, over the revision store's AssetStore. Local sources resolve
// under PORTFOLIO_MEDIA_ROOT, remote ones through @portfolio/core's checked
// fetcher, and only when the save's session holds media.fetchRemote. Nothing
// here runs on a visitor request, and demo and read-only never load it.
//
// The media.renditions startup requirement loads sharp once: when it won't
// load, as on a platform whose binary is missing, owner starts anyway and
// says so, and draft saves keep every revision they have and derive none.
// A media root the server can write, or that isn't a directory, is a
// warning too.

recordOwnerModule('server/owner/media');

const KEY = 'PORTFOLIO_MEDIA_ROOT';

export function ownerMedia({
  config,
  assets,
}: {
  readonly config: DeploymentConfig;
  readonly assets: AssetStore;
}): MediaIngestion {
  return mediaIngestion({
    assets,
    ...(config.mediaRoot ? { root: localMediaRoot(config.mediaRoot) } : {}),
    fetchRemote: remoteImageFetcher(),
    // Asset IDs, hashes, and codes; never a path or a URL.
    log: (entry) => log({ ...entry }),
  });
}

/** The media.renditions check, with sharp's loader; tests pass one that fails. */
export function mediaCheck(load: typeof loadSharp = loadSharp) {
  return async ({
    config,
  }: {
    readonly config: DeploymentConfig;
  }): Promise<readonly ConfigIssue[]> => {
    const issues: ConfigIssue[] = [];
    const sharp = await load();
    if (!sharp.ok) {
      issues.push({
        severity: 'warning',
        key: 'PORTFOLIO_PROFILE',
        code: 'media_renditions_unavailable',
        message:
          `sharp, which derives image renditions, didn't load here (${sharp.code}). Draft saves ` +
          'derive no new renditions and keep every one they have, and published media keeps ' +
          'serving. Run the image this build ships, or reinstall its dependencies on this platform.',
      });
    }
    if (config.mediaRoot) {
      const found = await stat(config.mediaRoot).catch(() => null);
      if (!found?.isDirectory()) {
        issues.push({
          severity: 'warning',
          key: KEY,
          code: 'media_root_missing',
          message:
            'PORTFOLIO_MEDIA_ROOT names no directory, so no local media source can be read. ' +
            'Mount the media directory there, read-only.',
        });
      } else if (
        await access(config.mediaRoot, constants.W_OK).then(
          () => true,
          () => false,
        )
      ) {
        issues.push({
          severity: 'warning',
          key: KEY,
          code: 'media_root_writable',
          message:
            'The server can write to PORTFOLIO_MEDIA_ROOT. Mount it read-only: the media pipeline ' +
            'only reads it.',
        });
      }
    }
    return issues;
  };
}

export const check = mediaCheck();
