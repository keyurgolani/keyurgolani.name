import type { DraftFinding, StudioDraft } from './documents';

// Drafts for the Studio shell's tests (#8, Slice 1), shaped as #3's store
// returns them.

export const DRAFT_ID = `drf_${'a'.repeat(32)}`;
export const OTHER_DRAFT_ID = `drf_${'b'.repeat(32)}`;
export const BASE_REVISION = `rev_${'1'.repeat(32)}`;
export const LIVE_REVISION = `rev_${'2'.repeat(32)}`;

export function draft(
  version: number,
  portfolio = `schemaVersion: 3\n# version ${version}\n`,
  options: {
    readonly draftId?: string;
    readonly diagnostics?: readonly DraftFinding[];
    readonly media?: string;
  } = {},
): StudioDraft {
  return {
    draftId: options.draftId ?? DRAFT_ID,
    version,
    baseRevisionId: BASE_REVISION,
    updatedAt: '2026-10-23T12:00:00.000Z',
    documents: {
      portfolio: { format: 'yaml', sourceText: portfolio, diagnostics: options.diagnostics ?? [] },
      site: { format: 'yaml', sourceText: 'schemaVersion: 2\n', diagnostics: [] },
      ...(options.media === undefined
        ? {}
        : { media: { format: 'yaml', sourceText: options.media, diagnostics: [] } }),
    },
  };
}

export const BLOCKING: DraftFinding = {
  code: 'schema.invalid',
  severity: 'blocks-publish',
  document: 'portfolio',
  pointer: '/identity/name',
  line: 4,
  message: '/identity/name is empty.',
  remediation: 'Give identity.name a value.',
};

export const WARNING: DraftFinding = { ...BLOCKING, code: 'ref.private', severity: 'warning' };
