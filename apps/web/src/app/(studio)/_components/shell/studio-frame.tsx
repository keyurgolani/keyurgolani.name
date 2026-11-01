'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { StudioTask, TaskId } from '~/lib/studio/tasks';

// Studio's frame (#8, shared with #9's Demo Studio): the header with
// Studio's name, the task navigation, each task's anchor, and the state
// section, always on screen. Owner Studio and Demo Studio each fill it with
// their own header status and actions, state lines, and task body. It holds
// no state and reaches no backend, so Demo Studio renders it without any of
// the owner's code.
//
// The Appearance view is a workspace (owner direction, 2026-10-25): the
// frame gives the whole viewport to the task, whose 48px top bar has Studio's
// name and the task links (TaskNav), and whose bottom bar has the state. The
// state section stays, out of sight, for the live region and any alert.

export interface StudioFrameProps {
  /** The header's status line, such as who is signed in, or the demo's sandbox line. */
  readonly status: ReactNode;
  /** The header's actions, such as signing out. */
  readonly actions?: ReactNode;
  readonly tasks: readonly StudioTask[];
  /** The task on screen, which its link marks as the current page. */
  readonly current: TaskId | undefined;
  /** What the Content task's anchor, or else the first task's, says without JavaScript, which Studio needs by design. */
  readonly noScript: ReactNode;
  /** The state section's body, below its heading. */
  readonly state: ReactNode;
  /** The task area, below the state section. */
  readonly children?: ReactNode;
  /**
   * The Appearance view's workspace: no header, navigation, or visible state
   * section, since the task's own bar carries Studio's name, the task menu,
   * and the state. The state section's live region and alerts stay.
   */
  readonly workspace?: boolean;
}

export function StudioFrame({
  status,
  actions,
  tasks,
  current,
  noScript,
  state,
  children,
  workspace = false,
}: StudioFrameProps) {
  const noticeAt = tasks.some((each) => each.id === 'content') ? 'content' : tasks[0]?.id;
  // A task link is a skip link (WCAG 2.4.1): the browser moves focus to its anchor, and when
  // the task's view takes the place of the one that held it, as the workspace does, focus
  // goes to the new anchor rather than the page's body. Not on the first render, which no
  // link caused.
  const taskIds = tasks.map((each) => each.id).join(' ');
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      return;
    }
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (taskIds.split(' ').includes(id))
      document.getElementById(id)?.focus({ preventScroll: true });
  }, [current, workspace, taskIds]);
  const anchors = (
    <div className="studio-shell__anchors">
      {tasks.map((each) =>
        // Focusable, so a task link moves focus to the task area, as a skip link does.
        each.id === noticeAt ? (
          <div key={each.id} id={each.id} tabIndex={-1}>
            {/* Studio needs JavaScript by design, and says so where its Content task
                starts, in both Studios, since a visitor who lands with no script
                reads it there; a task list with no Content task says so at its first.
                Without it the shell never loads, so its waiting line goes too. */}
            <noscript>
              <style>{'.studio-state__waiting { display: none; }'}</style>
              {noScript}
            </noscript>
          </div>
        ) : (
          <span key={each.id} id={each.id} tabIndex={-1} />
        ),
      )}
    </div>
  );
  // One tree for both, the workspace's slots for the header and navigation empty, so the main
  // and the state section stay the same elements as the shell becomes the workspace, as it does
  // once a draft loads after Try again: the focus they hold stays rather than going to the body.
  return (
    <div className={workspace ? 'studio-shell studio-shell--workspace' : 'studio-shell'}>
      {workspace ? null : (
        <header className="studio-shell__header">
          <h1 className="studio-shell__name">Portfolio Studio</h1>
          {status}
          {actions}
        </header>
      )}
      {workspace ? null : (
        <nav className="studio-shell__nav" aria-label="Studio tasks">
          <ul>
            {tasks.map((each) => (
              <li key={each.id}>
                <a
                  href={`#${each.id}`}
                  className="studio-shell__task"
                  aria-current={each.id === current ? 'page' : undefined}
                >
                  {each.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main className="studio-shell__main" id="studio-main" tabIndex={-1}>
        {/* Each task link's fragment names an element, with or without the shell's script. */}
        {anchors}
        <section
          className={workspace ? 'studio-state studio-state--quiet' : 'studio-state'}
          {...(workspace
            ? { 'aria-label': 'Where things stand' }
            : { 'aria-labelledby': 'studio-state-heading' })}
        >
          {workspace ? null : (
            <h2 id="studio-state-heading" className="studio-state__heading">
              Where things stand
            </h2>
          )}
          {state}
        </section>
        {children}
      </main>
    </div>
  );
}

/**
 * The workspace's task links, in its top bar (the Studio mockup, owner
 * direction, 2026-10-25): every task a click away, the current one marked
 * with aria-current and a bar under it. A long label shows short, and the
 * link keeps the full one as its name.
 */
export function TaskNav({
  tasks,
  current,
}: {
  readonly tasks: readonly StudioTask[];
  readonly current: TaskId | undefined;
}) {
  return (
    <nav className="studio-tasks" aria-label="Studio tasks">
      {tasks.map((each) => (
        <a
          key={each.id}
          href={`#${each.id}`}
          className="studio-tasks__link studio-shell__task"
          aria-current={each.id === current ? 'page' : undefined}
          {...(each.short ? { 'aria-label': each.label, title: each.label } : {})}
        >
          {each.short ?? each.label}
        </a>
      ))}
    </nav>
  );
}
