'use client';

// Dialog (#19, Slice 3, item 2): a native modal dialog and the action that
// opens it. The trigger and the close button carry invoker commands, so a
// browser that has them opens and closes the dialog with no JavaScript;
// where they're missing, the click calls showModal() and close(). Escape
// closes it natively, the page stays inert behind it, the page's scrolling
// stops in CSS (never document.body.style), and focus goes back to the
// trigger when it closes. It takes a local id and adds the boundary's
// prefix. In a plate it attaches no listener.

import { useRef, type ReactNode } from 'react';
import type { ActionEmphasis } from '../slots';
import { partId } from '../ids';
import { useBoundary, useBoundaryId } from '../react/boundary-root';
import { Action } from './action';

export interface DialogProps {
  /** A local id, which the boundary's prefix starts. The dialog's id. */
  readonly id: string;
  /** The trigger's label. */
  readonly trigger: ReactNode;
  readonly triggerEmphasis?: ActionEmphasis;
  /** The dialog's title, which names it. */
  readonly title: ReactNode;
  /** What it's for, which describes it. */
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly closeLabel?: string;
  /** The title's heading level. */
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/** Whether this browser runs invoker commands itself. */
function runsCommands(): boolean {
  return (
    typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype
  );
}

export function Dialog({
  id: local,
  trigger,
  triggerEmphasis = 'secondary',
  title,
  description,
  children,
  closeLabel = 'Close',
  headingLevel = 2,
}: DialogProps) {
  const id = useBoundaryId(local);
  const { plate } = useBoundary();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const titleId = partId(id, 'title');
  const descriptionId = partId(id, 'description');
  const Heading = `h${headingLevel}` as const;

  const open = () => {
    const element = dialog.current;
    if (element && !element.open && !runsCommands()) element.showModal();
  };
  const close = () => {
    if (!runsCommands()) dialog.current?.close();
  };
  // However it closed, focus goes back to what opened it.
  const returnFocus = () => {
    const element = opener.current;
    if (element && element.ownerDocument.activeElement !== element) element.focus();
  };

  return (
    <>
      <Action
        ref={opener}
        emphasis={triggerEmphasis}
        aria-haspopup="dialog"
        aria-controls={id}
        command={{ for: id, action: 'show-modal' }}
        onClick={plate ? undefined : open}
      >
        {trigger}
      </Action>
      <dialog
        ref={dialog}
        id={id}
        data-ui-slot="dialog"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClose={plate ? undefined : returnFocus}
      >
        <Heading data-ui-slot="dialog.title" id={titleId}>
          {title}
        </Heading>
        {description ? (
          <p data-ui-slot="dialog.description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children ? <div data-ui-slot="dialog.content">{children}</div> : null}
        <div data-ui-slot="dialog.actions">
          <Action
            emphasis="quiet"
            command={{ for: id, action: 'close' }}
            onClick={plate ? undefined : close}
          >
            {closeLabel}
          </Action>
        </div>
      </dialog>
    </>
  );
}
