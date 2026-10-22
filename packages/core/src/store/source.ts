import { detectFormat } from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import type { Sha256 } from './layout';
import { importSourceHash, type UnitDiagnostic, type UnitInput } from '../catalog/unit';

// The mounted documents an import reads (#3, item 24): the pair in a source
// directory, PORTFOLIO_SOURCE_DIR or `import --from`, as #4's pair loader
// finds it. Which files hold the pair, and the source.* findings when they
// can't, are #4's (@portfolio/schema/node), which only the composition root
// and the CLI's entry may import, so they pass the reader in. This turns
// what it read into a unit's input and the import's sourceHash, over each
// file's name and the hash of its bytes as read. Until #10 there is no media
// document: the ./assets mount stays outside the store.

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
