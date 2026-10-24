import type { MouseEvent, ReactNode, Ref } from 'react';
import type { ActionEmphasis } from '../slots';

declare module 'react' {
  // HTML's invoker commands, which React passes through but its types don't list yet.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merged declaration repeats React's type parameter.
  interface ButtonHTMLAttributes<T> {
    commandfor?: string | undefined;
    command?: string | undefined;
  }
}

// Action's markup (#19, Slice 3, item 2): a native button, or a link when
// it navigates. Its kind is data-emphasis, and its state shows through ARIA
// and native attributes: aria-pressed for a toggle, the native disabled
// attribute for a button that isn't available (aria-disabled instead, with
// keepsFocus, for one that mustn't lose focus), and aria-busy with
// aria-disabled while it works, so focus stays on it and it isn't
// activated. action.tsx renders it, and action-client.tsx does when it needs
// a click handler.

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
  /**
   * Working: aria-busy, aria-disabled, and the spinner. A click does
   * nothing, a submit button doesn't submit, and focus stays, a link's too.
   */
  readonly loading?: boolean;
  /** Not available: a button gets the disabled attribute, and a link loses its href. */
  readonly disabled?: boolean;
  /**
   * With disabled: a button that keeps its focus and place in the tab
   * order, as aria-disabled instead of the native attribute, and does
   * nothing on a click. For a control that can become unavailable while
   * it has focus, which the native attribute would drop to the body.
   */
  readonly keepsFocus?: boolean;
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
  /**
   * From a client component. In a plate it never goes on. Whether it's given
   * decides which half renders: a plain button given one becomes the client
   * half, so a handler that comes and goes swaps the element and loses its
   * focus. To do something on a click only some of the time, pass one
   * handler for the action's whole life and decide inside it.
   */
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

/**
 * The action's element, with `click` as its one handler. Only
 * action-client.tsx passes one, so an action a server component renders
 * carries none.
 */
export function actionElement(
  {
    children,
    emphasis = 'secondary',
    href,
    type = 'button',
    name,
    value,
    pressed,
    loading = false,
    disabled = false,
    keepsFocus = false,
    icon,
    label,
    describedBy,
    id,
    className,
    hidden,
    ref,
    command,
    'aria-haspopup': hasPopup,
    'aria-controls': controls,
  }: ActionProps,
  click?: (event: MouseEvent<HTMLElement>) => void,
) {
  const unavailable = loading || disabled;
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
    'aria-haspopup': hasPopup,
    'aria-controls': controls,
    // What runs on a click is `click`, never the caller's onClick as it came.
    onClick: click,
  };
  if (href !== undefined) {
    // A link that isn't available keeps its name and place but goes nowhere,
    // and one that's loading keeps its focus as well.
    return unavailable ? (
      <a {...shared} role="link" aria-disabled="true" tabIndex={loading ? 0 : undefined}>
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
      disabled={(disabled && !keepsFocus) || undefined}
      aria-disabled={loading || (disabled && keepsFocus) || undefined}
      aria-pressed={pressed}
      // React passes these through lowercase, as the HTML attributes are spelled.
      commandfor={command?.for}
      command={command?.action}
    >
      {content}
    </button>
  );
}
