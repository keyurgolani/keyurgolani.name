'use client';

// Tooltip (#19, Slice 3, item 2): a description an action shows on hover
// and on focus, through the Popover API. The action names it in
// aria-describedby, so assistive technology reads it with or without
// JavaScript. It stays while the pointer is over it, so it can be read and
// hovered (WCAG 1.4.13), and Escape closes it: a hint popover closes itself
// on Escape and an outside click, and the action closes it on Escape too,
// for a browser that treats hint as manual. Shown with the action as its
// source, it sits by the action through anchor positioning. It takes a
// local id and adds the boundary's prefix. In a plate it attaches no
// listener and never opens.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ActionEmphasis } from '../slots';
import { useBoundary, useBoundaryId } from '../react/boundary-root';
import { Action } from './action';

export interface TooltipProps {
  /** A local id, which the boundary's prefix starts. The tooltip's id. */
  readonly id: string;
  /** What it says: plain text, with nothing to activate. */
  readonly content: ReactNode;
  /** The action's label. */
  readonly children: ReactNode;
  readonly emphasis?: ActionEmphasis;
  readonly icon?: ReactNode;
  /** The action's accessible name, when its label is only an icon. */
  readonly label?: string;
}

/** How long a pointer rests on the action before the tooltip shows, in milliseconds. */
export const TOOLTIP_SHOW_DELAY = 300;
/** How long it stays after the pointer leaves, so the pointer can move onto it, in milliseconds. */
export const TOOLTIP_HIDE_DELAY = 200;

export function Tooltip({ id: local, content, children, emphasis, icon, label }: TooltipProps) {
  const id = useBoundaryId(local);
  const { plate } = useBoundary();
  const tip = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const isOpen = () => tip.current?.matches(':popover-open') ?? false;
  const show = () => {
    clearTimeout(timer.current);
    const element = tip.current;
    if (!element || isOpen()) return;
    // The source makes the action the popover's anchor, where the browser has it.
    (element.showPopover as (options?: { source?: HTMLElement | null }) => void).call(element, {
      source: action.current,
    });
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (isOpen()) tip.current?.hidePopover();
  };
  const later = (run: () => void, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen()) {
      event.stopPropagation();
      hide();
    }
  };

  const listeners = plate
    ? {}
    : {
        onPointerEnter: () => later(show, TOOLTIP_SHOW_DELAY),
        onPointerLeave: () => later(hide, TOOLTIP_HIDE_DELAY),
        onFocus: show,
        onBlur: hide,
        onKeyDown,
      };
  const tipListeners = plate
    ? {}
    : {
        onPointerEnter: () => clearTimeout(timer.current),
        onPointerLeave: () => later(hide, TOOLTIP_HIDE_DELAY),
      };

  return (
    <span data-ui-slot="tooltip.anchor" {...listeners}>
      <Action ref={action} emphasis={emphasis} icon={icon} label={label} describedBy={id}>
        {children}
      </Action>
      <div id={id} role="tooltip" popover="hint" data-ui-slot="tooltip" {...tipListeners}>
        {content}
      </div>
    </span>
  );
}
