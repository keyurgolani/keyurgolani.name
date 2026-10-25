import type { BackendFailure, SaveResult, StudioBackend } from '../studio/backend';
import type { DraftDocument, LiveState, StudioDraft } from '../studio/documents';
import { AXES, type CatalogAxis } from '../studio/appearance';
import { SELECTION_KEY, type DemoStore } from './storage';
import {
  modeFits,
  selectionFrom,
  selectionProblem,
  selectionQuery,
  type DemoSelection,
  type SelectionRules,
} from './url-state';

// Demo Studio's backend (#9, design note section 2): the Studio shell's
// StudioBackend, kept in the visitor's browser. Nothing here reaches a
// server: no fetch, no Studio operation, no owner session, and nothing to
// publish, roll back, or read history from, which owner's adapter alone has.
// The working copy is the bundled sample the page read through `sample.read`,
// the same public documents /sample renders, with the visitor's selection on
// its site appearance. This pull request edits the appearance alone: an edit
// sets one of the five `/appearance/<axis>` pointers of the site document to
// a value the catalog offers, and anything else is refused. Saving or
// starting a draft isn't offered until the demo's local source (#9's import)
// lands. Every selection change goes to the demo's own storage.

/** The bundled sample as the page hands it over: the revision it is, and its documents with their models. */
export interface DemoUnit {
  readonly revisionId: string;
  readonly documents: StudioDraft['documents'];
}

export interface BrowserBackendOptions extends SelectionRules {
  readonly unit: DemoUnit;
  /** The sample site's own selection: the demo's default and the full reset's target. */
  readonly defaults: DemoSelection;
  readonly store: DemoStore;
  /** The selection the page loaded with, from the URL or storage, when it's not the default. */
  readonly initial?: DemoSelection;
  /** The working draft's date, for its record. */
  readonly now?: () => Date;
}

/** Demo Studio's backend: the StudioBackend, and the selection's own reads and resets. */
export interface DemoBackend extends StudioBackend {
  selection(): DemoSelection;
  /** The working draft's version, which an edit names. */
  version(): number;
  /** False once the selection could only stay in memory: a reload loses it. */
  persistent(): boolean;
  /** One axis back to the shown source's own value; the other four stay. */
  resetAxis(axis: CatalogAxis): DemoSelection;
  /**
   * The selection, and each axis reset's target, set to a source's own: the
   * read-only reference's selection as it loads (#9), or null for the
   * sample's own as it goes back. Nothing is stored: a reload opens on the
   * sample.
   */
  showSource(defaults: DemoSelection | null, selection?: DemoSelection): DemoSelection;
  /** Every `portfolio-demo:` key gone from both stores, and the sample's own selection back. */
  resetAll(): DemoSelection;
}

/** The draft ID of the demo's one working copy. */
export const DEMO_DRAFT_ID = 'demo-sample';

/** What an edit, a save, or a draft the demo doesn't offer gets. */
export const NOT_OFFERED =
  "The demo changes the appearance only. Editing content isn't part of the demo yet.";

const notOffered = (message = NOT_OFFERED): BackendFailure => ({
  kind: 'failed',
  code: 'not_offered',
  message,
});

const POINTER = /^\/appearance\/([A-Za-z]+)$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The stored selection, axis by axis over the defaults, or null when there is none or it doesn't read. */
export function storedSelection(
  store: DemoStore,
  defaults: DemoSelection,
  rules: SelectionRules,
): DemoSelection | null {
  const text = store.read(SELECTION_KEY);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const values = record(parsed);
  const stored = Object.fromEntries(
    AXES.map((axis) => [axis, typeof values[axis] === 'string' ? (values[axis] as string) : '']),
  ) as DemoSelection;
  // Through the same rules a URL goes through, so a stale or edited value falls back on its axis.
  return selectionFrom(selectionQuery(stored, rules), defaults, rules);
}

