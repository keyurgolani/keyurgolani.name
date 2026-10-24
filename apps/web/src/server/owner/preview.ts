import 'server-only';
import { readDerivedSchemes } from '~/lib/derived-schemes';
import {
  applyEdits,
  composeSchemas,
  parseSource,
  resolvePortfolioView,
  validatePublicationUnit,
  type AppearanceCatalog,
  type AppearanceSelection,
  type ContentExtension,
  type ParsedPair,
  type PublicView,
  type SourceDocument,
  type UnitValidator,
} from '@portfolio/schema';
import {
  createPreviewGrants,
  filesystemGrantStore,
  grantRef,
  isDraftId,
  onStoreEvent,
  openStore,
  sessionRef,
  type DraftId,
  type GrantLogEntry,
  type GrantRecord,
  type GrantSubject,
  type PreviewGrants,
  type RevisionId,
  type Store,
  type UnitInput,
} from '@portfolio/core/owner';
import { readDerivedSchemes } from '@portfolio/appearance';
import { resolveRendition } from '@portfolio/core';
import { assertAuthorized, authorize, type Authorized } from '../authorize';
import type { DeploymentConfig } from '../config';
import type { Handler, HandlerContext } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';
import type {
  GrantSessionPort,
  OpenedGrant,
  PreviewFixture,
  PreviewGrantsPort,
  Previewable,
} from '../preview-port';
import type { Session } from '../session';
import { errorResult } from '../studio-result';
import { mintSession } from './session-mint';

// The owner's preview grants (#7, Slice 2): @portfolio/core's grant service
// in the data directory, bound to #2's sessions by digest and to #3's store
// for what grants render, the four preview.grant commands, and the port
// proxy.ts and the preview routes check grants through. The composition
// root loads it through import() in its owner branch, so demo and
// read-only never evaluate it: they have no grant to check, and no path
// that reaches the owner's store.
//
// A grant renders the public view of its subject, as #4 validates it with
// the checks startup runs, with the frame's appearance override in place of
// the site's own: a draft's pinned version, a revision, or one of #5's
// fixtures. A version with any blocks-preview finding gets no grant. The
// content is read through Authorized<'preview.grant'>, which the check
// builds from the session record the grant is bound to, never a cookie.

recordOwnerModule('server/owner/preview');

export interface OwnerPreviewInput {
  readonly config: DeploymentConfig;
  /** The owner provider's sessions, by digest (#2). */
  readonly sessions: GrantSessionPort;
  /** What documents are checked against, as startup checks the live pair. */
  readonly catalog?: AppearanceCatalog;
  readonly extensions?: readonly ContentExtension[];
  readonly validators?: readonly UnitValidator[];
  /**
   * #3's store; without one, the data directory's, opened for reads. Without
   * its publication service, nothing is live to preview.
   */
  readonly store?: Pick<Store, 'drafts' | 'revisions'> &
    Partial<Pick<Store, 'publication' | 'assets'>>;
  /** #5's contract fixtures by id (#5, Slice 6); none until they ship. */
  readonly fixtures?: (id: string) => PreviewFixture | null;
  /** The clock grants run on. Tests pass their own. */
  readonly now?: () => number;
}

export interface OwnerPreviews {
  /** The preview.grant commands, by operation name. */
  readonly handlers: Readonly<Record<string, Handler>>;
  /** What the deployment state holds for proxy.ts and the preview routes. */
  readonly port: PreviewGrantsPort;
  readonly grants: PreviewGrants;
  /** Stops listening for the store's and the sessions' events. */
  close(): void;
}

/** Grant log lines, with their ref, count, and code, as the server log allows them. */
const grantLog = (entry: GrantLogEntry) => log({ ...entry });

const iso = (ms: number) => new Date(ms).toISOString();

/** How many views of grants this process keeps, each for a grant whose content never changes. */
const VIEWS = 16;

const sourceOf = (
  name: 'portfolio' | 'site',
  document: UnitInput['portfolio'],
): SourceDocument => ({
  text: document.sourceText,
  format: document.format,
  name: `${name}.${document.format === 'yaml' ? 'yml' : 'json'}`,
});

