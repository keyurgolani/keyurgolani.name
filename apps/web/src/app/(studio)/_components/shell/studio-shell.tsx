'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import dynamic from 'next/dynamic';
import { flushSync } from 'react-dom';
import {
  isOwnerBackend,
  type RevisionDetail,
  type StudioBackend,
  type StudioPolicy,
} from '~/lib/studio/backend';
import { fileNameOf, namesIn } from '~/lib/studio/documents';
import {
  draftSession,
  expectedVersion,
  INITIAL_SESSION,
  isDirty,
  type DraftSession,
} from '~/lib/studio/draft-session';
import {
  clearJournal,
  dropsOnWrite,
  entryFor,
  JOURNAL_MAX_ENTRIES,
  newTabId,
  pruneJournal,
  readJournal,
  removeEntry,
  tabId,
  writeEntry,
  type JournalEntry,
} from '~/lib/studio/journal';
import { pageCacheHandlers, restoredMayKeep } from '~/lib/studio/page-cache';
import { claimTab, mayRestore, openTabs } from '~/lib/studio/tab-presence';
import { endSession, NEUTRAL_TITLE, signOutListener } from '~/lib/studio/session-end';
import { blockingCount, publishBlocker } from '~/lib/studio/publication';
import { siteName } from '~/lib/studio/site-name';
import { stateChips, stateLines } from '~/lib/studio/state-model';
import { loadOwnerBackend } from '~/lib/studio/load-backend';
import {
  LAST_TASK_KEY,
  landingTask,
  tasksFor,
  type StudioTask,
  type TaskId,
} from '~/lib/studio/tasks';
import { AUTH_REQUIRED, onSignedOut, SIGNED_OUT_LOCATION, studioFetch } from '~/lib/studio-fetch';
import { ContentEditor } from '../fields/content-editor';
import type { FindingsLineHandle } from '../fields/findings-line';
import { FindingsSummary } from '../fields/findings-summary';
import { PublishDialog } from './publish-dialog';
import { ConflictPanel, OrphanPanel } from './conflict-panel';
import { SignOut } from './sign-out';
import { StudioFrame, TaskNav } from './studio-frame';
import { StudioMark } from '../split/studio-split';
import { AppearanceWorkspace, type PreviewSetup } from './appearance-workspace';

// Publish history loads with its task, never with the rest of /studio.
const HistoryTask = dynamic(() => import('./history-task').then((module) => module.HistoryTask), {
  ssr: false,
  loading: () => (
    <p className="studio-source__note" aria-busy="true">
      Loading the history…
    </p>
  ),
});
import { appearanceOf, type AppearanceCatalog, type SiteEdit } from '~/lib/studio/appearance';
import { foldAppearance } from '~/lib/studio/fold-appearance';

// The Owner Studio shell (#8, Slice 1): the task navigation, the textual
// state model, always on screen, and the content task's expert source mode
// over #3's one working draft, with the local journal and the conflict
// path. It renders only inside /studio's page, after requireOwnerPage let
// it, so nothing here, the journal included, renders before
// authentication. It reaches storage only through the StudioBackend its
// policy picks: the owner adapter, loaded only under owner.

/**
 * How long the owner adapter's chunk may take before Studio says it couldn't
 * load. One that arrives later still loads Studio, and the message goes.
 */
const BACKEND_TIMEOUT_MS = 5_000;

/** How long typing pauses before the journal takes the editor's text. */
const JOURNAL_PAUSE_MS = 300;

/** A document's file name as the owner knows it. */
const fileName = fileNameOf;

/**
 * The task the URL names: its fragment, as the task links set it, else a
 * `task` query, which a link from outside Studio, or #11's quality cells,
 * can carry, since a server never sees a fragment. With neither, the last
 * task this tab used, else Appearance (OWN-3), and the one it lands on is
 * kept as this tab's last.
 */
function taskFromHash(tasks: readonly StudioTask[]): TaskId {
  if (typeof window === 'undefined') return landingTask(tasks, '', null);
  const named =
    window.location.hash.slice(1) ||
    (new URLSearchParams(window.location.search).get('task') ?? '');
  const own = tabStorage();
  let kept: string | null = null;
  try {
    kept = own?.getItem(LAST_TASK_KEY) ?? null;
  } catch {
    // Storage that can't be reached keeps no last task.
  }
  const task = landingTask(tasks, named, kept);
  try {
    own?.setItem(LAST_TASK_KEY, task);
  } catch {
    // Storage that can't be reached keeps the task for this page only.
  }
  return task;
}