export function browserBackend(options: BrowserBackendOptions): DemoBackend {
  const { unit, store } = options;
  // The reset target: the sample's own, or the reference's while it shows.
  let defaults: DemoSelection = options.defaults;
  const rules: SelectionRules = { catalog: options.catalog, schemeModes: options.schemeModes };
  const now = options.now ?? (() => new Date());
  let selection: DemoSelection = options.initial ?? defaults;
  let version = 1;
  let updatedAt = now().toISOString();

  // While the reference shows, edits stay in the page: the stored selection
  // is the sample's, which a bare /studio opens on, never the reference's look.
  let showingReference = false;
  const persist = () => {
    if (!showingReference) store.write(SELECTION_KEY, JSON.stringify(selection));
  };

  function draft(): StudioDraft {
    const site: DraftDocument = unit.documents.site;
    const model = record(site.model);
    return {
      draftId: DEMO_DRAFT_ID,
      version,
      baseRevisionId: unit.revisionId,
      updatedAt,
      documents: {
        ...unit.documents,
        // The site's model carries the selection. Its text stays the sample's
        // until the local source serializes a working copy (#9's import).
        site: {
          ...site,
          model: { ...model, appearance: { ...record(model.appearance), ...selection } },
        },
      },
    };
  }

  function moved(next: DemoSelection): DemoSelection {
    selection = next;
    version += 1;
    updatedAt = now().toISOString();
    return selection;
  }

  return {
    session: async () => true,
    live: async () => ({
      kind: 'read',
      value: {
        state: 'live',
        liveRevisionId: unit.revisionId,
        servingRevisionId: unit.revisionId,
        seq: null,
      } satisfies LiveState,
    }),
    workingDraft: async () => ({ kind: 'read', value: draft() }),
    startDraft: async () => notOffered(),
    saveDraft: async () => notOffered(),
    async applyEdits({ draftId, expectedVersion, edits }): Promise<SaveResult> {
      if (draftId !== DEMO_DRAFT_ID) {
        return { kind: 'failed', code: 'not_found', message: 'There is no such draft here.' };
      }
      if (expectedVersion !== version) {
        const current = draft();
        return {
          kind: 'conflict',
          theirs: {
            draftId: current.draftId,
            version: current.version,
            documents: current.documents,
          },
        };
      }
      // Every edit is checked before any applies, against the selection as it builds.
      let next: Record<CatalogAxis, string> = { ...selection };
      for (const edit of edits) {
        const axis = POINTER.exec(edit.pointer)?.[1] as CatalogAxis | undefined;
        if (edit.document !== 'site' || edit.op !== 'set' || !axis || !AXES.includes(axis)) {
          return notOffered();
        }
        if (typeof edit.value !== 'string') return notOffered();
        const problem = selectionProblem(rules, next, axis, edit.value);
        if (problem) return { kind: 'failed', code: 'validation_failed', message: problem };
        next = { ...next, [axis]: edit.value };
      }
      if (edits.length === 0) return { kind: 'saved', draft: draft() };
      moved(next);
      persist();
      return { kind: 'saved', draft: draft() };
    },
    signOut: async () => false,
    selection: () => selection,
    version: () => version,
    persistent: () => store.persistent(),
    resetAxis(axis) {
      const next = { ...selection, [axis]: defaults[axis] };
      // A scheme back to its own value may not fit the mode the visitor chose:
      // the mode goes back with it.
      const fits = modeFits(rules.schemeModes, next.colorScheme, next.displayMode);
      moved(fits ? next : { ...next, displayMode: defaults.displayMode });
      persist();
      return selection;
    },
    showSource(next, shown) {
      showingReference = next !== null;
      defaults = next ?? options.defaults;
      return moved(shown ?? defaults);
    },
    resetAll() {
      store.clearAll();
      showingReference = false;
      defaults = options.defaults;
      return moved(defaults);
    },
  };
}
