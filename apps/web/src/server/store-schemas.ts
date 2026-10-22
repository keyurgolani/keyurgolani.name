import { z } from 'zod';

// The schemas of the revision store's registry entries (#3, item 22), which
// operations.ts lists: data only, so loading them never loads owner code.
// Each input is strict, so a document key, an edit, or a field the store
// doesn't take is a 400 before the store sees it. Each output names every
// field that may leave the server. An owner session's 409 or 422 carries
// its code's payload in `error.details` once it passes the schema here (#3,
// item 12, amending #1 item 5).

const Instant = z.string().datetime();

/** A revision's ID in the store (#3): `rev_` and 32 hex digits. */
export const RevisionIdSchema = z.string().regex(/^rev_[0-9a-f]{32}$/);
/** A draft's ID: `drf_` and 32 hex digits. */
export const DraftIdSchema = z.string().regex(/^drf_[0-9a-f]{32}$/);
/** A SHA-256 digest as the store writes one. */
export const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const ServingStateSchema = z.enum(['live', 'degraded', 'incompatible', 'empty']);

const Actor = z.enum(['owner', 'operator']);
const Version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const Reason = z.string().max(500);
const Format = z.enum(['yaml', 'json']);
const DocumentNameSchema = z.enum(['portfolio', 'site', 'media']);

/** A count in a query's search parameters: digits, with no sign, space, or leading zero. */
const Count = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,8})$/)
  .transform(Number);
/** How many a page holds: 1 to 100, 50 by default. */
export const PAGE_LIMIT = Object.freeze({ default: 50, max: 100 });
/** A page of a list: `limit` items from `offset`. */
export const PageInput = z
  .object({
    offset: Count.optional(),
    limit: Count.refine((limit) => limit >= 1 && limit <= PAGE_LIMIT.max).optional(),
  })
  .strict();

/** One of #4's findings, or the store's own on the media document. */
const DiagnosticSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['blocks-preview', 'blocks-publish', 'warning']),
    document: DocumentNameSchema,
    pointer: z.string(),
    stableId: z.string().optional(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    message: z.string(),
    remediation: z.string(),
  })
  .strict();

/** A document as Studio sends it. */
const DocumentInput = z.object({ format: Format, sourceText: z.string() }).strict();
export const DocumentsInput = z
  .object({ portfolio: DocumentInput, site: DocumentInput, media: DocumentInput.optional() })
  .strict();

