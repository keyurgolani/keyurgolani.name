import type { BackendFailure, SaveResult, StudioBackend } from '../studio/backend';
import type { DraftDocument, LiveState, StudioDraft } from '../studio/documents';
import { AXES, type CatalogAxis } from '../studio/appearance';
import { importFiles as workerImport, type ImportInput, type ImportResult } from './import';
import { SELECTION_KEY, WORKING_KEY, type DemoStore } from './storage';
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
// The source is the bundled sample the page read through `sample.read`, the
// same public documents /sample renders, until the visitor imports a pair of
// their own: then it's the local source, the working copy, kept in this tab's
// sessionStorage under `portfolio-demo:v1:working` and nowhere else.
// startDraft() starts that copy from the sample's documents, and saveDraft()
// and importFiles() replace it with documents #4's validator took, in the
// import's module worker: the import and a save parse there, never on this
// thread. Export (lib/demo/export) reads the accepted or the sample's text
// again on the page, under #4's pre-parse limits. A full reset drops
// whatever an import or a save still in the worker answers. A working copy
// a reload brings back is read by shape, and report() checks it in the
// worker again, so its findings and notices show again. The visitor's
// selection stays apart from both, so an edit sets one of the five
// `/appearance/<axis>` pointers of the site to a value the catalog offers,
// and anything else is refused. Every selection change goes to the demo's
// own storage, and the URL never carries a source.

/** The bundled sample as the page hands it over: the revision it is, and its documents with their models. */
export interface DemoUnit {
  readonly revisionId: string;
  readonly documents: StudioDraft['documents'];
}

/** A document of the local source, as the import gave it: its name, format, and text. */
export interface LocalSource {
  readonly name: string;
  readonly format: 'yaml' | 'json';
  readonly text: string;
}

/** The local source's two documents, the frame's `document` message's own shape. */
export interface LocalSources {
  readonly portfolio: LocalSource;
  readonly site: LocalSource;
}

/** What an import may be given: a signal that stops it, as #137's importFiles takes. */
export interface ImportOptions {
  readonly signal?: AbortSignal;
}

/** How a pair of files is checked: the import's module worker, or a test's stand-in. */
export type Importer = (
  files: readonly ImportInput[],
  options?: ImportOptions,
) => Promise<ImportResult>;

export interface BrowserBackendOptions extends SelectionRules {
  readonly unit: DemoUnit;
  /** The sample site's own selection: the demo's default and the full reset's target. */
  readonly defaults: DemoSelection;
  readonly store: DemoStore;
  /** The selection the page loaded with, from the URL or storage, when it's not the default. */
  readonly initial?: DemoSelection;
  /** The working draft's date, for its record. */
  readonly now?: () => Date;
  /** What checks an import or a save: the import's module worker when absent. */
  readonly importer?: Importer;
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
  /** Every `portfolio-demo:` key gone from both stores, the local source dropped, and the sample's own selection back. */
  resetAll(): DemoSelection;
  /** The local source's documents while there is one, else null: the frame shows the sample. */
  localSources(): LocalSources | null;
  /** The documents an export writes: the local source's, else the sample's. */
  sources(): LocalSources;
  /**
   * Imports a pair of files through the worker. What it imports becomes the
   * local source, in place of any before it; what it refuses changes nothing.
   * Null when a full reset came while the worker read them: nothing is kept,
   * and there is nothing to report.
   */
  importFiles(files: readonly ImportInput[], options?: ImportOptions): Promise<ImportResult | null>;
  /**
   * The import's answer for the local source as it is now, or null while
   * there is none: the import's or the save's own, or, for a working copy a
   * reload brought back, the worker's check of it again, made once.
   */
  report(): Promise<ImportResult | null>;
}

/** The draft ID of the demo's sample, the source until an import. */
export const DEMO_DRAFT_ID = 'demo-sample';
/** The draft ID of the local source, the visitor's own imported pair. */
export const LOCAL_DRAFT_ID = 'demo-local';

