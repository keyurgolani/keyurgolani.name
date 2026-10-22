'use client';

// Action's client half (#19, Slice 3, item 2): the one place an action
// takes a click handler. It reads its boundary, so in a plate it attaches
// none at all, whatever the caller passed. Elsewhere a click on an action
// that isn't available does nothing: the caller's onClick doesn't run, and
// a loading submit button doesn't submit its form, by a click or by Enter
// in one of the form's fields.

import type { MouseEvent } from 'react';
import { useBoundary } from '../react/boundary-root';
import { actionElement, type ActionProps } from './action-markup';

export function ClientAction(props: ActionProps) {
  const { plate } = useBoundary();
  const { onClick, loading = false, disabled = false } = props;
  const click = plate
    ? undefined
    : (event: MouseEvent<HTMLElement>) => {
        if (loading || disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      };
  return actionElement(props, click);
}
