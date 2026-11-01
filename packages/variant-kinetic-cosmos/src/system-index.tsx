'use client';

import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The system index (redesign, stream E): every section of the page, on the
// ring it belongs to, in a native modal dialog that two triggers open, the
// stage's Index and the dock's. The triggers carry invoker commands, so a
// browser that has them opens and closes it with no JavaScript; where
// they're missing, a click calls showModal() and close(). Escape closes it
// natively, the page behind it is inert, and the browser gives focus back
// to whichever trigger opened it. Following a link inside closes it first,
// then goes, so the focus coming back never scrolls the page away from the
// section. In a plate it attaches no listener.

declare module 'react' {
  // HTML's invoker commands, which React passes through but its types don't list yet.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merged declaration repeats React's type parameter.
  interface ButtonHTMLAttributes<T> {
    commandfor?: string | undefined;
    command?: string | undefined;
  }
}

/** Whether this browser runs invoker commands itself. */
function runsCommands(): boolean {
  return (
    typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype
  );
}

function dialogOf(id: string): HTMLDialogElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLDialogElement ? element : null;
}

/** A button that opens the index. */
export function IndexTrigger({
  target,
  className,
  children,
}: {
  readonly target: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const open = () => {
    const dialog = dialogOf(target);
    if (dialog && !dialog.open && !runsCommands()) dialog.showModal();
  };
  return (
    <button
      type="button"
      className={className}
      commandfor={target}
      command="show-modal"
      aria-haspopup="dialog"
      aria-controls={target}
      onClick={plate ? undefined : open}
    >
      {children}
    </button>
  );
}

/**
 * A talk's or an offer's dialog. Once script runs it opens as a modal on
 * the stages' ink, so it's K-2's inverse surface there, and its focus ring
 * is the scheme's focus-inverse; with no script its content reads inline,
 * in the page's ink, and it isn't one. Only the client marks it, as it
 * hydrates; a plate opens nothing, so it never does.
 */
export function InkDialog({
  id,
  className,
  labelledBy,
  children,
}: {
  readonly id: string;
  readonly className: string;
  readonly labelledBy: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  return (
    <dialog
      id={id}
      className={className}
      aria-labelledby={labelledBy}
      ref={plate ? undefined : (dialog) => dialog?.setAttribute('data-ui-surface', 'inverse')}
    >
      {children}
    </dialog>
  );
}

/** The button inside the index that closes it. */
export function IndexClose({
  target,
  className,
  children,
}: {
  readonly target: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const close = () => {
    if (!runsCommands()) dialogOf(target)?.close();
  };
  return (
    <button
      type="button"
      className={className}
      commandfor={target}
      command="close"
      onClick={plate ? undefined : close}
    >
      {children}
    </button>
  );
}

/**
 * A link in the index. Following it closes the dialog, whose close gives
 * focus back to the trigger, and only then goes to the section, as the link
 * would. A click with a modifier key, or one that isn't the main button, is
 * the browser's, as for any link. Focused or pointed at, it moves the
 * orrery's focus ring to its section's body and says where it is in the
 * readout, which the dialog announces politely.
 */
export function IndexLink({
  href,
  className,
  lang,
  at,
  readout,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly lang?: string;
  /** Its section's body on the index's orrery, as fractions of the drawing. */
  readonly at?: { readonly x: number; readonly y: number } | undefined;
  readonly readout?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const dialog = event.currentTarget.closest('dialog');
    if (!dialog?.open) return;
    event.preventDefault();
    const destination = event.currentTarget.href;
    dialog.addEventListener('close', () => window.location.assign(destination), { once: true });
    dialog.close();
  };
  const point = (event: FocusEvent<HTMLAnchorElement> | MouseEvent<HTMLAnchorElement>) => {
    const dialog = event.currentTarget.closest('dialog');
    if (!dialog) return;
    if (at) {
      dialog.style.setProperty('--layout-focus-x', String(at.x));
      dialog.style.setProperty('--layout-focus-y', String(at.y));
      dialog.dataset.focus = '';
    } else delete dialog.dataset.focus;
    const said = dialog.querySelector('.kc-index__readout');
    if (said && readout) said.textContent = readout;
  };
  return (
    <a
      className={className}
      href={href}
      lang={lang}
      onClick={plate ? undefined : follow}
      onFocus={plate ? undefined : point}
      onMouseEnter={plate ? undefined : point}
    >
      {children}
    </a>
  );
}
