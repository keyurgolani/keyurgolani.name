import {
  detectFormat,
  parseMediaDocument,
  parseSource,
  type MediaDocument,
} from '@portfolio/schema';
import type { MediaFinding, MediaIngestion } from '../catalog/media/ingest';
import { recordOwnerModule } from '../load-trace';
import type { Sha256 } from './layout';
import type { PublicationOutcome } from './publication';
import type { Store } from './store';
import {
  checkUnit,
  importSourceHash,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
} from '../catalog/unit';

// The mounted documents an import reads (#3, item 24): the pair in a source
// directory, PORTFOLIO_SOURCE_DIR or `import --from`, as #4's pair loader
// finds it. Which files hold the pair, and the source.* findings when they
// can't, are #4's (@portfolio/schema/node), which only the composition root
// and the CLI's entry may import, so they pass the reader in. This turns
// what it read into a unit's input and the import's sourceHash, over each
// file's name and the hash of its bytes as read. Owner's first-start import
// goes through here too. An import ingests the pair's media as a draft save
// does (#10): the media document is derived from the portfolio's media
// entries, over the live revision's records, so an unchanged source keeps
// its revision and a lost one keeps its last.

recordOwnerModule('core/store/source');

/** One mounted document as read: its file's name, such as portfolio.yml, and its bytes. */
export interface SourceFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export type SourceRead =
  | {
      readonly ok: true;
      readonly files: { readonly portfolio: SourceFile; readonly site: SourceFile };
    }
  | {
      readonly ok: false;
      /** #4's findings: source.missing, source.duplicate, source.unreadable, legacy.document. */
      readonly diagnostics: readonly UnitDiagnostic[];
      /** Why the directory itself can't be read, when that's the problem. */
      readonly directory?: 'missing' | 'not-directory' | 'unreadable';
    };

/** Reads the pair in a source directory, the way startup finds it. */
export type SourceReader = (dir: string) => SourceRead | Promise<SourceRead>;

export interface MountedSource {
  readonly documents: UnitInput;
  readonly sourceHash: Sha256;
}

/** The unit's input and the import's sourceHash for the files a reader found. */
export function mountedSource(files: {
  readonly portfolio: SourceFile;
  readonly site: SourceFile;
}): MountedSource {
  const document = (file: SourceFile) => ({
    format: detectFormat(file.name),
    sourceText: Buffer.from(
      file.bytes.buffer,
      file.bytes.byteOffset,
      file.bytes.byteLength,
    ).toString('utf8'),
  });
  return {
    documents: { portfolio: document(files.portfolio), site: document(files.site) },
    sourceHash: importSourceHash({
      [files.portfolio.name]: files.portfolio.bytes,
      [files.site.name]: files.site.bytes,
    }),
  };
}

/**
 * What an import of the mounted pair would refuse, checked without the
 * store or its lock: each record, or none when it would go in. Owner's
 * first start runs it before it waits for the lock, so a pair a publish
 * refuses stops startup at once.
 */
export function importRefusal(
  mounted: MountedSource,
  checks: UnitChecks,
): readonly UnitDiagnostic[] {
  const checked = checkUnit(mounted.documents, checks);
  return checked.ok ? [] : checked.diagnostics;
}

/**
 * Owner's first-start import (item 24): the mounted pair as revision 1, by
 * the operator who mounted it. It's a publish, checked as
 * `portfolio-store import` checks one: a site whose variant the build
 * doesn't register is validation_failed with variant.unavailable. It commits only into an empty store: with any
 * revision live, it's live_conflict, and nothing changes.
 */
export function importAtFirstStart(
  store: Store,
  mounted: MountedSource,
): Promise<PublicationOutcome> {
  return store.publication.importSource({ ...mounted, expectedLiveRevisionId: null }, 'operator');
}

/** The live revision's media document, or null when nothing is live or it has none that checks. */
export async function liveMedia(store: Store): Promise<MediaDocument | null> {
  const { liveRevisionId } = await store.publication.status();
  if (liveRevisionId === null) return null;
  const read = await store.revisions.read(liveRevisionId);
  const model = read.ok ? read.revision.unit.media?.model : undefined;
  if (model === undefined || model === null) return null;
  const parsed = parseMediaDocument(model);
  return parsed.ok ? parsed.value : null;
}

export interface MountedMedia {
  /** The mounted pair with its derived media document, when it has any asset. */
  readonly mounted: MountedSource;
  readonly findings: readonly MediaFinding[];
  /** The assets that derived a new revision. */
  readonly derived: readonly string[];
}

/**
 * The mounted pair with the media document an import publishes: ingestion's,
 * from the portfolio's media entries and `previous`, the live revision's.
 * The sourceHash stays the pair's own.
 */
export async function withMountedMedia(
  mounted: MountedSource,
  {
    ingestion,
    previous,
    fetchRemote,
  }: {
    readonly ingestion: MediaIngestion;
    readonly previous: MediaDocument | null;
    readonly fetchRemote: boolean;
  },
): Promise<MountedMedia> {
  const { portfolio, site } = mounted.documents;
  const parsed = parseSource(portfolio.sourceText, portfolio.format);
  const result = await ingestion.ingest({
    portfolio: parsed.ok ? parsed.data : null,
    previous,
    fetchRemote,
  });
  const documents =
    result.document.assets.length > 0
      ? {
          portfolio,
          site,
          media: {
            format: 'json' as const,
            sourceText: `${JSON.stringify(result.document, null, 2)}\n`,
          },
        }
      : { portfolio, site };
  return {
    mounted: { documents, sourceHash: mounted.sourceHash },
    findings: result.findings,
    derived: result.derived,
  };
}
