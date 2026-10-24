import 'server-only';
import { constants } from 'node:fs';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLE_LIMITS,
  verifyBundle,
  type BundleEntry,
  type BundleFiles,
  type BundleProblem,
  type PublicationUnit,
  type Sha256,
  type UnitChecks,
} from '@portfolio/core';
import {
  parseMediaDocument,
  RENDITION_TYPES,
  routedSlugs,
  type PublicView,
} from '@portfolio/schema';
import { compositionFor, REGISTRY } from '~/lib/variants';
import type { ConfigIssue } from '../config';
import type { ServedReference } from '../config-store';
import { viewOf } from '../public-view';

// The demo's read-only reference (#9, Slice 3 items 1, 3, and 7): a full
// export of a published revision, in #3's provisional bundle format 1,
// mounted read-only at PORTFOLIO_REFERENCE_DIR. The composition root loads
// this module under demo alone, once, at startup, and only when the setting
// is set. It opens no store and no data directory, and writes nothing: it
// lists the directory, reads each file once through @portfolio/core's
// store-free verifyBundle(), and keeps in memory what the reference's public
// view serves. A request never reads the mount, so a change there does
// nothing until the server restarts.
//
// Any problem leaves the demo without a reference, with a startup warning
// for each one, and /reference answers 404 throughout: it never serves part
// of one. Visitors get only what #10's resolvePortfolioView keeps, the same
// view the live site goes through, with its renditions under
// /reference/media, and only the renditions it keeps are held. The mount is
// never committed, never in the image, and never fetched from the owner's
// origin.

/** Where the reference's renditions serve. */
export const REFERENCE_MEDIA_BASE = '/reference/media';

/**
 * The most the renditions a reference serves may hold in memory together:
 * 64 MiB, well under the demo container's memory. A reference over it is
 * refused whole, with a warning naming the limit, and the sample still serves.
 */
export const REFERENCE_HELD_BYTES = 64 * 1024 * 1024;

/** A segment under /reference that names the media route, so no page may take it (#9). */
const RESERVED_SLUG = 'media';

const KEY = 'PORTFOLIO_REFERENCE_DIR';
const REMEDIATION =
  'Export the revision again with portfolio-store export-revision, verify it, and mount the whole export unchanged. The demo reads it once, at startup.';

export interface OpenReferenceInput {
  /** Absolute PORTFOLIO_REFERENCE_DIR. */
  readonly dir: string;
  /** The build's checks, without the deployment's origin: the reference's links were checked on its own. */
  readonly checks: UnitChecks;
  /** Tests' limit on the held renditions. */
  readonly heldBytes?: number;
}

export type OpenReferenceResult =
  | { readonly ok: true; readonly reference: ServedReference; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

/** `dir` as verifyBundle()'s port: listed with lstat, every file opened without following a link. */
export function directoryFiles(dir: string): BundleFiles {
  return {
    async list() {
      const entries: BundleEntry[] = [];
      const walk = async (relative: string): Promise<void> => {
        const names = await readdir(path.join(/*turbopackIgnore: true*/ dir, relative));
        for (const name of names.sort()) {
          // Past the file limit, the verifier refuses it anyway: stop listing.
          if (entries.length > BUNDLE_LIMITS.files) return;
          const file = relative === '' ? name : `${relative}/${name}`;
          const found = await lstat(path.join(/*turbopackIgnore: true*/ dir, file));
          if (found.isDirectory()) await walk(file);
          else
            entries.push({ path: file, type: found.isFile() ? 'file' : 'other', size: found.size });
        }
      };
      await walk('');
      return entries;
    },
    async read(file, limit) {
      const handle = await open(
        path.join(/*turbopackIgnore: true*/ dir, ...file.split('/')),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Not a regular file.');
        const chunks: Buffer[] = [];
        let length = 0;
        // One byte past the limit, so a file that grew past it shows.
        while (length <= limit) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
          if (bytesRead === 0) break;
          chunks.push(chunk.subarray(0, bytesRead));
          length += bytesRead;
        }
        return new Uint8Array(Buffer.concat(chunks, length));
      } finally {
        await handle.close();
      }
    },
  };
}

/** The rendition blobs `view` serves, as resolveRendition() would find them. */
export function servedRenditions(view: PublicView, media: unknown): Map<Sha256, number> {
  const kept = new Map<Sha256, number>();
  const parsed = parseMediaDocument(media);
  if (!parsed.ok) return kept;
  const visible = new Set(Object.keys(view.media));
  for (const record of parsed.value.assets) {
    if (!visible.has(record.assetId)) continue;
    for (const rendition of record.renditions) {
      if (rendition.sha256 === record.sha256) continue;
      if (!(RENDITION_TYPES as readonly string[]).includes(rendition.mime)) continue;
      kept.set(`sha256:${rendition.sha256}`, rendition.bytes);
    }
  }
  return kept;
}

