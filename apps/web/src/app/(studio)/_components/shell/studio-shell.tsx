'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type { StudioBackend, StudioPolicy } from '~/lib/studio/backend';
import { namesIn, type DocumentName } from '~/lib/studio/documents';
import {
  draftSession,
  expectedVersion,
  INITIAL_SESSION,
  isDirty,
  type DraftSession,
} from '~/lib/studio/draft-session';
import {
  clearJournal,
  entryFor,
  pruneJournal,
  readJournal,
  removeEntry,
  tabId,
  writeEntry,
} from '~/lib/studio/journal';
import { pageCacheHandlers } from '~/lib/studio/page-cache';
import { holdTab, mayRestore, openTabs } from '~/lib/studio/tab-presence';
import { endSession, NEUTRAL_TITLE } from '~/lib/studio/session-end';
import { stateLines } from '~/lib/studio/state-model';
import { tasksFor, type StudioTask, type TaskId } from '~/lib/studio/tasks';
import { AUTH_REQUIRED, onSignedOut, SIGNED_OUT_LOCATION, studioFetch } from '~/lib/studio-fetch';
import { ConflictPanel, OrphanPanel } from './conflict-panel';
import { SignOut } from './sign-out';
import { SourceMode } from './source-mode';
import { ValidationSummary } from './validation-summary';
import { AppearanceWorkspace, type PreviewSetup } from './appearance-workspace';
import type { AppearanceCatalog, SiteEdit } from '~/lib/studio/appearance';

// The Owner Studio shell (#8, Slice 1): the task navigation, the textual
// state model, always on screen, and the content task's expert source mode
// over #3's one working draft, with the local journal and the conflict
// path. It renders only inside /studio's page, after requireOwnerPage let
// it, so nothing here, the journal included, renders before
// authentication. It reaches storage only through the StudioBackend its
// policy picks: the owner adapter, loaded only under owner.

/** How long typing pauses before the journal takes the editor's text. */
const JOURNAL_PAUSE_MS = 300;

/** A document's file name as the owner knows it. */
const fileName = (name: DocumentName, format: 'yaml' | 'json') =>
  `${name}.${format === 'yaml' ? 'yml' : 'json'}`;

