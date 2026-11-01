'use client';

// Dialog (#19, Slice 3, item 2): a native modal dialog and the action that
// opens it. The trigger and the close button carry invoker commands, so a
// browser that has them opens and closes the dialog with no JavaScript;
// where they're missing, the click calls showModal() and close(). Escape
// closes it natively, the page stays inert behind it, the page's scrolling
// stops in CSS (never document.body.style), and focus goes back to the
// trigger when it closes. It takes a local id and adds the boundary's
// prefix. In a plate it attaches no listener. With closeOnNavigate, a menu
// of links to places on the page closes when one is followed, and the link
// goes where it goes, natively: the hash, history, and scrolling are the
// browser's, so a reduced-motion preference the page's scroll behavior
// follows still holds. Focus then moves to the place it went, not back to
// the trigger. With lightDismiss, a tap on the backdrop closes it, through
// closedby="any" where the browser has it and a click check where it
// doesn't. With closeInHeader, the title and the close button share a
// header the stylesheet keeps in view while long content scrolls.

import { useRef, type MouseEvent, type ReactNode } from 'react';
import type { ActionEmphasis } from '../slots';
import { partId } from '../ids';
import { useBoundary, useBoundaryId } from '../react/boundary-root';
import { Action } from './action';
import { closesOnFollow } from './dialog-follow';

// What closeOnNavigate reads of a click lives in dialog-follow.ts, so a layer that isn't a
// Dialog can use it without this module; it's exported from here too, as it always was.
export {
  closesOnFollow,
  sameDocumentFragment,
  type FollowClick,
  type FollowLink,
} from './dialog-follow';

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
  /**
   * Close when a link inside it to a place on this same page is followed,
   * then let the browser follow it, and move focus to that place. For a
   * menu of section links. False by default.
   */
  readonly closeOnNavigate?: boolean;
  /** Close on a tap or click on the backdrop, as well as on Escape and the close button. False by default. */
  readonly lightDismiss?: boolean;
  /**
   * Put the close button beside the title, in a header that stays in view
   * while the content scrolls, in place of the actions row at the end. For
   * long content, such as a menu. False by default.
   */
  readonly closeInHeader?: boolean;
}

/**
 * Whether a click on the dialog element itself fell outside its box: on the
 * backdrop, which a modal dialog's own click target covers. Clicks on its
 * padding are inside.
 */
export function onBackdrop(
  point: { readonly x: number; readonly y: number },
  box: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
): boolean {
  return point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom;
}

/** What takes focus on its own, so moving focus to it needs no tabindex. */
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';

/** Focus where a followed link went, without scrolling: the browser has already scrolled there. */
function focusTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  if (!target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
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
  closeOnNavigate = false,
  lightDismiss = false,
  closeInHeader = false,
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
  // The place a followed link goes, between the dialog closing and its close event.
  const followed = useRef<string | null>(null);
  // However it closed, focus goes back to what opened it, unless a link it
  // closed for took the visitor elsewhere on the page: then focus goes there.
  const onClose = () => {
    const place = followed.current;
    followed.current = null;
    if (place !== null) {
      focusTarget(place);
      return;
    }
    const element = opener.current;
    if (element && element.ownerDocument.activeElement !== element) element.focus();
  };
  // A plain click on a link to a place on this page closes the dialog first,
  // and the browser then follows it, as any link: nothing is prevented. The
  // close event comes after the browser has gone there, and late: close()
  // hides the dialog and hands focus back to the trigger at once, but the
  // event waits for a later task, which under load came after a read of the
  // page that found the dialog gone and focus on the trigger or on nothing.
  // So focus moves to the place in the same task as close(), with no gap:
  // without scrolling, so the scroll stays the browser's, and made focusable
  // before the browser follows the link, so its own fragment focus keeps
  // focus there instead of clearing it. The close event, after the scroll
  // has landed, puts it there again if it couldn't take it yet (a place in
  // a fold the browser only opens as it follows the link).
  const follow = (event: MouseEvent<HTMLDialogElement>, element: HTMLDialogElement) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const link =
      anchor instanceof HTMLAnchorElement
        ? {
            href: anchor.href,
            target: anchor.target,
            download: anchor.hasAttribute('download'),
            inDialog: element.contains(anchor),
          }
        : null;
    const place = closesOnFollow(event, link, element.ownerDocument.location.href);
    if (place === null) return;
    followed.current = place;
    element.close();
    focusTarget(place);
  };
  // A backdrop tap, where the browser has no closedby="any" to close it itself.
  const dismiss = (event: MouseEvent<HTMLDialogElement>, element: HTMLDialogElement) => {
    if ('closedBy' in element || event.target !== element) return;
    if (onBackdrop({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect())) {
      element.close();
    }
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const element = dialog.current;
    if (!element?.open) return;
    if (closeOnNavigate) follow(event, element);
    if (lightDismiss && element.open) dismiss(event, element);
  };
  const closeAction = (
    <Action
      emphasis="quiet"
      command={{ for: id, action: 'close' }}
      onClick={plate ? undefined : close}
    >
      {closeLabel}
    </Action>
  );
  const heading = (
    <Heading data-ui-slot="dialog.title" id={titleId}>
      {title}
    </Heading>
  );

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
        {...(lightDismiss ? { closedby: 'any' } : {})}
        onClose={plate ? undefined : onClose}
        onClick={plate || !(closeOnNavigate || lightDismiss) ? undefined : onClick}
      >
        {closeInHeader ? (
          <div data-ui-slot="dialog.header">
            {heading}
            {closeAction}
          </div>
        ) : (
          heading
        )}
        {description ? (
          <p data-ui-slot="dialog.description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children ? <div data-ui-slot="dialog.content">{children}</div> : null}
        {closeInHeader ? null : <div data-ui-slot="dialog.actions">{closeAction}</div>}
      </dialog>
    </>
  );
}
