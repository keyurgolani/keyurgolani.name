import type { ReactNode } from 'react';
import type { StudioTask, TaskId } from '~/lib/studio/tasks';

// Studio's frame (#8, shared with #9's Demo Studio): the header with
// Studio's name, the task navigation, each task's anchor, and the state
// section, always on screen. Owner Studio and Demo Studio each fill it with
// their own header status and actions, state lines, and task body. It holds
// no state and reaches no backend, so Demo Studio renders it without any of
// the owner's code.

export interface StudioFrameProps {
  /** The header's status line, such as who is signed in, or the demo's sandbox line. */
  readonly status: ReactNode;
  /** The header's actions, such as signing out. */
  readonly actions?: ReactNode;
  readonly tasks: readonly StudioTask[];
  /** The task on screen, which its link marks as the current page. */
  readonly current: TaskId | undefined;
  /** What the first task's anchor says without JavaScript, which Studio needs by design. */
  readonly noScript: ReactNode;
  /** The state section's body, below its heading. */
  readonly state: ReactNode;
  /** The task area, below the state section. */
  readonly children?: ReactNode;
}

export function StudioFrame({
  status,
  actions,
  tasks,
  current,
  noScript,
  state,
  children,
}: StudioFrameProps) {
  return (
    <div className="studio-shell">
      <header className="studio-shell__header">
        <h1 className="studio-shell__name">Portfolio Studio</h1>
        {status}
        {actions}
      </header>
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
      <main className="studio-shell__main" id="studio-main" tabIndex={-1}>
        {/* Each task link's fragment names an element, with or without the shell's script. */}
        <div className="studio-shell__anchors">
          {tasks.map((each, index) =>
            // Focusable, so a task link moves focus to the task area, as a skip link does.
            index === 0 ? (
              <div key={each.id} id={each.id} tabIndex={-1}>
                {/* Studio needs JavaScript by design, and says so where its first task starts.
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
        <section className="studio-state" aria-labelledby="studio-state-heading">
          <h2 id="studio-state-heading" className="studio-state__heading">
            Where things stand
          </h2>
          {state}
        </section>
        {children}
      </main>
    </div>
  );
}