/**
 * The variant a site document selects, as Studio names it in a frame's
 * title: its appearance.variant, or null when it doesn't parse or names none.
 */
function selectedVariant(site: {
  readonly format: 'yaml' | 'json';
  readonly sourceText: string;
}): string | null {
  const parsed = parseSource(site.sourceText, site.format);
  if (!parsed.ok) return null;
  const appearance = (parsed.data as { readonly appearance?: unknown }).appearance;
  const variant =
    typeof appearance === 'object' && appearance !== null
      ? (appearance as { readonly variant?: unknown }).variant
      : undefined;
  return typeof variant === 'string' && variant !== '' ? variant : null;
}

/** What a grant renders from: its documents, and the snapshots derived beside them. */
interface Content {
  readonly documents: UnitInput;
  readonly snapshots: Readonly<Record<string, unknown>>;
}

/** A media document's data, for the view: none when there's none, or it doesn't parse. */
function mediaOf(documents: UnitInput): unknown {
  if (!documents.media) return undefined;
  const parsed = parseSource(documents.media.sourceText, documents.media.format);
  return parsed.ok ? parsed.data : undefined;
}

/** A unit's documents as a grant pins them: each document's format and text. */
const documentsOf = (unit: {
  readonly portfolio: UnitInput['portfolio'];
  readonly site: UnitInput['site'];
  readonly media?: UnitInput['portfolio'];
}): UnitInput => ({
  portfolio: { format: unit.portfolio.format, sourceText: unit.portfolio.sourceText },
  site: { format: unit.site.format, sourceText: unit.site.sourceText },
  ...(unit.media
    ? { media: { format: unit.media.format, sourceText: unit.media.sourceText } }
    : {}),
});