/** The browser's localStorage, or null where it can't be reached. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This tab's sessionStorage, or null where it can't be reached. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const noChange = () => () => {};

export function StudioShell({
  csrfToken,
  policy,
  appearance,
  preview,
}: {
  csrfToken: string;
  policy: StudioPolicy;
  /** What the Appearance workspace may offer, from this build's registry. */
  appearance: AppearanceCatalog;
  /** The preview's sandbox, origin, and override options, or null when the session can't preview. */
  preview: PreviewSetup | null;
}) {
  const tasks = useMemo(() => tasksFor(policy.allowed), [policy.allowed]);
  const [task, setTask] = useState<TaskId>(tasks[0]?.id ?? 'content');
  const [session, dispatch] = useReducer(draftSession, INITIAL_SESSION);
  const [backend, setBackend] = useState<StudioBackend | null>(null);
  // The owner adapter's chunk didn't arrive: Studio can't reach its store.
  const [backendFailed, setBackendFailed] = useState(false);
  const reload = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  // The journal write waiting for a pause in typing, which a page going into the cache cancels.
  const journalTimer = useRef<number | null>(null);
  // Demo Studio has its own shell (#9), so this one loads only the owner adapter.
  const unavailable = policy.profile !== 'owner';
  // False while a back-forward cache restore re-checks the session: nothing shows until it does.
  const [verified, setVerified] = useState(true);
  const [notice, setNotice] = useState('');
  // Set once this tab's own sign-out succeeds, so a late 401 doesn't send it to "session ended".
  const signingOut = useRef(false);
  // Whether the workspace's publish confirmation is open (P1-9).
  const [publishing, setPublishing] = useState(false);
  // The site Studio edits, as the workspace's top bar tags its name: empty on the server.
  const host = useSyncExternalStore(
    noChange,
    () => window.location.hostname,
    () => '',
  );
  const latest = useRef<DraftSession>(session);
  // This tab's id in the journal, and when the editor's text last changed.
  const tab = useRef<string | null>(null);
  // Settles once this tab holds its id's lock, which a load waits for.
  const claimed = useRef<Promise<void>>(Promise.resolve());
  const editedAt = useRef<number | null>(null);
  // Content's findings line, which a blocked preview's Show the problems opens.
  const findings = useRef<FindingsLineHandle | null>(null);
  // Appearance's Show the problems in Content: once the task is Content, its findings show.
  const showOnContent = useRef(false);
  // Before any other effect reads it: the session this render shows.
  useLayoutEffect(() => {
    latest.current = session;
  });
  // Before the shell loads anything: what may not stay in the journal goes.
  useLayoutEffect(() => {
    const own = tabStorage();
    tab.current = tabId(own);
    // A duplicated tab starts with a copy of its original's id: it takes one of its own.
    claimed.current = claimTab(tab.current, () => newTabId(own)).then((id) => {
      tab.current = id;
    });
    const store = storage();
    if (store) pruneJournal(store, Date.now());
  }, []);
  const canWrite = policy.allowed.includes('draft.write');
  // The live revision the Appearance task starts from while there's no draft, read and never written.
  const [liveRevision, setLiveRevision] = useState<{
    readonly id: string;
    readonly detail: RevisionDetail | null;
  } | null>(null);

  // The owner adapter, loaded only when the policy says the profile is owner.
  // When its chunk doesn't arrive, refused or past BACKEND_TIMEOUT_MS, Studio
  // says it couldn't load, rather than loading forever.
  useEffect(() => {
    let cancelled = false;
    if (unavailable) return;
    const failed = () => {
      if (!cancelled) setBackendFailed(true);
    };
    const timer = window.setTimeout(failed, BACKEND_TIMEOUT_MS);
    loadOwnerBackend().then(
      ({ ownerBackend }) => {
        window.clearTimeout(timer);
        if (!cancelled) setBackend(ownerBackend(studioFetch, csrfToken));
      },
      () => {
        window.clearTimeout(timer);
        failed();
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [unavailable, csrfToken]);

  /**
   * Writes this tab's unsaved text to the journal, dated by its last edit,
   * or removes this tab's entry once nothing is unsaved. Another tab's entry
   * stays as it is.
   */
  const flush = useCallback(() => {
    const current = latest.current;
    const store = storage();
    const own = tab.current;
    if (!store || !own || current.phase !== 'ready') return;
    // This tab's own entry for another draft stays until the owner takes it or lets it go.
    if (current.orphan?.tabId === own) return;
    const now = Date.now();
    if (current.local && current.draft && isDirty(current)) {
      const entry: JournalEntry = {
        tabId: own,
        draftId: current.draft.draftId,
        baseVersion: current.draft.version,
        documents: current.local,
        savedAt: editedAt.current ?? now,
      };
      // Past the cap, the oldest tab's text goes: say so, rather than let it go unseen.
      const dropped = dropsOnWrite(store, entry, now).length;
      writeEntry(store, entry, now);
      if (dropped > 0) {
        setNotice(
          `This browser keeps unsaved text for at most ${JOURNAL_MAX_ENTRIES} Studio tabs, so the oldest ${dropped === 1 ? "tab's was" : `${dropped} tabs' were`} let go.`,
        );
      }
    } else if (current.draft) {
      removeEntry(store, own, now);
    }
  }, []);

  /** Drops every tab's unsaved text and this page's, as a discard at sign-out does. */
  const discard = useCallback(() => {
    const store = storage();
    if (store) clearJournal(store);
    dispatch({ type: 'expired' });
  }, []);

  const end = useCallback(
    (why: 'session_ended' | 'signed_out', { keep = true }: { keep?: boolean } = {}) =>
      endSession(
        {
          // Text the owner let go elsewhere stays gone: nothing writes it back.
          flush: keep ? flush : () => {},
          drop: () => dispatch({ type: 'expired' }),
          setTitle: (title) => {
            document.title = title;
          },
          here: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
          navigate: (location) => window.location.assign(location),
        },
        why,
      ),
    [flush],
  );

  const load = useCallback(async (from: StudioBackend) => {
    const [draft, live] = await Promise.all([from.workingDraft(), from.live(), claimed.current]);
    if (draft.kind === 'signed-out' || live.kind === 'signed-out') return;
    if (draft.kind === 'failed') {
      dispatch({ type: 'failed', error: draft.message });
      return;
    }
    const store = storage();
    const own = tab.current ?? '';
    // Another tab's entry only once that tab is gone: an open one still holds its text.
    const open = await openTabs();
    const now = Date.now();
    const restorable = store
      ? readJournal(store, now).filter((entry) => mayRestore(entry.tabId, own, open))
      : [];
    const found = entryFor(restorable, own, draft.value?.draftId ?? null);
    // Text another tab left for the working draft, as a closed tab leaves it, becomes this tab's.
    if (store && found && found.tabId !== own && found.draftId === draft.value?.draftId) {
      writeEntry(store, { ...found, tabId: own }, now);
      removeEntry(store, found.tabId, now);
    }
    editedAt.current = found?.savedAt ?? null;
    dispatch({
      type: 'loaded',
      draft: draft.value,
      live: live.kind === 'read' ? live.value : null,
      journal: found,
    });
  }, []);

  useEffect(() => {
    if (backend) void load(backend);
  }, [backend, load]);

  // The journal follows the editor: each pause in typing, and every save.
  // Leaving the page, or the session ending, writes it at once.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      journalTimer.current = null;
      flush();
    }, JOURNAL_PAUSE_MS);
    journalTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (journalTimer.current === timer) journalTimer.current = null;
    };
  }, [session.local, session.draft, session.conflict, session.orphan, flush]);

  // A 401 anywhere, or another tab's sign-out: keep the journal, then leave,
  // unless the owner chose to discard it there, when this tab drops its text too.
  useEffect(() => {
    const required = (event: Event) => {
      event.preventDefault();
      // This tab's own sign-out is already taking it to sign-in, as signed out: a 401 that
      // comes after it, such as the preview's grant going as the page hides, says nothing new.
      if (signingOut.current) return;
      end('session_ended');
    };
    window.addEventListener(AUTH_REQUIRED, required);
    // Another tab's choice wins over a plain sign-out it sent first, as its preview's grant
    // ending does, so a discard is never undone by this tab writing its text back.
    const signedOut = signOutListener({
      discard: () => {
        discard();
        document.title = NEUTRAL_TITLE;
        window.location.assign(SIGNED_OUT_LOCATION);
      },
      keep: () => end('signed_out'),
      wait: (run, ms) => {
        const timer = window.setTimeout(run, ms);
        return () => window.clearTimeout(timer);
      },
    });
    const unsubscribe = onSignedOut(signedOut.heard);
    // Into the back-forward cache, the page hides before it's frozen, and a
    // restore shows nothing until the session checks out.
    const { pagehide, pageshow } = pageCacheHandlers({
      flush,
      cancelPending: () => {
        if (journalTimer.current !== null) window.clearTimeout(journalTimer.current);
        journalTimer.current = null;
      },
      hide: () => flushSync(() => setVerified(false)),
      recheck: () => {
        // A page back from the cache is no longer leaving: a 401 there means what it says.
        signingOut.current = false;
        if (!backend) return;
        void backend.session().then((ok) => {
          if (ok) {
            setVerified(true);
            void load(backend);
          } else {
            // It may have missed a discard while cached: its text goes back only while its entry is there.
            const store = storage();
            const keep =
              store !== null && restoredMayKeep(readJournal(store, Date.now()), tab.current);
            end('session_ended', { keep });
          }
        });
      },
    });
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => {
      window.removeEventListener(AUTH_REQUIRED, required);
      unsubscribe();
      signedOut.stop();
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
    };
  }, [backend, discard, end, flush, load]);

  // The task follows the URL's fragment, so Back and a link both reach it.
  useEffect(() => {
    const follow = () => setTask(taskFromHash(tasks));
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [tasks]);

  // Studio couldn't load: its Reload control takes focus, so the keyboard is where the way out is.
  useEffect(() => {
    if (backendFailed && backend === null) reload.current?.focus();
  }, [backendFailed, backend]);

  // The store couldn't read the draft as Studio loaded: its Try again control takes focus.
  const loadFailed =
    !unavailable && verified && session.phase === 'loading' && session.error !== null;
  useEffect(() => {
    if (loadFailed) retry.current?.focus();
  }, [loadFailed]);

  // A failure state that gives way, as a late chunk arriving or a retry does, takes its focused
  // control with it: focus goes to the task area, not the page's body.
  const stuck = (backendFailed && backend === null) || loadFailed;
  const wasStuck = useRef(false);
  useEffect(() => {
    if (wasStuck.current && !stuck) {
      const focused = document.activeElement;
      if (focused === null || focused === document.body) {
        document.getElementById('studio-main')?.focus();
      }
    }
    wasStuck.current = stuck;
  }, [stuck]);

  const active = tasks.find((each) => each.id === task) ?? tasks[0];
  // Appearance asked for the problems: now that the task is Content, its findings line shows them.
  const activeId = active?.id;
  useEffect(() => {
    if (activeId !== 'content' || !showOnContent.current) return;
    showOnContent.current = false;
    findings.current?.show();
  }, [activeId]);

  // Appearance with no draft yet works over the live revision (owner direction,
  // 2026-10-25): its documents are read once the task opens, and nothing is written.
  const liveId = session.live?.liveRevisionId ?? null;
  const wantsLive =
    active?.id === 'appearance' &&
    session.phase === 'ready' &&
    session.draft === null &&
    liveId !== null &&
    policy.allowed.includes('history.read');
  useEffect(() => {
    if (!wantsLive || !backend || !isOwnerBackend(backend) || liveId === null) return;
    if (liveRevision?.id === liveId) return;
    let cancelled = false;
    void backend.revision(liveId).then((found) => {
      if (cancelled) return;
      setLiveRevision({ id: liveId, detail: found.kind === 'read' ? found.value : null });
    });
    return () => {
      cancelled = true;
    };
  }, [wantsLive, backend, liveId, liveRevision]);
  const live: RevisionDetail | null | undefined =
    liveId === null || !policy.allowed.includes('history.read')
      ? null
      : liveRevision?.id === liveId
        ? liveRevision.detail
        : undefined;
  useEffect(() => {
    document.title =
      session.phase === 'expired' || !active ? NEUTRAL_TITLE : `${active.label}, ${NEUTRAL_TITLE}`;
  }, [active, session.phase]);

  async function save(over?: number, documents?: DraftSession['local'], what = 'the draft') {
    const current = latest.current;
    const version = over ?? expectedVersion(current);
    const sent = documents ?? current.local;
    if (!backend || !current.draft || !sent || version === null || current.saving) return;
    dispatch({ type: 'save-started' });
    const result = await backend.saveDraft({
      draftId: current.draft.draftId,
      expectedVersion: version,
      documents: sent,
    });
    switch (result.kind) {
      case 'saved':
        dispatch({ type: 'saved', draft: result.draft });
        setNotice(`Saved ${what} as version ${result.draft.version}.`);
        break;
      case 'conflict':
        dispatch({ type: 'conflicted', theirs: result.theirs });
        setNotice(
          `Not saved: version ${result.theirs.version} was saved first. Your changes are kept.`,
        );
        break;
      case 'failed':
        dispatch({ type: 'failed', error: result.message });
        setNotice(`Not saved. ${result.message}`);
        break;
      case 'signed-out':
        break;
    }
  }

  /** Applies the Appearance workspace's edits as a new draft version, through #4's applyEdits. */
  async function applyAppearance(edits: SiteEdit[]) {
    const current = latest.current;
    if (!backend || !current.draft || current.saving || isDirty(current) || edits.length === 0)
      return;
    dispatch({ type: 'save-started' });
    const result = await backend.applyEdits({
      draftId: current.draft.draftId,
      expectedVersion: current.draft.version,
      edits,
    });
    if (result.kind === 'saved') {
      // Text typed in the meantime stays, and meets the applied version as a conflict.
      const typed = isDirty(latest.current);
      dispatch({ type: 'applied', draft: result.draft });
      setNotice(
        typed
          ? `Applied the appearance as draft version ${result.draft.version}. Your changes since are kept.`
          : `Applied the appearance as draft version ${result.draft.version}.`,
      );
    } else if (result.kind === 'conflict') {
      if (isDirty(latest.current)) {
        // Text typed in the meantime stays, against the newer version, as a stale save's does.
        dispatch({ type: 'conflicted', theirs: result.theirs });
        setNotice(
          `Not applied: version ${result.theirs.version} was saved first. Your changes are kept.`,
        );
        return;
      }
      setNotice(`Not applied: version ${result.theirs.version} was saved first. It shows now.`);
      await load(backend);
    } else if (result.kind === 'failed') {
      dispatch({ type: 'failed', error: result.message });
      setNotice(`Not applied. ${result.message}`);
    }
  }

  /**
   * Save draft from any task (OWN-5): the Appearance workspace's unsaved picks and the editor's
   * unsaved text in one write. With no text unsaved, the picks go through applyEdits as before.
   * With text too, the picks are made in the site document's text by the store's own applyEdits,
   * as the editor's own change, so a conflict keeps them with the text, and draft.save sends
   * every document with the version read: one write, one version check.
   */
  async function saveTogether(edits: SiteEdit[]) {
    const current = latest.current;
    if (!backend || !current.draft || !current.local || current.saving) return;
    if (!isDirty(current)) {
      await applyAppearance(edits);
      return;
    }
    const folded = foldAppearance(current.local, edits);
    if (!folded.ok) {
      setNotice(`Not saved. ${folded.message}`);
      return;
    }
    if (edits.length === 0) {
      await save();
      return;
    }
    editedAt.current = Date.now();
    dispatch({ type: 'edited', name: 'site', sourceText: folded.documents.site.sourceText });
    await save(undefined, folded.documents, 'your changes and the appearance');
  }

  /**
   * The first Apply, with no draft yet: starts the working draft from the
   * live revision through draft.create, then applies `edits` over the
   * version it started at, as one action. Opening the task wrote nothing.
   */
  async function startAndApply(edits: SiteEdit[]) {
    const current = latest.current;
    if (!backend || current.draft || current.saving || edits.length === 0) return;
    dispatch({ type: 'save-started' });
    const started = await backend.startDraft();
    if (started.kind === 'conflict') {
      // Another tab started one first: it shows now, and the choices go with this view.
      setNotice('Not applied: a draft was started in another tab first. It shows now.');
      await load(backend);
      return;
    }
    if (started.kind === 'failed') {
      dispatch({ type: 'failed', error: started.message });
      setNotice(`Not applied. ${started.message}`);
      return;
    }
    if (started.kind !== 'saved') return;
    const result = await backend.applyEdits({
      draftId: started.draft.draftId,
      expectedVersion: started.draft.version,
      edits,
    });
    if (result.kind === 'saved') {
      dispatch({ type: 'applied', draft: result.draft });
      setNotice(`Started the draft and applied the appearance as version ${result.draft.version}.`);
    } else if (result.kind === 'conflict') {
      setNotice(
        `Started the draft, but not applied: version ${result.theirs.version} was saved first. It shows now.`,
      );
      await load(backend);
    } else if (result.kind === 'failed') {
      dispatch({ type: 'saved', draft: started.draft });
      setNotice(
        `Started the draft as version ${started.draft.version}, but the appearance wasn't applied. ${result.message}`,
      );
    }
  }

  async function start() {
    if (!backend || session.saving) return;
    dispatch({ type: 'save-started' });
    const result = await backend.startDraft();
    if (result.kind === 'saved') {
      dispatch({ type: 'saved', draft: result.draft });
      setNotice(`Started the draft from the live revision, version ${result.draft.version}.`);
    } else if (result.kind === 'conflict') {
      // Another tab started one first: read it.
      await load(backend);
    } else if (result.kind === 'failed') {
      dispatch({ type: 'failed', error: result.message });
      setNotice(`No draft started. ${result.message}`);
    }
  }

  function keepMine() {
    const theirs = session.conflict;
    if (!theirs) return;
    dispatch({ type: 'keep-mine' });
    void save(theirs.version);
  }

  /** Whether sign-out asks first: this tab has unsaved text, or the journal holds any tab's. */
  function journalHolds(): boolean {
    if (isDirty(latest.current) || latest.current.orphan) return true;
    const store = storage();
    return store !== null && readJournal(store, Date.now()).length > 0;
  }

  async function signOut(keep: boolean): Promise<boolean> {
    const store = storage();
    if (store) {
      if (keep) flush();
      else clearJournal(store);
    }
    if (!backend) return false;
    // The other tabs hear the choice: on discard, none writes its text back.
    if (!(await backend.signOut(keep ? 'keep' : 'discard'))) return false;
    signingOut.current = true;
    // Nothing of the session stays on the page as it goes.
    if (keep) dispatch({ type: 'expired' });
    else discard();
    document.title = NEUTRAL_TITLE;
    window.location.assign(SIGNED_OUT_LOCATION);
    return true;
  }

  const lines = stateLines(session);
  const ready = session.phase === 'ready' && verified;
  const failedToLoad = backendFailed && backend === null;
  const dirty = isDirty(session);
  // The Appearance view is a workspace (owner direction, 2026-10-25): its top
  // bar takes Studio's name, the task links, Save draft, Publish, and Sign
  // out, and its bottom bar the state line. Content is the same workspace
  // with its fields in the rail, over the same stage (the round 4 design
  // review's P0-1), once there's a draft whose site reads. A conflict or
  // another tab's text keeps the full layout, so its panel shows.
  const contentInSplit =
    active?.id === 'content' &&
    session.draft !== null &&
    session.local !== null &&
    appearanceOf(session.draft) !== null;
  const workspace =
    ready &&
    (active?.id === 'appearance' || contentInSplit) &&
    preview !== null &&
    session.conflict === null &&
    session.orphan === null;
  // The confirmation goes with the workspace it was asked over, as to an orphan panel or a site
  // that stops reading, so it never opens again on its own when the workspace comes back (C-L3).
  // Adjusted as the render sees the change, React's way for state that follows a value.
  const [workspaceWas, setWorkspaceWas] = useState(workspace);
  if (workspaceWas !== workspace) {
    setWorkspaceWas(workspace);
    if (!workspace) setPublishing(false);
  }
  const stateList = (
    <dl className="studio-state__lines">
      {lines.map((line) => (
        <div
          key={line.id}
          className="studio-state__line"
          data-state={line.id}
          data-tone={line.tone}
        >
          <dt>{line.label}</dt>
          <dd>{line.text}</dd>
        </div>
      ))}
    </dl>
  );
  const signOutControl = <SignOut shouldAsk={journalHolds} onSignOut={signOut} />;

  return (
    <StudioFrame
      status={<p className="studio-shell__signed-in">Signed in</p>}
      actions={signOutControl}
      tasks={tasks}
      current={active?.id}
      workspace={workspace}
      noScript={
        <p className="studio-alert">
          Portfolio Studio needs JavaScript: it reads and saves the draft from the browser. Turn
          JavaScript on for this site, then reload the page.
        </p>
      }
      state={
        <>
          {ready ? (
            stateList
          ) : failedToLoad ? (
            <div className="studio-alert" role="alert">
              <p>
                Studio couldn&apos;t load: the part that reaches the draft and the live site
                didn&apos;t arrive. Check your connection, then reload Studio.
              </p>
              <button
                ref={reload}
                type="button"
                className="studio-button"
                onClick={() => window.location.reload()}
              >
                Reload Studio
              </button>
            </div>
          ) : loadFailed ? (
            <div className="studio-alert" role="alert">
              <p>Studio couldn&apos;t read the draft. {session.error}</p>
              <button
                ref={retry}
                type="button"
                className="studio-button"
                onClick={() => {
                  dispatch({ type: 'retry' });
                  if (backend) void load(backend);
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <p
              className="studio-state__waiting"
              // Still loading or checking: assistive technology, and #11's cells, wait for it.
              aria-busy={!unavailable && session.phase !== 'expired' ? true : undefined}
            >
              {unavailable
                ? "Studio's storage isn't available in this deployment."
                : session.phase === 'expired'
                  ? 'Signed out.'
                  : verified
                    ? 'Loading the draft…'
                    : 'Checking your session…'}
            </p>
          )}
          <p className="studio-state__notice" role="status">
            {notice}
          </p>
          {session.error && ready ? (
            <p className="studio-alert" role="alert">
              {session.error}
            </p>
          ) : null}
        </>
      }
    >
      {stuck && active ? (
        // Which task couldn't load, so the owner knows where they were.
        <section className="studio-task" aria-labelledby="studio-task-heading">
          <h2 id="studio-task-heading" className="studio-task__heading">
            {active.label}
          </h2>
          <p className="studio-task__pending">
            {failedToLoad
              ? "This task needs the part of Studio that couldn't load."
              : "This task needs the draft, which Studio couldn't read."}
          </p>
        </section>
      ) : null}
      {ready && active ? (
        <section className="studio-task" aria-labelledby="studio-task-heading">
          <h2 id="studio-task-heading" className="studio-task__heading">
            {active.label}
          </h2>
          {session.orphan ? (
            <OrphanPanel
              orphan={session.orphan}
              canAdopt={session.local !== null}
              onAdopt={() => {
                // Its text becomes this tab's, under this tab's entry, dated by its own last edit.
                const store = storage();
                if (store && session.orphan && session.orphan.tabId !== tab.current) {
                  removeEntry(store, session.orphan.tabId, Date.now());
                }
                editedAt.current = session.orphan?.savedAt ?? null;
                dispatch({ type: 'adopt-orphan' });
              }}
              onDrop={() => {
                const store = storage();
                if (store && session.orphan) {
                  removeEntry(store, session.orphan.tabId, Date.now());
                }
                dispatch({ type: 'drop-orphan' });
              }}
            />
          ) : null}
          {session.conflict && session.local ? (
            <ConflictPanel
              theirs={session.conflict}
              fileName={fileName}
              saving={session.saving}
              onKeepMine={keepMine}
              onTakeTheirs={() => dispatch({ type: 'take-theirs' })}
            />
          ) : null}
          {active.pending ? (
            <p className="studio-task__pending">{active.pending}</p>
          ) : active.id === 'history' ? (
            // Publish history needs the owner's backend: a demo's has no publish or rollback.
            backend && isOwnerBackend(backend) ? (
              <HistoryTask
                backend={backend}
                session={session}
                canPublish={policy.allowed.includes('publish')}
                canRollback={policy.allowed.includes('rollback')}
                onMoved={() => load(backend)}
                catalog={appearance}
              />
            ) : backend ? (
              <p className="studio-task__pending">
                Publish history needs the owner&apos;s store, which this Studio doesn&apos;t have.
              </p>
            ) : null
          ) : active.id === 'validation' ? (
            <FindingsSummary draft={session.draft} dirty={dirty} fileName={fileName} />
          ) : active.id === 'appearance' || (workspace && contentInSplit) ? (
            // One element for both tasks, so the stage, its frame, page, and device stay put.
            <AppearanceWorkspace
              draft={session.draft}
              dirty={dirty}
              saving={session.saving}
              canWrite={canWrite && session.conflict === null && session.orphan === null}
              catalog={appearance}
              csrfToken={csrfToken}
              preview={preview}
              live={session.draft ? null : live}
              chrome={{
                brand: <StudioMark tag={siteName(host, session.draft ?? live) || undefined} site />,
                // Validation is the state line's Checks, which links to it.
                nav: (
                  <TaskNav
                    tasks={tasks.filter((each) => each.id !== 'validation')}
                    current={active.id}
                  />
                ),
                session: signOutControl,
                states: stateChips(session),
                notice,
                announce: setNotice,
                liveNumber: session.live?.seq ?? null,
                publish: {
                  allowed: policy.allowed.includes('publish'),
                  blocker: publishBlocker(session),
                  blocking: session.draft ? blockingCount(session.draft) : 0,
                  ...(backend && isOwnerBackend(backend)
                    ? { open: () => setPublishing(true) }
                    : {}),
                },
              }}
              content={
                active.id === 'content' && session.draft && session.local
                  ? {
                      rail: (
                        <ContentEditor
                          documents={session.local}
                          draft={session.draft}
                          names={namesIn(session.local)}
                          fileName={fileName}
                          readOnly={!canWrite}
                          dirty={dirty}
                          saving={session.saving}
                          onEdit={(name, sourceText) => {
                            editedAt.current = Date.now();
                            dispatch({ type: 'edited', name, sourceText });
                          }}
                          onSave={() => void save()}
                          saveInBar
                          findings={findings}
                        />
                      ),
                      onSave: (edits: SiteEdit[]) => void saveTogether(edits),
                      showProblems: () => findings.current?.show(),
                    }
                  : null
              }
              onApply={(edits) => void (session.draft ? saveTogether(edits) : startAndApply(edits))}
              {...(active.id === 'appearance' && session.draft
                ? {
                    showProblemsInContent: () => {
                      showOnContent.current = true;
                      // The task links' own switch, so Back returns to Appearance.
                      window.location.hash = 'content';
                    },
                  }
                : {})}
            />
          ) : session.draft && session.local ? (
            <ContentEditor
              documents={session.local}
              draft={session.draft}
              names={namesIn(session.local)}
              fileName={fileName}
              readOnly={!canWrite || session.conflict !== null || session.orphan !== null}
              dirty={dirty}
              saving={session.saving}
              onEdit={(name, sourceText) => {
                editedAt.current = Date.now();
                dispatch({ type: 'edited', name, sourceText });
              }}
              onSave={() => void save()}
            />
          ) : (
            <div className="studio-task__empty">
              <p>
                There is no working draft yet. Start one from the live revision to edit the
                portfolio and site documents.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  className="studio-button"
                  aria-disabled={session.saving ? true : undefined}
                  onClick={() => void start()}
                >
                  Start a draft
                </button>
              ) : null}
            </div>
          )}
          {workspace && backend && isOwnerBackend(backend) && policy.allowed.includes('publish') ? (
            <PublishDialog
              open={publishing}
              backend={backend}
              session={session}
              catalog={appearance}
              onClose={() => setPublishing(false)}
              onMoved={async (report) => {
                setNotice(report);
                await load(backend);
              }}
            />
          ) : null}
        </section>
      ) : null}
    </StudioFrame>
  );
}