/** What an edit, a save, or a draft the demo doesn't offer gets. */
export const NOT_OFFERED =
  "The demo changes the appearance only. Editing content isn't part of the demo yet.";

/** What a save gets when a full reset came while the worker checked its documents. */
export const RESET_WHILE_CHECKED =
  'The demo was reset while the documents were checked, so nothing was saved.';

/** What a save gets while there is no local source to save over. */
export const NOT_STARTED =
  'Import a pair of documents first: the sample itself is never saved over.';

const notOffered = (message = NOT_OFFERED): BackendFailure => ({
  kind: 'failed',
  code: 'not_offered',
  message,
});

const POINTER = /^\/appearance\/([A-Za-z]+)$/;

/** Refusals that say the check couldn't run, not what the documents are. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'worker_unavailable']);

const isSource = (value: unknown): value is LocalSource => {
  const entry = record(value);
  return (
    typeof entry.name === 'string' &&
    (entry.format === 'yaml' || entry.format === 'json') &&
    typeof entry.text === 'string'
  );
};

/** The working copy as stored, or null when there is none or it isn't one: read by shape, never parsed as a document. */
export function storedWorking(store: DemoStore): LocalSources | null {
  const text = store.read(WORKING_KEY);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const sources = record(record(parsed).sources);
  return isSource(sources.portfolio) && isSource(sources.site)
    ? { portfolio: sources.portfolio, site: sources.site }
    : null;
}

/** A pair of documents as the files the import reads: their own text as UTF-8 bytes. */
function filesOf(documents: {
  readonly portfolio: { readonly format: 'yaml' | 'json'; readonly text: string };
  readonly site: { readonly format: 'yaml' | 'json'; readonly text: string };
}): ImportInput[] {
  const encoder = new TextEncoder();
  return (['portfolio', 'site'] as const).map((name) => ({
    name: `${name}.${documents[name].format === 'json' ? 'json' : 'yml'}`,
    bytes: encoder.encode(documents[name].text),
  }));
}