export function ownerPreviews({
  config,
  sessions,
  catalog,
  extensions = [],
  validators,
  store: given,
  fixtures = () => null,
  now,
}: OwnerPreviewInput): OwnerPreviews {
  const { dataDir } = config;
  // The data.directory requirement refuses owner startup without one.
  if (!dataDir) throw new Error('Preview grants need a data directory.');
  const context = {
    ...(catalog ? { catalog } : {}),
    extensions,
    ...(validators ? { validators } : {}),
    canonicalOrigin: config.origin,
  };
  const store =
    given ??
    openStore({
      dataDir,
      checks: { validate: (pair) => validatePublicationUnit(pair, context), appVersion: '' },
      ...(now ? { now } : {}),
    });
  const { AppearanceSelectionSchema } = composeSchemas(extensions);
  const grants = createPreviewGrants({
    store: filesystemGrantStore(dataDir),
    sessions,
    drafts: { exists: async (draftId) => (await store.drafts.get(draftId)) !== null },
    profile: config.profile,
    studioOrigin: config.origin,
    ...(config.previewGrantLifetime ? { lifetime: config.previewGrantLifetime } : {}),
    ...(now ? { now } : {}),
    log: grantLog,
  });

  /**
   * The pair `documents` renders, with `appearance` in place of the site's
   * own selection, or how many blocks-preview findings stop it. The
   * override goes into a copy of the site's text, never the draft.
   */
  function rendered(
    documents: UnitInput,
    appearance?: Readonly<Record<string, unknown>>,
  ): { readonly pair: ParsedPair } | { readonly blocking: number } {
    let site = documents.site;
    if (appearance) {
      try {
        site = {
          format: site.format,
          sourceText: applyEdits(site.sourceText, site.format, [
            { op: 'set', pointer: '/appearance', value: appearance },
          ]),
        };
      } catch {
        // The site's text doesn't parse; its own finding blocks it below.
      }
    }
    const result = validatePublicationUnit(
      { portfolio: sourceOf('portfolio', documents.portfolio), site: sourceOf('site', site) },
      context,
    );
    const blocking = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'blocks-preview',
    ).length;
    if (!result.pair || blocking > 0) return { blocking: Math.max(1, blocking) };
    return { pair: result.pair };
  }

  /**
   * What a revision or fixture subject holds: its documents, and the
   * snapshots derived beside them. A draft's is what its grant pinned, and a
   * draft has no snapshots until it's published.
   */
  async function contentOf(subject: GrantSubject): Promise<Content | null> {
    if (subject.kind === 'revision') {
      const read = await store.revisions.read(subject.revisionId);
      if (!read.ok) return null;
      const { unit } = read.revision;
      return { documents: documentsOf(unit), snapshots: unit.snapshots };
    }
    if (subject.kind === 'fixture') {
      const fixture = fixtures(subject.fixture);
      return fixture
        ? { documents: documentsOf(fixture), snapshots: fixture.snapshots ?? {} }
        : null;
    }
    return null;
  }

  const views = new Map<string, PublicView>();
  /**
   * A revision's or fixture's stored generated schemes, its
   * snapshots/schemes.json as read (#20 PR 3), by the grant's digest, kept
   * and dropped with its view.
   */
  const storedSchemes = new Map<string, unknown>();

  /**
   * The owner service a grant's content is read through: it takes the token
   * the check built from the grant's session, and checks it first. The
   * view's renditions serve under the grant's own path, `grant`, as #10
   * serves a draft's.
   */
  async function read(
    authorized: Authorized,
    record: GrantRecord,
    grant: string,
  ): Promise<OpenedGrant> {
    assertAuthorized(authorized, 'preview.grant');
    const ref = grantRef(record.digest);
    let view = views.get(record.digest);
    if (!view) {
      const content: Content | null =
        record.subject.kind === 'draft'
          ? record.documents
            ? { documents: record.documents, snapshots: {} }
            : null
          : await contentOf(record.subject);
      const outcome = content ? rendered(content.documents, record.appearance) : null;
      if (!content || !outcome || !('pair' in outcome)) {
        // Never the sample in its place, and never the reason: the log has the grant's ref.
        log({ level: 'error', event: 'preview.render_failed', grantRef: ref });
        throw new Error("The grant's content doesn't render.");
      }
      view = resolvePortfolioView(
        outcome.pair,
        { media: mediaOf(content.documents), snapshots: content.snapshots },
        { mediaBase: `/preview-assets/${grant}`, extensions },
      );
      views.set(record.digest, view);
      storedSchemes.set(record.digest, content.snapshots.schemes);
      for (const key of views.keys()) {
        if (views.size <= VIEWS) break;
        views.delete(key);
        storedSchemes.delete(key);
      }
    }
    // The grant's generated schemes, each checked: a draft grant's as pinned at
    // mint (10h), a revision's or fixture's its own stored ones (#20 PR 3). One
    // that doesn't check is left out, so its axis falls back, and logged by id.
    const pinned =
      record.subject.kind === 'draft' ? record.schemes : storedSchemes.get(record.digest);
    const pinnedRead = pinned === undefined ? null : readDerivedSchemes(pinned);
    for (const problem of pinnedRead?.problems ?? []) {
      log({
        level: 'warn',
        event: 'preview.scheme_dropped',
        grantRef: ref,
        schemeId: problem.schemeId,
      });
    }
    return Object.freeze({
      view,
      environment: record.environment,
      nonce: record.nonce,
      renderedVersion: renderedVersionOf(record),
      ref,
      ...(pinnedRead && Object.keys(pinnedRead.schemes).length > 0
        ? { schemes: pinnedRead.schemes }
        : {}),
    });
  }

  /** The version a frame's `ready` names: a draft grant's pinned one, or null for a revision or fixture. */
  const renderedVersionOf = (record: GrantRecord) =>
    record.subject.kind === 'draft' ? record.subject.version : null;

  /**
   * The appearance a site document selects, when it's a whole selection a
   * frame's override can start from (#7), or null.
   */
  const siteAppearance = (site: {
    readonly format: 'yaml' | 'json';
    readonly sourceText: string;
  }): AppearanceSelection | null => {
    const parsed = parseSource(site.sourceText, site.format);
    if (!parsed.ok) return null;
    const selection = AppearanceSelectionSchema.safeParse(
      (parsed.data as { readonly appearance?: unknown }).appearance,
    );
    return selection.success ? (selection.data as AppearanceSelection) : null;
  };

  /** What /studio/preview offers (Slice 4): the working draft's latest version, then the live revision. */
  async function previewable(session: Session | null): Promise<readonly Previewable[]> {
    if (!authorize('preview.grant', session)) return [];
    const offered: Previewable[] = [];
    const working = await store.drafts.getWorking();
    if (working) {
      offered.push({
        kind: 'draft',
        subject: { draft: working.draftId, version: working.version },
        variant: selectedVariant(working.documents.site),
        appearance: siteAppearance(working.documents.site),
      });
    }
    const live = store.publication ? (await store.publication.status()).liveRevisionId : null;
    if (live) {
      const read = await store.revisions.read(live);
      if (read.ok) {
        offered.push({
          kind: 'revision',
          subject: { revision: live },
          variant: selectedVariant(read.revision.unit.site),
          appearance: siteAppearance(read.revision.unit.site),
        });
      }
    }
    return Object.freeze(offered);
  }

  const port: PreviewGrantsPort = Object.freeze({
    async admit(grant: string) {
      try {
        return (await grants.check(grant)).status === 'active';
      } catch {
        log({ level: 'error', event: 'preview.grant.check_failed' });
        return false;
      }
    },
    async open(grant: string) {
      const checked = await grants.check(grant);
      if (checked.status !== 'active') return null;
      // The bound session record, found by digest, stands for the owner here.
      const session = mintSession({ ref: sessionRef(checked.record.sessionDigest) });
      const authorized = authorize('preview.grant', session);
      if (!authorized) return null;
      return read(authorized, checked.record, grant);
    },
    async channel(grant: string) {
      const checked = await grants.check(grant);
      if (checked.status !== 'active') return null;
      const session = mintSession({ ref: sessionRef(checked.record.sessionDigest) });
      if (!authorize('preview.grant', session)) return null;
      return Object.freeze({
        nonce: checked.record.nonce,
        renderedVersion: renderedVersionOf(checked.record),
      });
    },
    previewable,
    async asset(grant: string, segments: readonly string[]) {
      const checked = await grants.check(grant);
      if (checked.status !== 'active') return null;
      const session = mintSession({ ref: sessionRef(checked.record.sessionDigest) });
      const authorized = authorize('preview.grant', session);
      if (!authorized) return null;
      const { record } = checked;
      const { view } = await read(authorized, record, grant);
      // What the grant pinned: a draft's documents as minted, or what its
      // revision or fixture holds.
      const documents =
        record.subject.kind === 'draft'
          ? (record.documents ?? null)
          : ((await contentOf(record.subject))?.documents ?? null);
      if (!documents) return null;
      const found = resolveRendition(
        mediaOf(documents),
        new Set(Object.keys(view.media)),
        segments,
      );
      if (!found) return null;
      const assets = store.assets;
      return Object.freeze({
        ...found,
        open: async () => (assets ? assets.open(found.blob) : null),
      });
    },
  });

  /** The session a grant command came with, as its grants bind to it. */
  const caller = (context: HandlerContext) => sessions.of(context.session);

  const mint: Handler = async (authorized, input, context) => {
    assertAuthorized(authorized, 'preview.grant');
    const session = caller(context);
    if (!session) return errorResult('authentication_required');
    const { subject, appearance, environment } = input as {
      readonly subject:
        { draft: string; version: number } | { revision: string } | { fixture: string };
      readonly appearance?: Record<string, unknown>;
      readonly environment: GrantRecord['environment'];
    };
    // The override is a whole selection in the site document's shape.
    const override =
      appearance === undefined ? undefined : AppearanceSelectionSchema.safeParse(appearance);
    if (override && !override.success) return errorResult('invalid_input');
    const selection = override?.data as Record<string, unknown> | undefined;

    let grantSubject: GrantSubject;
    let documents: UnitInput | null;
    let pinnedSchemes: Readonly<Record<string, unknown>> | undefined;
    if ('draft' in subject) {
      if (!isDraftId(subject.draft)) return errorResult('invalid_input');
      const draft = await store.drafts.get(subject.draft);
      if (!draft) return errorResult('not_found');
      if (draft.version !== subject.version) return errorResult('version_conflict');
      grantSubject = { kind: 'draft', draftId: draft.draftId, version: draft.version };
      documents = documentsOf(draft.documents);
      pinnedSchemes = draft.derived?.schemes;
    } else if ('revision' in subject) {
      grantSubject = { kind: 'revision', revisionId: subject.revision as RevisionId };
      documents = (await contentOf(grantSubject))?.documents ?? null;
    } else {
      grantSubject = { kind: 'fixture', fixture: subject.fixture };
      documents = (await contentOf(grantSubject))?.documents ?? null;
    }
    if (!documents) return errorResult('not_found');

    const outcome = rendered(documents, selection);
    if (!('pair' in outcome)) return { status: 'preview_blocked', diagnostics: outcome.blocking };
    const minted = await grants.mint({
      session,
      subject: grantSubject,
      ...(grantSubject.kind === 'draft' ? { documents } : {}),
      ...(grantSubject.kind === 'draft' && pinnedSchemes ? { schemes: pinnedSchemes } : {}),
      ...(selection ? { appearance: selection } : {}),
      environment,
    });
    const expiry = grants.expiry(minted.record);
    return {
      status: 'active',
      grant: minted.token,
      ref: grantRef(minted.record.digest),
      nonce: minted.record.nonce,
      idleExpiresAt: iso(expiry.idleExpiresAt),
      absoluteExpiresAt: iso(expiry.absoluteExpiresAt),
    };
  };

  const renew: Handler = async (authorized, input, context) => {
    assertAuthorized(authorized, 'preview.grant');
    const session = caller(context);
    if (!session) return errorResult('authentication_required');
    const renewed = await grants.renew((input as { grant: string }).grant, session.digest);
    if (renewed.status !== 'active') return { status: renewed.status };
    return {
      status: 'active',
      idleExpiresAt: iso(renewed.expiry.idleExpiresAt),
      absoluteExpiresAt: iso(renewed.expiry.absoluteExpiresAt),
    };
  };

  const revoke: Handler = async (authorized, input, context) => {
    assertAuthorized(authorized, 'preview.grant');
    const session = caller(context);
    if (!session) return errorResult('authentication_required');
    // By its token, or by its ref, for a grant whose page went before the
    // token's revoke reached the server (#7). Either names only the caller's
    // own active grant; anything else answers as an unknown grant does.
    const named = input as { grant: string } | { ref: string };
    const revoked =
      'grant' in named
        ? await grants.revoke(named.grant, session.digest)
        : await grants.revokeRef(named.ref, session.digest);
    return { revoked };
  };

  const status: Handler = async (authorized, input, context) => {
    assertAuthorized(authorized, 'preview.grant');
    const session = caller(context);
    if (!session) return errorResult('authentication_required');
    return { status: await grants.status((input as { grant: string }).grant, session.digest) };
  };

  // Events end grants sooner than their next check would, so status() can
  // say why. A failure is logged; the check still catches the grant.
  const quietly = (task: () => Promise<unknown>) => {
    void task().catch(() => log({ level: 'warn', event: 'preview.grant.event_failed' }));
  };
  const stopStore = onStoreEvent((event) => {
    if (event.name === 'published') quietly(() => grants.supersedeDraftGrants());
    else if (event.name === 'draftDiscarded' && isDraftId(event.draftId)) {
      const draftId: DraftId = event.draftId;
      quietly(() => grants.supersedeDraft(draftId));
    }
  });
  const stopSessions = sessions.onSessionEnded((digest) =>
    quietly(() => grants.endSession(digest)),
  );
  // What a restart left behind past its cap.
  quietly(() => grants.sweep());

  return Object.freeze({
    handlers: Object.freeze({
      'preview.grant.mint': mint,
      'preview.grant.renew': renew,
      'preview.grant.revoke': revoke,
      'preview.grant.status': status,
    }),
    port,
    grants,
    close() {
      stopStore();
      stopSessions();
    },
  });
}
