import { z } from 'zod';
import { isSectionId } from './ids';
import { isPlainObject, plainJsonProblem } from './json';
import { describeIssue } from './load';
import { TimestampSchema } from './timestamp';
import { redactedPointer, redactSecrets } from './secrets';
import { parseSource } from './source';
import { isAllowedUrl } from './url';

// Source snapshots (#10, items 3 and 4): publish-frozen data from outside the
// documents, one JSON file per kind at snapshots/<kind>.json beside the two
// documents. Renderers read only these, never a source at request time.
// Slice 1 knows two kinds: `github` (slice 3 item 1's adapter records) and
// `urls` (the redirect table). Any other kind is kept as plain JSON. Pure and
// browser-safe: the file reader is in @portfolio/schema/node.

/** A snapshot kind, the file's name without .json. */
export const SNAPSHOT_KIND_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Whether a name is a snapshot kind. */
export function isSnapshotKind(name: string): boolean {
  return name.length <= 64 && SNAPSHOT_KIND_PATTERN.test(name);
}

/** The kinds this build checks. Every other kind is kept, unchecked, as plain JSON. */
export const KNOWN_SNAPSHOT_KINDS = ['github', 'urls'] as const;
export type KnownSnapshotKind = (typeof KNOWN_SNAPSHOT_KINDS)[number];

// --- GitHub ----------------------------------------------------------------

/** An https URL, safe to render as a link. */
const HttpsUrl = z.string().refine((value) => /^https:\/\//i.test(value) && isAllowedUrl(value), {
  message: 'must be an https URL.',
});
const Count = z.number().finite().int().nonnegative();
const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'must be a #rrggbb color.' })
  .nullable();
const Name = z.string().min(1).max(256);

/** One day of the contribution calendar. */
export const ContributionDaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a YYYY-MM-DD date.' }),
    count: Count,
    level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  })
  .strict();

export const PinnedRepoSchema = z
  .object({
    name: Name,
    description: z.string().max(2048),
    url: HttpsUrl,
    stars: Count,
    forks: Count,
    language: Name.nullable(),
    languageColor: Color,
  })
  .strict();

export const RecentlyActiveRepoSchema = z
  .object({
    name: Name,
    url: HttpsUrl,
    description: z.string().max(2048).nullable(),
    language: Name.nullable(),
    languageColor: Color,
    stars: Count,
    pushedAt: TimestampSchema,
    isFork: z.boolean(),
  })
  .strict();

export const LanguageBreakdownEntrySchema = z
  .object({
    language: Name,
    color: Color,
    bytes: Count,
    share: z.number().finite().min(0).max(1),
  })
  .strict();

/**
 * What the GitHub section shows, as the adapter froze it: the shape the kit's
 * GitHub section renders (`packages/kit/src/github/types.ts`), without its
 * fetchedAt, which the record carries.
 */
export const GitHubSnapshotDataSchema = z
  .object({
    username: Name,
    profileUrl: HttpsUrl,
    /** `graphql` when the refresh had a token, `rest` otherwise. */
    source: z.enum(['graphql', 'rest']),
    totalRepos: Count,
    totalStarsReceived: Count,
    starsGiven: Count.nullable(),
    contributionsLastYear: Count.nullable(),
    pinnedRepos: z.array(PinnedRepoSchema).max(100),
    recentlyActive: z.array(RecentlyActiveRepoSchema).max(100),
    contributionCalendar: z.array(ContributionDaySchema).max(400),
    languageBreakdown: z.array(LanguageBreakdownEntrySchema).max(100),
  })
  .strict();

export type GitHubSnapshotData = z.infer<typeof GitHubSnapshotDataSchema>;
export type ContributionDay = z.infer<typeof ContributionDaySchema>;
export type PinnedRepo = z.infer<typeof PinnedRepoSchema>;
export type RecentlyActiveRepo = z.infer<typeof RecentlyActiveRepoSchema>;
export type LanguageBreakdownEntry = z.infer<typeof LanguageBreakdownEntrySchema>;

/** What a GitHub section renders: the snapshot's data, with the time it was fetched. */
export type GitHubData = GitHubSnapshotData & { readonly fetchedAt: string };

/** One adapter record (#10, slice 3 item 1): what one refresh froze for one section. */
export interface SnapshotRecord<T> {
  /** The adapter's id, which is the snapshot's kind. */
  readonly adapter: string;
  /** The section the record is for. */
  readonly sectionId: string;
  readonly data: T;
  /** When the adapter fetched it, as an ISO 8601 timestamp. */
  readonly fetchedAt: string;
}

/** snapshots/github.json: one record per GitHub section. */
export interface GitHubSnapshot {
  readonly records: readonly SnapshotRecord<GitHubSnapshotData>[];
}