/** Verifies the reference at `dir` and freezes what the demo serves of it, or says why it can't. */
export async function openReference({
  dir,
  checks,
  heldBytes = REFERENCE_HELD_BYTES,
}: OpenReferenceInput): Promise<OpenReferenceResult> {
  try {
    if (!(await stat(dir)).isDirectory()) return refused([{ code: 'reference_unreadable' }]);
  } catch {
    return refused([{ code: 'reference_unreadable' }]);
  }
  // The view is built once, from the verified unit, and serves every request.
  let built: { readonly unit: PublicationUnit; readonly view: PublicView } | undefined;
  const viewFor = (unit: PublicationUnit) => {
    if (built?.unit !== unit)
      built = { unit, view: viewOf(unit, unit.media, REFERENCE_MEDIA_BASE) };
    return built.view;
  };
  let verified;
  try {
    verified = await verifyBundle(directoryFiles(dir), {
      checks,
      keep: (unit) => new Set(servedRenditions(viewFor(unit), unit.media).keys()),
      heldBytes,
    });
  } catch {
    // A view that doesn't build, or a read that failed in a way the port didn't say.
    return refused([{ code: 'reference_does_not_serve' }]);
  }
  if (!verified.ok) {
    return refused(verified.problems.map((problem) => fromProblem(problem)));
  }
  const { unit, blobs, bundle } = verified;
  const view = viewFor(unit);
  // Each rendition the view serves holds the bytes its record says, so no
  // response's length is another's.
  for (const [hash, bytes] of servedRenditions(view, unit.media)) {
    if (blobs.get(hash)?.byteLength !== bytes) {
      return refused([{ code: 'reference_does_not_serve', file: 'media/media.json' }]);
    }
  }
  const caseStudies = routedSlugs(view);
  if (caseStudies.has(RESERVED_SLUG)) {
    return refused([{ code: 'reference_route_reserved', document: 'portfolio' }]);
  }
  const reference: ServedReference = Object.freeze({
    revisionId: bundle.revisionId,
    unit,
    view,
    media: unit.media,
    composition: compositionFor(unit.site.appearance.variant, REGISTRY).rendered.manifest.id,
    caseStudies: new Set(caseStudies),
    blob: (hash: Sha256) => blobs.get(hash),
  });
  return { ok: true, reference, issues: [] };
}

interface Found {
  readonly code: string;
  readonly file?: string;
  readonly document?: ConfigIssue['document'];
  readonly path?: string;
  readonly limit?: number;
}

const MESSAGES: Readonly<Record<string, string>> = {
  reference_unreadable: `${KEY} names no directory the server can read.`,
  reference_bundle_unreadable:
    'The reference has no bundle.json this build reads: a full export in bundle format 1.',
  reference_file_missing: 'A file bundle.json lists is missing, or not a file the server can read.',
  reference_unexpected_file:
    "The reference holds a file bundle.json doesn't list, or a link or special file.",
  reference_hash_mismatch: "A file's bytes don't match the hash or size bundle.json gives it.",
  reference_unit_hash_mismatch: "The files' hashes don't make the unitHash bundle.json gives.",
  reference_content_hash_mismatch:
    'A document means something else under this build than when it was exported.',
  reference_does_not_serve: "The reference doesn't serve under this build.",
  reference_blob_unlisted:
    "A rendition the reference's public view shows has no blob in bundle.json.",
  reference_route_reserved:
    'A case study in the reference has the slug media, which names the reference media route.',
};

function fromProblem(problem: BundleProblem): Found {
  const document = problem.diagnostic?.document;
  return {
    code: `reference_${problem.code}`,
    ...(problem.path === undefined ? {} : { file: problem.path }),
    ...(document === 'portfolio' ||
    document === 'site' ||
    document === 'media' ||
    document === 'snapshots'
      ? { document }
      : {}),
    ...(problem.diagnostic ? { path: problem.diagnostic.pointer } : {}),
    ...(problem.limit === undefined ? {} : { limit: problem.limit }),
  };
}

const MIB = 1024 * 1024;

/** A limit as the warning names it: files, MiB, or bytes. */
function describeLimit(limit: number | undefined): string {
  if (limit === undefined) return 'its size';
  if (limit === BUNDLE_LIMITS.files) return `${limit} files`;
  return limit % MIB === 0 ? `${limit / MIB} MiB` : `${limit} bytes`;
}

/** At most this many findings, then the one that says the demo starts without it. */
const MOST = 20;

function refused(found: readonly Found[]): OpenReferenceResult {
  const issues: ConfigIssue[] = found.slice(0, MOST).map(({ code, limit, ...rest }) => ({
    severity: 'warning',
    key: KEY,
    code,
    message:
      code === 'reference_too_large'
        ? `The reference is over a limit: ${describeLimit(limit)}.`
        : (MESSAGES[code] ?? "The reference doesn't verify."),
    remediation: REMEDIATION,
    ...rest,
  }));
  issues.push({
    severity: 'warning',
    key: KEY,
    code: 'reference_unavailable',
    message:
      'The demo starts without the reference: /reference answers 404 until a restart reads one that verifies.',
    remediation: REMEDIATION,
  });
  return { ok: false, issues };
}
