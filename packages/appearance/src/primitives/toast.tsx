'use client';

// ToastRegion and useToast() (#19, Slice 3, item 2): the toasts a client
// component shows, in one polite status region that's in the page from its
// first paint, so a new message is announced without moving focus. A toast
// with an action never dismisses itself; one without may, after
// `dismissAfter`, and its timer waits while the pointer or focus is in the
// region. Every toast in a region has a dismiss action. In a plate the
// region attaches no listener and shows nothing new. A static message is
// toast-message.tsx's Toast.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import type { Status } from '../slots';
import { partId } from '../ids';
import { useBoundary, useBoundaryId } from '../react/boundary-root';
import { Action } from './action';

/** A toast to show. */
export interface ToastRequest {
  readonly message: ReactNode;
  readonly status?: Status;
  /** One action, such as Undo. A toast with one never dismisses itself. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
  /** Dismiss it after this many milliseconds. Ignored when it has an action. */
  readonly dismissAfter?: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id; in a plate, shows nothing and returns ''. */
  show(toast: ToastRequest): string;
  dismiss(id: string): void;
}

interface ShownToast extends ToastRequest {
  readonly id: string;
}

const ToastContext = createContext<ToastApi | null>(null);

/** The nearest ToastRegion's show() and dismiss(). It throws outside one. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() needs a ToastRegion around it.');
  return api;
}

export interface ToastRegionProps {
  /** A local id, which the boundary's prefix starts. */
  readonly id: string;
  /** What's inside it can show toasts with useToast(). */
  readonly children?: ReactNode;
  /** The dismiss action's label. */
  readonly dismissLabel?: string;
}

export function ToastRegion({ id: local, children, dismissLabel = 'Dismiss' }: ToastRegionProps) {
  const id = useBoundaryId(local);
  const { plate } = useBoundary();
  const [toasts, setToasts] = useState<readonly ShownToast[]>([]);
  const count = useRef(0);
  const [paused, setPaused] = useState(false);

  const dismiss = useCallback((toastId: string) => {
    setToasts((shown) => shown.filter((toast) => toast.id !== toastId));
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      show(toast) {
        if (plate) return '';
        count.current += 1;
        const toastId = partId(id, `toast-${count.current}`);
        setToasts((shown) => [...shown, { ...toast, id: toastId }]);
        return toastId;
      },
      dismiss,
    }),
    [id, plate, dismiss],
  );

  const listeners = plate
    ? {}
    : {
        onPointerEnter: () => setPaused(true),
        onPointerLeave: () => setPaused(false),
        onFocus: () => setPaused(true),
        onBlur: (event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        },
      };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div id={id} role="status" data-ui-slot="toast.region" {...listeners}>
        {toasts.map((toast) => (
          <ShownToastView
            key={toast.id}
            toast={toast}
            paused={paused}
            dismissLabel={dismissLabel}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ShownToastView({
  toast,
  paused,
  dismissLabel,
  onDismiss,
}: {
  readonly toast: ShownToast;
  readonly paused: boolean;
  readonly dismissLabel: string;
  readonly onDismiss: (id: string) => void;
}) {
  const { id, action, dismissAfter } = toast;
  // Only a toast with nothing to act on may go by itself, and not while paused.
  useEffect(() => {
    if (action || dismissAfter === undefined || paused) return undefined;
    const timer = setTimeout(() => onDismiss(id), dismissAfter);
    return () => clearTimeout(timer);
  }, [id, action, dismissAfter, paused, onDismiss]);
  return (
    <div id={id} data-ui-slot="toast" data-status={toast.status ?? 'information'}>
      <p data-ui-slot="toast.message">{toast.message}</p>
      <div data-ui-slot="toast.actions">
        {action ? (
          <Action
            onClick={() => {
              action.onAction();
              onDismiss(id);
            }}
          >
            {action.label}
          </Action>
        ) : null}
        <Action emphasis="quiet" onClick={() => onDismiss(id)}>
          {dismissLabel}
        </Action>
      </div>
    </div>
  );
}
