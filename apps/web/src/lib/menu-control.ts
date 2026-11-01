import { useSyncExternalStore } from 'react';

// Where the visitor's appearance control renders (stream A, global rule 7):
// in its VisitorControlSlot, or, on a narrow screen, inside the host's Menu
// (lib/navigation-menu.tsx) when the composition asks for it, so the chrome
// is the name and the Menu. A Menu claims the control while its media query
// matches, and the slot's control steps aside while any Menu holds it, so
// the control, whose ids are fixed, is never on the page twice. On the
// server, and while the page hydrates, nothing holds it: the control is in
// its slot, as it stays where scripts don't run.

let claims = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a Menu holds the control now. */
export const controlInMenu = (): boolean => claims > 0;

/** Moves the control into a Menu; the function it returns gives it back. */
export function claimControl(): () => void {
  claims += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    emit();
  };
}

/** Whether a Menu holds the control, false on the server and while hydrating. */
export function useControlInMenu(): boolean {
  return useSyncExternalStore(subscribe, controlInMenu, () => false);
}

/** Whether `query` matches, false on the server, while hydrating, and for no query. */
export function useMedia(query: string | undefined): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (!query || typeof matchMedia === 'undefined') return () => {};
      const list = matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => (query && typeof matchMedia !== 'undefined' ? matchMedia(query).matches : false),
    () => false,
  );
}
