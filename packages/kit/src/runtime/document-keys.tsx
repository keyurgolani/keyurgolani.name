'use client';

// The document key binding in React (K-4 (d)): DocumentKeyBinding, which the
// host renders with the manifest's binding; useDocumentAction(), with which
// a variant's palette hears it; and SingleKeyShortcutsControl, the toggle the
// host's visitor controls show wherever the binding holds `/` (WCAG 2.1.4),
// a toggle on #19's Action with aria-pressed and a polite status line, as
// MotionControl is. None of them renders anything on the server: the toggle
// renders invisible until the page has hydrated, since without scripts nothing
// it controls runs, its box kept so hydration shifts nothing in the slot
// (visibility: hidden keeps it out of the tab order and the accessibility
// tree too), and its status line stays empty until the visitor presses it,
// so a page load announces nothing; aria-pressed carries the state.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { DocumentAction, DocumentBinding } from '@portfolio/variant-contract';
import { Action } from '@portfolio/appearance/primitives';
import {
  bindDocumentKeys,
  onDocumentAction,
  setSingleKeyShortcuts,
  singleKeyShortcutsEnabled,
  subscribeSingleKeyShortcuts,
} from './shortcuts';

/** The host's listener for the page's document binding. Renders nothing. */
export function DocumentKeyBinding({ binding }: { readonly binding: DocumentBinding }): null {
  const keys = binding.keys.join(' ');
  const { action } = binding;
  useEffect(() => bindDocumentKeys({ keys: keys.split(' '), action }), [keys, action]);
  return null;
}

/**
 * Runs `handler` each time the manifest's document binding fires `action`, such as
 * `palette.open`, while the component is mounted. The newest one mounted hears it.
 */
export function useDocumentAction(action: DocumentAction, handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => onDocumentAction(action, () => latest.current()), [action]);
}

export interface SingleKeyShortcutsStatus {
  /** While single-key shortcuts are on. */
  readonly on: string;
  /** Once the visitor turned them off. */
  readonly off: string;
}

export interface SingleKeyShortcutsControlProps {
  /** The toggle's label, the same whether pressed or not. */
  readonly label?: string;
  /** What the status line says in each state. */
  readonly status?: Partial<SingleKeyShortcutsStatus>;
  readonly className?: string;
  /** The words' language, when the portfolio's isn't English. */
  readonly lang?: string;
}

export const SINGLE_KEY_SHORTCUTS_STATUS: SingleKeyShortcutsStatus = Object.freeze({
  on: 'Single-key shortcuts are on: / opens the palette.',
  off: 'Single-key shortcuts are off.',
});

/** The visitor's switch for single-key shortcuts: pressed while they're on. */
export function SingleKeyShortcutsControl({
  label = 'Single-key shortcuts',
  status,
  className,
  lang,
}: SingleKeyShortcutsControlProps): ReactElement {
  const words = { ...SINGLE_KEY_SHORTCUTS_STATUS, ...status };
  const enabled = useSyncExternalStore(
    subscribeSingleKeyShortcuts,
    singleKeyShortcutsEnabled,
    () => true,
  );
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  // Empty until the visitor presses the toggle: a load announces nothing.
  const [pressed, setPressed] = useState(false);
  return (
    <span
      className={className}
      data-shortcuts-control=""
      lang={lang}
      style={hydrated ? undefined : { visibility: 'hidden' }}
    >
      <Action
        pressed={enabled}
        onClick={() => {
          setPressed(true);
          setSingleKeyShortcuts(!enabled);
        }}
      >
        {label}
      </Action>{' '}
      <span role="status" aria-live="polite">
        {pressed ? (enabled ? words.on : words.off) : ''}
      </span>
    </span>
  );
}

const noSubscription = () => () => {};
