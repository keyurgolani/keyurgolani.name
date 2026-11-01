// What the Dialog's closeOnNavigate reads of a click on a link (dialog.tsx),
// in a module of its own: a composition's own layer that isn't a Dialog,
// such as a native popover sheet of contents, imports it from the
// primitives entry without depending on the Dialog, so its island's chunk
// carries these few lines and not the Dialog's component. Pure functions,
// no DOM and no React.

/** What closeOnNavigate reads of a click: the event's button and modifiers. */
export interface FollowClick {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
}

/** What closeOnNavigate reads of the link a click is on. */
export interface FollowLink {
  /** Its resolved URL, `HTMLAnchorElement.href`. */
  readonly href: string;
  /** Its `target`, empty when it has none. */
  readonly target: string;
  readonly download: boolean;
  /** Whether it's inside the open dialog, or the open popover or sheet that calls closesOnFollow(). */
  readonly inDialog: boolean;
}

/**
 * Where a click inside an open dialog with closeOnNavigate goes, when it
 * should close the dialog first: the id of the place on this page a plain
 * primary click on a same-tab link goes. Null for anything else: a click
 * with a modifier key or another button, one a handler already prevented,
 * no link, a link outside the dialog, a new tab or a download, or a link to
 * another document.
 *
 * Exported from the primitives entry for a composition's own layer that
 * isn't a Dialog, such as a native popover sheet of contents: on a click
 * inside it, close it when this gives an id, let the browser follow the
 * link, and move focus to that id, as the Dialog does.
 */
export function closesOnFollow(
  click: FollowClick,
  link: FollowLink | null,
  current: string,
): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (!link || !link.inDialog || link.download) return null;
  if (link.target !== '' && link.target !== '_self') return null;
  return sameDocumentFragment(link.href, current);
}

/**
 * The id a link goes to when it's a fragment of the document at `current`,
 * the same origin, path, and query with a fragment, and null for any other
 * link, an empty fragment included.
 */
export function sameDocumentFragment(href: string, current: string): string | null {
  let to: URL;
  let at: URL;
  try {
    to = new URL(href, current);
    at = new URL(current);
  } catch {
    return null;
  }
  if (to.origin !== at.origin || to.pathname !== at.pathname || to.search !== at.search) {
    return null;
  }
  const fragment = to.hash.slice(1);
  if (fragment === '') return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
