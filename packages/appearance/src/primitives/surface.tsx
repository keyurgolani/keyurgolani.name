import type { ReactNode } from 'react';
import type { Status, SurfaceEmphasis } from '../slots';

// Surface, Badge, and Disclosure (#19, Slice 3, item 2): static primitives
// that render the same on the server, in a client component, and in a
// plate. Surface's level is data-emphasis; Badge's status is data-status
// and always a word too, never color alone; Disclosure is a native details
// element, whose open state is its own attribute.

export interface SurfaceProps {
  readonly children: ReactNode;
  /** `subtle`, `default` (the default), `prominent`, or `overlay`. */
  readonly emphasis?: SurfaceEmphasis;
  /** `article` for one self-contained item, such as a project; else a div. A labelled section is the Region landmark. */
  readonly as?: 'div' | 'article';
  /** Ids of the heading that names it. */
  readonly labelledBy?: string;
  readonly id?: string;
  /** A hook for the variant's layout. Never for state or appearance. */
  readonly className?: string;
}

export function Surface({
  children,
  emphasis = 'default',
  as: Tag = 'div',
  labelledBy,
  id,
  className,
}: SurfaceProps) {
  return (
    <Tag
      id={id}
      className={className}
      data-ui-slot="surface"
      data-emphasis={emphasis}
      aria-labelledby={labelledBy}
    >
      {children}
    </Tag>
  );
}

export interface BadgeProps {
  /** The status in words, such as Verified. */
  readonly children: ReactNode;
  /** `neutral` (the default), `positive`, `warning`, `danger`, or `information`. */
  readonly status?: Status;
  /** A decorative icon, hidden from assistive technology. */
  readonly icon?: ReactNode;
  readonly id?: string;
  readonly className?: string;
}

export function Badge({ children, status = 'neutral', icon, id, className }: BadgeProps) {
  return (
    <span id={id} className={className} data-ui-slot="badge" data-status={status}>
      {icon ? (
        <span data-ui-slot="badge.icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span data-ui-slot="badge.label">{children}</span>
    </span>
  );
}

export interface DisclosureProps {
  /** What the summary says, which opens and closes it. */
  readonly summary: ReactNode;
  readonly children: ReactNode;
  /** Whether it starts open. */
  readonly open?: boolean;
  /** Disclosures that share a name open one at a time. */
  readonly name?: string;
  readonly id?: string;
  readonly className?: string;
  readonly lang?: string;
}

export function Disclosure({
  summary,
  children,
  open,
  name,
  id,
  className,
  lang,
}: DisclosureProps) {
  return (
    <details
      id={id}
      className={className}
      lang={lang}
      data-ui-slot="disclosure"
      open={open || undefined}
      name={name}
    >
      <summary data-ui-slot="disclosure.summary">{summary}</summary>
      <div data-ui-slot="disclosure.content">{children}</div>
    </details>
  );
}
