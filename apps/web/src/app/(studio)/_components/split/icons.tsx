import type { ReactNode } from 'react';

// The workspace's icons (the Studio mockup's set, owner direction,
// 2026-10-25): 24px strokes at 1.75, drawn in the current colour, never
// named, since each sits beside or inside a control that has its own name.

const PATHS = {
  undo: (
    <>
      <path d="M8 4 4 8l4 4" />
      <path d="M4 8h10a6 6 0 0 1 0 12H9" />
    </>
  ),
  redo: (
    <>
      <path d="m16 4 4 4-4 4" />
      <path d="M20 8H10a6 6 0 0 0 0 12h5" />
    </>
  ),
  chevL: <path d="m14.5 6-6 6 6 6" />,
  chevR: <path d="m9.5 6 6 6-6 6" />,
  chevD: <path d="m6 9.5 6 6 6-6" />,
  pin: (
    <>
      <path d="M9 3.5h6l-.9 5.6 3.4 3.2V14h-11v-1.7l3.4-3.2z" />
      <path d="M12 14v6.5" />
    </>
  ),
  pinFill: (
    <>
      <path d="M9 3.5h6l-.9 5.6 3.4 3.2V14h-11v-1.7l3.4-3.2z" fill="currentColor" />
      <path d="M12 14v6.5" />
    </>
  ),
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.4" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3.2c1.9 0 3 .9 4 2.4l3.6 5.2c1 1.5 2.1 2.4 4 2.4H21" />
      <path d="m18 14 3 3-3 3" />
      <path d="M3 17h3.2c1.3 0 2.2-.4 2.9-1.1" />
      <path d="M14.9 8.1c.7-.7 1.6-1.1 2.9-1.1H21" />
      <path d="m18 4 3 3-3 3" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  tablet: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </>
  ),
  phone: (
    <>
      <rect x="7.5" y="3" width="9" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </>
  ),
  check: <path d="m5.5 12.5 4 4L18.5 7.5" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 20h14" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.2v.3" />
    </>
  ),
  mark: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  rail: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M9 4.5v15" />
    </>
  ),
  /** A sprout: a scheme generated from a seed. */
  seed: (
    <>
      <path d="M12 20v-8" />
      <path d="M12 12c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5z" />
      <path d="M12 14.5C12 11 10 9 5.5 9c0 3.5 2 5.5 6.5 5.5z" />
    </>
  ),
  /** Three stacked layers: a recipe, which sets every axis at once. */
  recipe: (
    <>
      <path d="m12 4 8 4-8 4-8-4 8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </>
  ),
  /** Two panes: Compare. */
  compare: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M12 4.5v15" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className,
}: {
  readonly name: IconName;
  readonly className?: string;
}) {
  return (
    <svg
      className={['studio-icon', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** A quiet icon button, named for what it does; its name shows as a tooltip too. */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  className,
  type = 'button',
  form,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** For a toggle such as Keep: whether it's on. */
  readonly pressed?: boolean;
  readonly className?: string;
  readonly type?: 'button' | 'submit';
  readonly form?: string;
}) {
  return (
    <button
      type={type}
      className={['studio-iconbutton', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      {...(form ? { form } : {})}
    >
      <Icon name={pressed && icon === 'pin' ? 'pinFill' : icon} />
    </button>
  );
}