/** One edit by JSON pointer, as #4's applyEdits takes it. */
export const EditsInput = z
  .array(
    z
      .object({
        document: DocumentNameSchema,
        pointer: z.string().max(4096),
        op: z.enum(['set', 'delete']),
        value: z.unknown().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(1000);

const DraftDocumentSchema = z
  .object({
    format: Format,
    sourceText: z.string(),
    model: z.unknown(),
    diagnostics: z.array(DiagnosticSchema),
  })
  .strict();
const DraftDocumentsSchema = z
  .object({
    portfolio: DraftDocumentSchema,
    site: DraftDocumentSchema,
    media: DraftDocumentSchema.optional(),
  })
  .strict();
export const DraftSchema = z
  .object({
    draftFormat: z.literal(1),
    draftId: DraftIdSchema,
    version: Version,
    baseRevisionId: RevisionIdSchema.nullable(),
    createdAt: Instant,
    updatedAt: Instant,
    updatedBy: Actor,
    sourceHash: Sha256Schema.optional(),
    documents: DraftDocumentsSchema,
  })
  .strict();

const ManifestDocumentSchema = z
  .object({
    file: z.string().regex(/^(?:portfolio|site|media)\.(?:yml|json)$/),
    format: Format,
    schemaVersion: z.number().int().nullable(),
    sourceHash: Sha256Schema,
    contentHash: Sha256Schema,
  })
  .strict();
const Versioned = z.object({ id: z.string(), version: z.string() }).strict();
const ManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    revisionId: RevisionIdSchema,
    parentRevisionId: RevisionIdSchema.nullable(),
    createdAt: Instant,
    createdBy: Actor,
    source: z.union([
      z
        .object({
          kind: z.literal('draft'),
          draftId: DraftIdSchema,
          draftVersion: Version,
          sourceHash: Sha256Schema.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('import'), sourceHash: Sha256Schema }).strict(),
    ]),
    appVersion: z.string(),
    documents: z
      .object({
        portfolio: ManifestDocumentSchema,
        site: ManifestDocumentSchema,
        media: ManifestDocumentSchema.optional(),
      })
      .strict(),
    snapshots: z.record(
      z
        .object({
          file: z.string().regex(/^[a-z][a-z0-9-]{0,63}\.json$/),
          contentHash: Sha256Schema,
        })
        .strict(),
    ),
    unitHash: Sha256Schema,
    rendering: z
      .object({
        variant: Versioned.nullable(),
        packs: z.array(Versioned),
        contracts: z.record(z.string()),
      })
      .strict(),
    blobs: z.array(Sha256Schema),
  })
  .strict();

/** Why a revision can't be made live or served: damage, finding codes, or `removed`. Never a path. */
const HealthReason = z.string().regex(/^[A-Za-z0-9_.:,-]{1,500}$/);

const RevisionSummarySchema = z
  .object({
    revisionId: RevisionIdSchema,
    seq: z.number().int().min(1).optional(),
    createdAt: Instant.nullable(),
    createdBy: Actor.nullable(),
    compatible: z.boolean(),
    reason: HealthReason.optional(),
  })
  .strict();

const RevisionDocumentSchema = z
  .object({ format: Format, sourceText: z.string(), model: z.unknown() })
  .strict();
/** revision.get: the summary, the manifest, and each document's text and normalized model. */
export const RevisionDetailSchema = RevisionSummarySchema.extend({
  manifest: ManifestSchema,
  documents: z
    .object({
      portfolio: RevisionDocumentSchema,
      site: RevisionDocumentSchema,
      media: RevisionDocumentSchema.optional(),
    })
    .strict(),
}).strict();

const EventSchema = z
  .object({
    seq: z.number().int().min(1),
    type: z.enum(['import', 'publish', 'rollback', 'recover', 'schema-migration']),
    revisionId: RevisionIdSchema,
    previousRevisionId: RevisionIdSchema.nullable(),
    actor: Actor,
    at: Instant,
    reason: Reason.optional(),
    idempotencyKey: IdempotencyKey.optional(),
    sourceHash: Sha256Schema.optional(),
    restoredFrom: RevisionIdSchema.optional(),
  })
  .strict();

const NextOffset = z.number().int().min(1).nullable();
export const RevisionListSchema = z
  .object({ revisions: z.array(RevisionSummarySchema).max(PAGE_LIMIT.max), nextOffset: NextOffset })
  .strict();
export const HistoryListSchema = z
  .object({ events: z.array(EventSchema).max(PAGE_LIMIT.max), nextOffset: NextOffset })
  .strict();

/** live.get: what the pointer names, and what serves. */
export const LiveSchema = z
  .object({
    state: ServingStateSchema,
    liveRevisionId: RevisionIdSchema.nullable(),
    servingRevisionId: RevisionIdSchema.nullable(),
    seq: z.number().int().min(1).nullable(),
    unitHash: Sha256Schema.nullable(),
  })
  .strict();

export const CommittedSchema = z
  .object({ revisionId: RevisionIdSchema, seq: z.number().int().min(1) })
  .strict();
export const DraftOutputSchema = z.object({ draft: DraftSchema }).strict();

// Inputs.
export const DraftCreateInput = z
  .object({ expectedVersion: Version.optional(), fromRevisionId: RevisionIdSchema.optional() })
  .strict();
/** draft.importSource: the working draft's version it replaces, while there is one. */
export const DraftImportInput = z.object({ expectedVersion: Version.optional() }).strict();
export const DraftSaveInput = z
  .object({ draftId: DraftIdSchema, expectedVersion: Version, documents: DocumentsInput })
  .strict();
export const DraftEditsInput = z
  .object({ draftId: DraftIdSchema, expectedVersion: Version, edits: EditsInput })
  .strict();
export const DraftRebaseInput = z
  .object({
    draftId: DraftIdSchema,
    expectedVersion: Version,
    documents: DocumentsInput,
    baseRevisionId: RevisionIdSchema.nullable(),
  })
  .strict();
export const DraftDiscardInput = z
  .object({ draftId: DraftIdSchema, expectedVersion: Version.optional() })
  .strict();
export const PublishInputSchema = z
  .object({
    draftId: DraftIdSchema,
    draftVersion: Version,
    expectedLiveRevisionId: RevisionIdSchema.nullable(),
    idempotencyKey: IdempotencyKey.optional(),
  })
  .strict();
/** rollback's, and recover's, whose target defaults to the last known good. */
export function moveInput(target: 'required' | 'optional') {
  return z
    .object({
      targetRevisionId: target === 'required' ? RevisionIdSchema : RevisionIdSchema.optional(),
      expectedLiveRevisionId: RevisionIdSchema.nullable(),
      idempotencyKey: IdempotencyKey.optional(),
      reason: Reason.optional(),
    })
    .strict();
}

// The payloads in error.details, by code.
export const LiveConflictDetails = z
  .object({
    liveRevisionId: RevisionIdSchema.nullable(),
    baseHash: Sha256Schema.nullable(),
    liveHash: Sha256Schema.nullable(),
    draftHash: Sha256Schema.nullable().optional(),
  })
  .strict();
export const DraftConflictDetails = z
  .object({ draftId: DraftIdSchema, version: Version, documents: DraftDocumentsSchema })
  .strict();
export const DiagnosticsDetails = z.object({ diagnostics: z.array(DiagnosticSchema) }).strict();
export const AssetMissingDetails = z.object({ blobs: z.array(Sha256Schema) }).strict();
export const IncompatibleDetails = z
  .object({
    reason: HealthReason,
    command: z
      .string()
      .regex(/^(?:rollback|recover) --to rev_[0-9a-f]{32}$/)
      .optional(),
    diagnostics: z.array(DiagnosticSchema),
  })
  .strict();
