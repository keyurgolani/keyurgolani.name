import type { MouseEvent, ReactNode, Ref } from 'react';
import type { ActionEmphasis } from '../slots';

declare module 'react' {
  // HTML's invoker commands, which React passes through but its types don't list yet.
  interface ButtonHTMLAttributes<T> {
    commandfor?: string | undefined;
    command?: string | undefined;
  }
}

// Action (#19, Slice 3, item 2): a native button, or a link when it
// navigates. Its kind is data-emphasis, and its state shows through ARIA
// and native attributes: aria-pressed for a toggle, the native disabled
// attribute for a button that isn't available, and aria-busy with
// aria-disabled while it works, so focus stays on it and it isn't
// activated. It renders on the server and in client components alike.

export interface ActionProps {
  /** The visible label. */
  readonly children: ReactNode;
  /** `primary` for the one main action, `secondary` (the default), or `quiet`. */
  readonly emphasis?: ActionEmphasis;
  /** Where it navigates. It renders a link then. */
  readonly href?: string;
  /** A button's type: `button` unless it submits its form. */
  readonly type?: 'button' | 'submit' | 'reset';
  readonly name?: string;
  readonly value?: string;
  /** A toggle's state, as aria-pressed. */
  readonly pressed?: boolean;
  /** Working: aria-busy, aria-disabled, and the spinner. A click does nothing, and focus stays. */
  readonly loading?: boolean;
  /** Not available: a button gets the disabled attribute, and a link loses its href. */
  readonly disabled?: boolean;
  /** A decorative icon before the label, hidden from assistive technology. */
  readonly icon?: ReactNode;
  /** The accessible name, when the visible label alone doesn't give one, as for an icon. */
  readonly label?: string;
  /** Ids of what describes it, such as a tooltip's or an error's. */
  readonly describedBy?: string;
  readonly id?: string;
  /** A hook for the variant's layout. Never for state or appearance. */
  readonly className?: string;
  readonly hidden?: boolean;
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly ref?: Ref<HTMLButtonElement & HTMLAnchorElement>;
  /**
   * An invoker command, which a supporting browser runs with no JavaScript:
   * the element it acts on, and `show-modal` or `close` for a dialog.
   */
  readonly command?: { readonly for: string; readonly action: 'show-modal' | 'close' };
  /** Only a primitive that opens a dialog sets these. */
  readonly 'aria-haspopup'?: 'dialog';
  readonly 'aria-controls'?: string;
}

export function Action({
  children,
  emphasis = 'secondary',
  href,
  type = 'button',
  name,
  value,
  pressed,
  loading = false,
  disabled = false,
  icon,
  label,
  describedBy,
  id,
  className,
  hidden,
  onClick,
  ref,
  command,
  ...aria
}: ActionProps) {
  const unavailable = loading || disabled;
  // A server component can't pass a handler, so a handler goes on only when
  // the caller, a client component, gives one.
  const click = onClick
    ? (event: MouseEvent<HTMLElement>) => {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        onClick(event);
      }
    : undefined;
  const content = (
    <>
      {loading ? <span data-ui-slot="action.spinner" aria-hidden="true" /> : null}
      {icon ? (
        <span data-ui-slot="action.icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span data-ui-slot="action.label">{children}</span>
    </>
  );
  const shared = {
    id,
    className,
    hidden,
    ref,
    'data-ui-slot': 'action',
    'data-emphasis': emphasis,
    'data-state': loading ? 'loading' : undefined,
    'aria-label': label,
    'aria-describedby': describedBy,
    'aria-busy': loading || undefined,
    onClick: click,
    ...aria,
  };
  if (href !== undefined) {
    // A link that isn't available keeps its name and place but goes nowhere.
    return unavailable ? (
      <a {...shared} role="link" aria-disabled="true">
        {content}
      </a>
    ) : (
      <a {...shared} href={href}>
        {content}
      </a>
    );
  }
  return (
    <button
      {...shared}
      type={type}
      name={name}
      value={value}
      disabled={disabled || undefined}
      aria-disabled={loading || undefined}
      aria-pressed={pressed}
      // React passes these through lowercase, as the HTML attributes are spelled.
      commandfor={command?.for}
      command={command?.action}
    >
      {content}
    </button>
  );
}