export const GitHubSnapshotSchema = z
  .object({
    records: z.array(
      z
        .object({
          adapter: z.literal('github'),
          sectionId: z.string().refine(isSectionId, {
            message: "must be the GitHub section's id.",
          }),
          data: GitHubSnapshotDataSchema,
          fetchedAt: TimestampSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const seen = new Set<string>();
    snapshot.records.forEach((record, index) => {
      if (seen.has(record.sectionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['records', index, 'sectionId'],
          message: 'repeats an earlier record: a snapshot holds one record per section.',
        });
      }
      seen.add(record.sectionId);
    });
  }) as z.ZodType<GitHubSnapshot, z.ZodTypeDef, unknown>;

// --- URLs --------------------------------------------------------------------

/** A path on the site, such as /work/tidewater-atlas: no origin, query, or fragment. */
export function isSitePath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 2048) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return !/[\\?#]/.test(value);
}

const SitePath = z.string().refine(isSitePath, {
  message: 'must be a path on the site, such as /work/tidewater-atlas, with no query or fragment.',
});

/**
 * snapshots/urls.json (#10, item 4): the accumulated redirect table and gone
 * list a publish freezes. Each redirect is one hop, to a canonical URL of the
 * revision; a gone URL answers 410. Paths only, no origin.
 */
export interface UrlTable {
  readonly redirects: Readonly<Record<string, string>>;
  readonly gone: readonly string[];
}

export const UrlTableSchema = z
  .object({
    redirects: z.record(SitePath, SitePath),
    gone: z.array(SitePath),
  })
  .strict()
  .superRefine((table, ctx) => {
    const gone = new Set<string>();
    table.gone.forEach((path, index) => {
      if (gone.has(path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['gone', index],
          message: 'repeats an earlier path.',
        });
      }
      gone.add(path);
    });
    for (const [from, to] of Object.entries(table.redirects)) {
      if (from === to) {
        ctx.addIssue({
          code: 'custom',
          path: ['redirects', from],
          message: 'redirects to itself.',
        });
      } else if (Object.hasOwn(table.redirects, to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['redirects', from],
          message: 'redirects to a path that redirects again. Each redirect is one hop.',
        });
      }
      if (gone.has(from)) {
        ctx.addIssue({
          code: 'custom',
          path: ['redirects', from],
          message: 'is also in gone. A path redirects or is gone, not both.',
        });
      }
    }
  }) as z.ZodType<UrlTable, z.ZodTypeDef, unknown>;

// --- Parsing -------------------------------------------------------------------

/** The snapshots a unit holds, by kind, once parsed: the known kinds typed, the rest as plain JSON. */
export interface SourceSnapshots {
  readonly github?: GitHubSnapshot;
  readonly urls?: UrlTable;
  readonly [kind: string]: unknown;
}

/** Why a snapshot or media file doesn't read. Never quotes the file. */
export interface UnitFileProblem {
  /** `syntax`: not one plain JSON document within the limits. `schema`: a known kind's data doesn't match. */
  readonly kind: 'syntax' | 'schema';
  readonly code: string;
  readonly pointer?: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export type UnitFileResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly UnitFileProblem[] };

const SCHEMAS: Readonly<Record<KnownSnapshotKind, z.ZodTypeAny>> = {
  github: GitHubSnapshotSchema,
  urls: UrlTableSchema,
};

/**
 * One snapshot's data, checked for its kind: a known kind against its schema,
 * any other as plain JSON. Pure: data in, typed data or problems out.
 */
export function parseSnapshot(kind: string, data: unknown): UnitFileResult<unknown> {
  if (!isSnapshotKind(kind)) {
    return {
      ok: false,
      problems: [
        {
          kind: 'schema',
          code: 'invalid_kind',
          message:
            'The snapshot kind must be lowercase letters, digits, and hyphens, such as github.',
        },
      ],
    };
  }
  const schema = (SCHEMAS as Record<string, z.ZodTypeAny | undefined>)[kind];
  if (!schema) {
    return plainJsonProblem(data, 64) === null
      ? { ok: true, value: data }
      : {
          ok: false,
          problems: [
            { kind: 'schema', code: 'not_json', message: "The snapshot isn't plain JSON." },
          ],
        };
  }
  return checked(schema, data);
}

/**
 * A snapshot file's text, as the file readers call it: one plain JSON
 * document within #4's limits (1 MiB, 64 levels, 10,000 entries per
 * collection), then the data checked for its kind. Problems carry line and
 * column, never the file's text.
 */
export function parseSnapshotText(kind: string, text: string): UnitFileResult<unknown> {
  return parseJsonFile(text, (data) => parseSnapshot(kind, data));
}

/**
 * The snapshots of a unit, as the store and the readers hold them (plain
 * JSON by kind), with the known kinds checked. Kinds that don't check are
 * left out of `snapshots` and listed in `invalid`.
 */
export function readSourceSnapshots(raw: Readonly<Record<string, unknown>> | undefined): {
  readonly snapshots: SourceSnapshots;
  readonly invalid: readonly string[];
} {
  const snapshots: Record<string, unknown> = {};
  const invalid: string[] = [];
  if (!isPlainObject(raw)) return { snapshots, invalid };
  for (const [kind, data] of Object.entries(raw)) {
    const result = parseSnapshot(kind, data);
    if (result.ok) {
      Object.defineProperty(snapshots, kind, {
        value: result.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      invalid.push(kind);
    }
  }
  return { snapshots: snapshots as SourceSnapshots, invalid: invalid.sort() };
}

/** JSON text through #4's pre-parse guards, then `check`. Shared with the media document reader. */
export function parseJsonFile<T>(
  text: string,
  check: (data: unknown) => UnitFileResult<T>,
): UnitFileResult<T> {
  const parsed = parseSource(text, 'json');
  if (!parsed.ok) {
    return {
      ok: false,
      problems: parsed.problems.map((problem) => ({
        kind: 'syntax',
        code: problem.code,
        message: problem.message,
        ...(problem.line !== undefined ? { line: problem.line, column: problem.column } : {}),
      })),
    };
  }
  const result = check(parsed.data);
  if (result.ok) return result;
  return {
    ok: false,
    problems: result.problems.map((problem) => {
      if (problem.pointer === undefined) return problem;
      const path = problem.pointer
        .split('/')
        .slice(1)
        .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
      return { ...problem, ...parsed.locate(path) };
    }),
  };
}

/** A schema's verdict on data, as value-free problems with pointers. */
export function checked<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown) {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true as const, value: result.data };
  return {
    ok: false as const,
    problems: result.error.issues.map((issue): UnitFileProblem => ({
      kind: 'schema',
      code: issue.code,
      pointer: redactedPointer(issue.path),
      message: redactSecrets(describeIssue(issue)),
    })),
  };
}
