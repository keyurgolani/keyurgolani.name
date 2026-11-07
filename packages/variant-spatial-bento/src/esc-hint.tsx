'use client';

import { useSyncExternalStore, type ReactElement } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The case sheet's Escape hint (RC1 row 92). Its words say what CaseFocus's
// keydown listener does, so they're true only once that listener is
// attached: the server sends none, and the hint renders nothing until
// CaseFocus says it listens (hearsEscape), and never on a plate. The server
// and the hydrating first render both read "not listening", so they match.
// The stylesheet shows it only under a fine pointer, where there's a
// keyboard to press it on. It names, by id, the control that does the same
// without a script, Back to the field, and holds no link or control itself.

let listening = false;
const subscribers = new Set<() => void>();

/** CaseFocus says whether its Escape listener is attached. */
export function hearsEscape(on: boolean): void {
  if (listening === on) return;
  listening = on;
  for (const notify of subscribers) notify();
}

/** Whether CaseFocus's Escape listener is attached, as the hint reads it. */
export const escapeHeard = (): boolean => listening;

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/** The server, and the browser while it hydrates, never hear the key. */
const heardOnServer = () => false;

/** What the hint renders from. */
export interface EscHintState {
  /** CaseFocus's listener is attached. */
  readonly heard: boolean;
  /** Inside a plate, which attaches no listener. */
  readonly plate: boolean;
  /** The way back's id: Back to the field, which closes the sheet without a script. */
  readonly back: string;
  readonly dir?: 'ltr';
}

/** The hint as it stands: nothing unless the key is heard, and nothing on a plate. */
export function escHint({ heard, plate, back, dir }: EscHintState): ReactElement | null {
  if (!heard || plate) return null;
  return (
    <p
      className="sb-case__esc"
      data-script-only=""
      data-key-hint-for={back}
      data-listening=""
      dir={dir}
    >
      Press <kbd>Esc</kbd> to close. The field keeps your place.
    </p>
  );
}

export function EscHint({ back, dir }: { readonly back: string; readonly dir?: 'ltr' }) {
  const { plate } = useBoundary();
  const heard = useSyncExternalStore(subscribe, escapeHeard, heardOnServer);
  return escHint({ heard, plate, back, dir });
}
