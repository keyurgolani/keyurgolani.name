import type { ReactNode } from 'react';
import type { Status } from '../slots';

// Toast (#19, Slice 3, item 2), on its own: a static role="status" message,
// which a server component renders, such as "Draft saved locally." The
// toasts a client component shows go in a ToastRegion.

export interface ToastProps {
  readonly children: ReactNode;
  /** `information` unless it's about success, a warning, or a failure. */
  readonly status?: Status;
  /** Actions, such as Undo. */
  readonly actions?: ReactNode;
  readonly id?: string;
}

export function Toast({ children, status = 'information', actions, id }: ToastProps) {
  return (
    <div id={id} role="status" data-ui-slot="toast" data-status={status}>
      <p data-ui-slot="toast.message">{children}</p>
      {actions ? <div data-ui-slot="toast.actions">{actions}</div> : null}
    </div>
  );
}