/** What a refused save says: the refusal's code, and how many findings, never a value from the files. */
function refusal(result: Extract<ImportResult, { kind: 'refused' }>): BackendFailure {
  const count = result.diagnostics.length;
  const findings = count > 0 ? `, with ${count} finding${count === 1 ? '' : 's'}` : '';
  return {
    kind: 'failed',
    code: 'validation_failed',
    message: `The documents weren't saved: ${result.code.replace(/_/g, ' ')}${findings}.`,
  };
}

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
  const importer: Importer = options.importer ?? ((files, given) => workerImport(files, given));
  let selection: DemoSelection = options.initial ?? defaults;
  let version = 1;
  let updatedAt = now().toISOString();
  // The local source: a reload in this tab brings back what the tab holds.
  let local: LocalSources | null = storedWorking(store);
  let models: { readonly portfolio?: unknown; readonly site?: unknown } = {};
  // Each full reset, which an import or a save the worker still holds checks for.
  let generation = 0;
  // The import's answer for the local source it's about.
  let checked: { readonly of: LocalSources; readonly result: Promise<ImportResult> } | null = null;

  // While the reference shows, edits stay in the page: the stored selection
  // is the sample's, which a bare /studio opens on, never the reference's look.
  let showingReference = false;
  const persist = () => {
    if (!showingReference) store.write(SELECTION_KEY, JSON.stringify(selection));
  };

  const sampleSource = (name: 'portfolio' | 'site'): LocalSource => {
    const { format, sourceText } = unit.documents[name];
    return { name: `${name}.${format === 'json' ? 'json' : 'yml'}`, format, text: sourceText };
  };
  const sampleSources = (): LocalSources => ({
    portfolio: sampleSource('portfolio'),
    site: sampleSource('site'),
  });

  /** `result`'s documents as the working copy: in this tab's sessionStorage, and in memory. */
  function adopt(result: Extract<ImportResult, { kind: 'imported' }>): StudioDraft {
    const { sources } = result.unit;
    local = { portfolio: sources.portfolio, site: sources.site };
    models = result.unit.models;
    checked = { of: local, result: Promise.resolve(result) };
    store.write(WORKING_KEY, JSON.stringify({ sources: local }));
    version += 1;
    updatedAt = now().toISOString();
    return draft();
  }

  function draft(): StudioDraft {
    if (local) {
      const document = (source: LocalSource, model: unknown): DraftDocument => ({
        format: source.format,
        sourceText: source.text,
        diagnostics: [],
        ...(model === undefined ? {} : { model }),
      });
      return {
        draftId: LOCAL_DRAFT_ID,
        version,
        baseRevisionId: null,
        updatedAt,
        documents: {
          portfolio: document(local.portfolio, models.portfolio),
          site: document(local.site, models.site),
        },
      };
    }
    const site: DraftDocument = unit.documents.site;
    const model = record(site.model);
    return {
      draftId: DEMO_DRAFT_ID,
      version,
      baseRevisionId: unit.revisionId,
      updatedAt,
      documents: {
        ...unit.documents,
        // The site's model carries the selection; its text stays the sample's.
        site: {
          ...site,
          model: { ...model, appearance: { ...record(model.appearance), ...selection } },
        },
      },
    };
  }

  /** Why an edit or a save naming `draftId` at `expectedVersion` can't go, or null when it can. */
  function stale(draftId: string, expectedVersion: number): SaveResult | null {
    if (draftId !== (local ? LOCAL_DRAFT_ID : DEMO_DRAFT_ID)) {
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
    return null;
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
    // The local source, from the sample's own documents when there is none yet.
    async startDraft(): Promise<SaveResult> {
      if (local) return { kind: 'saved', draft: draft() };
      local = sampleSources();
      models = {};
      store.write(WORKING_KEY, JSON.stringify({ sources: local }));
      version += 1;
      updatedAt = now().toISOString();
      return { kind: 'saved', draft: draft() };
    },
    async saveDraft({ draftId, expectedVersion, documents }): Promise<SaveResult> {
      if (!local) return notOffered(NOT_STARTED);
      const problem = stale(draftId, expectedVersion);
      if (problem) return problem;
      const at = generation;
      const result = await importer(
        filesOf({
          portfolio: { format: documents.portfolio.format, text: documents.portfolio.sourceText },
          site: { format: documents.site.format, text: documents.site.sourceText },
        }),
      );
      if (generation !== at) {
        return { kind: 'failed', code: 'not_found', message: RESET_WHILE_CHECKED };
      }
      if (result.kind !== 'imported') return refusal(result);
      // Another save or an import may have moved it while the worker checked.
      const later = stale(draftId, expectedVersion);
      if (later) return later;
      return { kind: 'saved', draft: adopt(result) };
    },
    async importFiles(files, given = {}) {
      const at = generation;
      const result = await importer(files, given);
      // Reset demo came while the worker read them: the reset stands.
      if (generation !== at) return null;
      if (result.kind === 'imported') adopt(result);
      return result;
    },
    async report() {
      const of = local;
      if (!of) return null;
      let entry = checked;
      if (entry?.of !== of) {
        entry = { of, result: importer(filesOf(of)) };
        checked = entry;
        const mine = entry;
        // A check that couldn't run is tried again next time.
        void mine.result.then((answer) => {
          if (answer.kind === 'refused' && TRANSIENT.has(answer.code) && checked === mine) {
            checked = null;
          }
        });
      }
      const answer = await entry.result;
      return local === of ? answer : null;
    },
    localSources: () => local,
    sources: () => local ?? sampleSources(),
    async applyEdits({ draftId, expectedVersion, edits }): Promise<SaveResult> {
      const problem = stale(draftId, expectedVersion);
      if (problem) return problem;
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
      generation += 1;
      store.clearAll();
      showingReference = false;
      defaults = options.defaults;
      local = null;
      models = {};
      checked = null;
      return moved(defaults);
    },
  };
}
