// The documents Studio edits (#8, Slice 1): the portable portfolio and site
// documents of #3's one working draft, and its media document when it has
// one, as text in their own formats, with the store's findings on them.
// Framework-free and data-only, so the state model, the journal, and the
// backend share it, and a test drives each.
//
// A save replaces the draft's documents whole, so Studio always sends every
// document the draft holds: a media document left out of a save would be
// dropped from the draft.

/** The documents a draft may hold, in the order Studio shows them. Media is optional. */
export const DOCUMENT_NAMES = ['portfolio', 'site', 'media'] as const;
export type DocumentName = (typeof DOCUMENT_NAMES)[number];

export type DocumentFormat = 'yaml' | 'json';

/** One document as Studio sends it: its format and its text, never a parsed model. */
export interface SourceDocument {
  readonly format: DocumentFormat;
  readonly sourceText: string;
}

/** The documents Studio sends: the portfolio and the site, and media when the draft has it. */
export interface SourceDocuments {
  readonly portfolio: SourceDocument;
  readonly site: SourceDocument;
  readonly media?: SourceDocument;
}

/** One of #4's findings on a saved draft, as the store reports it. */
export interface DraftFinding {
  readonly code: string;
  readonly severity: 'blocks-preview' | 'blocks-publish' | 'warning';
  readonly document: string;
  readonly pointer: string;
  readonly stableId?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly remediation: string;
}

/** A draft's document, with the store's findings on it and the model it parsed to, if it did. */
export interface DraftDocument extends SourceDocument {
  readonly diagnostics: readonly DraftFinding[];
  /** What #4 parsed the text to, or null when it didn't parse. Studio reads it, and never writes it back. */
  readonly model?: unknown;
}

/** #3's working draft, as far as Studio reads it. */
export interface StudioDraft {
  readonly draftId: string;
  readonly version: number;
  readonly baseRevisionId: string | null;
  readonly updatedAt: string;
  readonly documents: {
    readonly portfolio: DraftDocument;
    readonly site: DraftDocument;
    readonly media?: DraftDocument;
  };
}

/** The newer draft a draft_conflict carries: its ID, version, and documents, and nothing else. */
export type ConflictingDraft = Pick<StudioDraft, 'draftId' | 'version' | 'documents'>;

/** What live.get says: the revision the pointer names, and the one that serves. */
export interface LiveState {
  readonly state: 'live' | 'degraded' | 'incompatible' | 'empty';
  readonly liveRevisionId: string | null;
  readonly servingRevisionId: string | null;
  readonly seq: number | null;
}

/** The names of the documents `documents` holds, in DOCUMENT_NAMES order. */
export function namesIn(documents: { readonly media?: unknown }): readonly DocumentName[] {
  return DOCUMENT_NAMES.filter((name) => name !== 'media' || documents.media !== undefined);
}

const source = (document: SourceDocument): SourceDocument => ({
  format: document.format,
  sourceText: document.sourceText,
});

/** A draft's documents as Studio sends them back: format and text alone, media included. */
export function sourceOf(draft: StudioDraft): SourceDocuments {
  const { portfolio, site, media } = draft.documents;
  return {
    portfolio: source(portfolio),
    site: source(site),
    ...(media ? { media: source(media) } : {}),
  };
}

/** Whether two sets of documents hold the same documents, in the same formats, with the same text. */
export function sameDocuments(a: SourceDocuments, b: SourceDocuments): boolean {
  return DOCUMENT_NAMES.every((name) => {
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) return left === right;
    return left.format === right.format && left.sourceText === right.sourceText;
  });
}

/** Every finding on a draft's documents, in DOCUMENT_NAMES order. */
export function findingsOf(draft: StudioDraft): readonly DraftFinding[] {
  return namesIn(draft.documents).flatMap((name) => draft.documents[name]?.diagnostics ?? []);
}

/** A revision ID as the owner reads it: `rev_` and its first 12 hex digits. */
export function shortRevision(id: string): string {
  return id.slice(0, 'rev_'.length + 12);
}

/** A document's file name as the owner knows it, such as portfolio.yml. */
export function fileNameOf(name: DocumentName, format: DocumentFormat): string {
  return `${name}.${format === 'yaml' ? 'yml' : 'json'}`;
}