function taskFromHash(tasks: readonly StudioTask[]): TaskId {
  const id = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (tasks.find((task) => task.id === id) ?? tasks[0]!).id;
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
  // Only the owner adapter exists yet: #9 brings the demo's.
  const unavailable = policy.profile !== 'owner';
  // False while a back-forward cache restore re-checks the session: nothing shows until it does.
  const [verified, setVerified] = useState(true);
  const [notice, setNotice] = useState('');
  const latest = useRef<DraftSession>(session);
  // This tab's id in the journal, and when the editor's text last changed.
  const tab = useRef<string | null>(null);
  const editedAt = useRef<number | null>(null);
  // Before any other effect reads it: the session this render shows.
  useLayoutEffect(() => {
    latest.current = session;
  });
  // Before the shell loads anything: what may not stay in the journal goes.
  useLayoutEffect(() => {
    tab.current = tabId(tabStorage());
    holdTab(tab.current);
    const store = storage();
    if (store) pruneJournal(store, Date.now());
  }, []);
  const canWrite = policy.allowed.includes('draft.write');

  // The owner adapter, loaded only when the policy says the profile is owner.
  useEffect(() => {
    let cancelled = false;
    if (unavailable) return;
    void import('~/lib/studio/owner-backend').then(({ ownerBackend }) => {
      if (!cancelled) setBackend(ownerBackend(studioFetch, csrfToken));
    });
    return () => {
      cancelled = true;
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
      writeEntry(
        store,
        {
          tabId: own,
          draftId: current.draft.draftId,
          baseVersion: current.draft.version,
          documents: current.local,
          savedAt: editedAt.current ?? now,
        },
        now,
      );
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
    (why: 'session_ended' | 'signed_out') =>
      endSession(
        {
          flush,
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
    const [draft, live] = await Promise.all([from.workingDraft(), from.live()]);
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
    const timer = window.setTimeout(flush, JOURNAL_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [session.local, session.draft, session.conflict, session.orphan, flush]);

  // A 401 anywhere, or another tab's sign-out: keep the journal, then leave,
  // unless the owner chose to discard it there, when this tab drops its text too.
  useEffect(() => {
    const required = (event: Event) => {
      event.preventDefault();
      end('session_ended');
    };
    window.addEventListener(AUTH_REQUIRED, required);
    const unsubscribe = onSignedOut((choice) => {
      if (choice === 'discard') {
        discard();
        document.title = NEUTRAL_TITLE;
        window.location.assign(SIGNED_OUT_LOCATION);
      } else {
        end('signed_out');
      }
    });
    // Into the back-forward cache, the page hides before it's frozen, and a
    // restore shows nothing until the session checks out.
    const { pagehide, pageshow } = pageCacheHandlers({
      flush,
      hide: () => flushSync(() => setVerified(false)),
      recheck: () => {
        if (!backend) return;
        void backend.session().then((ok) => {
          if (ok) {
            setVerified(true);
            void load(backend);
          } else {
            end('session_ended');
          }
        });
      },
    });
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => {
      window.removeEventListener(AUTH_REQUIRED, required);
      unsubscribe();
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

  const active = tasks.find((each) => each.id === task) ?? tasks[0];
  useEffect(() => {
    document.title =
      session.phase === 'expired' || !active ? NEUTRAL_TITLE : `${active.label}, ${NEUTRAL_TITLE}`;
  }, [active, session.phase]);

  async function save(over?: number) {
    const current = latest.current;
    const version = over ?? expectedVersion(current);
    if (!backend || !current.draft || !current.local || version === null || current.saving) return;
    dispatch({ type: 'save-started' });
    const result = await backend.saveDraft({
      draftId: current.draft.draftId,
      expectedVersion: version,
      documents: current.local,
    });
    switch (result.kind) {
      case 'saved':
        dispatch({ type: 'saved', draft: result.draft });
        setNotice(`Saved the draft as version ${result.draft.version}.`);
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
    // Nothing of the session stays on the page as it goes.
    if (keep) dispatch({ type: 'expired' });
    else discard();
    document.title = NEUTRAL_TITLE;
    window.location.assign(SIGNED_OUT_LOCATION);
    return true;
  }

  const lines = stateLines(session);
  const ready = session.phase === 'ready' && verified;
  const dirty = isDirty(session);

  return (
    <div className="studio-shell">
      <header className="studio-shell__header">
        <h1 className="studio-shell__name">Portfolio Studio</h1>
        <p className="studio-shell__signed-in">Signed in</p>
        <SignOut shouldAsk={journalHolds} onSignOut={signOut} />
      </header>
      <nav className="studio-shell__nav" aria-label="Studio tasks">
        <ul>
          {tasks.map((each) => (
            <li key={each.id}>
              <a
                href={`#${each.id}`}
                className="studio-shell__task"
                aria-current={each.id === active?.id ? 'page' : undefined}
              >
                {each.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="studio-shell__main" id="studio-main" tabIndex={-1}>
        <section className="studio-state" aria-labelledby="studio-state-heading">
          <h2 id="studio-state-heading" className="studio-state__heading">
            Where things stand
          </h2>
          {ready ? (
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
          ) : (
            <p className="studio-state__waiting">
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
        </section>
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
            ) : active.id === 'validation' ? (
              <ValidationSummary draft={session.draft} dirty={dirty} />
            ) : active.id === 'appearance' ? (
              <AppearanceWorkspace
                draft={session.draft}
                dirty={dirty}
                saving={session.saving}
                canWrite={canWrite && session.conflict === null && session.orphan === null}
                catalog={appearance}
                csrfToken={csrfToken}
                preview={preview}
                onApply={(edits) => void applyAppearance(edits)}
              />
            ) : session.draft && session.local ? (
              <SourceMode
                documents={session.local}
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
          </section>
        ) : null}
      </main>
    </div>
  );
}
