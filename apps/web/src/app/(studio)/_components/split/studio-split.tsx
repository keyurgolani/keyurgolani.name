'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { viewportLabel, VIEWPORTS, type Viewport } from '~/lib/preview-frame';

// The Appearance view's split (owner direction, 2026-10-25, item 2; #8 and
// #9): the controls in a panel that scrolls on its own, and the live preview
// beside them, filling the rest. Owner Studio and Demo Studio both lay their
// Appearance task out with it, so a restyle lands once. From 64rem (1024px)
// up both panes show; below it a Controls and Preview switch shows one at a
// time, so the preview is one press away, and the press moves focus to the
// pane it shows. Tab order is the DOM's: the switch (when it shows), the
// controls, the preview's toolbar, then its frame. It holds which pane shows
// and nothing else: the frames, and what they load, are each Studio's own.
// Plain markup with class hooks, so the visual pass restyles it in
// studio.css alone.

/** Which pane shows below 64rem. Both show from 64rem up. */
export type SplitView = 'controls' | 'preview';

/** Where the split stacks into one pane at a time, as studio.css has it. */
export const SPLIT_NARROW = '(max-width: 63.99rem)';

/** The switch's buttons, in order. */
export const SPLIT_VIEWS: readonly { readonly id: SplitView; readonly label: string }[] =
  Object.freeze([
    { id: 'controls', label: 'Controls' },
    { id: 'preview', label: 'Preview' },
  ]);

/** The view the split starts in: the controls, which is where a change starts. */
export const INITIAL_VIEW: SplitView = 'controls';

/**
 * What a press of `pressed` does, from `current`: shows it, and moves focus
 * to it when it wasn't already showing. A press of the pane already shown
 * leaves focus on the switch.
 */
export function pressView(
  current: SplitView,
  pressed: SplitView,
): { readonly view: SplitView; readonly moveFocus: boolean } {
  return { view: pressed, moveFocus: pressed !== current };
}

/** The panes that show for `view`: both when the split is wide, else the one `view` names. */
export function shownPanes(view: SplitView, narrow: boolean): readonly SplitView[] {
  return narrow ? [view] : ['controls', 'preview'];
}

export interface StudioSplitProps {
  /** The controls pane's accessible name. */
  readonly controlsLabel?: string;
  /** The preview pane's heading, which names it. */
  readonly previewHeading: string;
  /** The controls: each Studio's own form. */
  readonly controls: ReactNode;
  /** The preview pane's body: its toolbar, then its frame. */
  readonly children: ReactNode;
  /** Hears each view the switch shows, as Demo Studio's frame takes a press of Preview as asking for it. */
  readonly onView?: (view: SplitView) => void;
}

export function StudioSplit({
  controlsLabel = 'Controls',
  previewHeading,
  controls,
  children,
  onView,
}: StudioSplitProps) {
  const ids = useId();
  const [view, setView] = useState<SplitView>(INITIAL_VIEW);
  const controlsPane = useRef<HTMLDivElement>(null);
  const previewPane = useRef<HTMLElement>(null);

  const press = (pressed: SplitView) => {
    const { view: next, moveFocus } = pressView(view, pressed);
    // The pane shows before it takes focus: a hidden one can't.
    flushSync(() => setView(next));
    if (moveFocus) (next === 'controls' ? controlsPane : previewPane).current?.focus();
    onView?.(next);
  };
  const paneId = (pane: SplitView) => `${ids}-${pane}`;

  return (
    <div className="studio-split" data-view={view}>
      <div className="studio-split__switch" role="group" aria-label="Show">
        {SPLIT_VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="studio-split__show"
            aria-pressed={view === id}
            aria-controls={paneId(id)}
            onClick={() => press(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={controlsPane}
        id={paneId('controls')}
        className="studio-split__panel"
        role="region"
        aria-label={controlsLabel}
        tabIndex={-1}
      >
        {controls}
      </div>
      <section
        ref={previewPane}
        id={paneId('preview')}
        className="studio-split__preview"
        aria-labelledby={`${ids}-heading`}
        tabIndex={-1}
      >
        <h3 id={`${ids}-heading`} className="studio-split__heading">
          {previewHeading}
        </h3>
        {children}
      </section>
    </div>
  );
}

/**
 * The preview toolbar's device widths: a button for each of #7's viewport
 * presets, the one in use pressed. The frame takes that layout width, and
 * scales down to fit a narrower pane, never cropped.
 */
export function DeviceWidths({
  value,
  onChange,
}: {
  readonly value: Viewport['id'];
  readonly onChange: (id: Viewport['id']) => void;
}) {
  return (
    <div className="studio-split__widths" role="group" aria-label="Device width">
      {VIEWPORTS.map((each) => (
        <button
          key={each.id}
          type="button"
          className="studio-split__width"
          data-viewport={each.id}
          aria-pressed={value === each.id}
          onClick={() => onChange(each.id)}
        >
          {viewportLabel(each)}
        </button>
      ))}
    </div>
  );
}

/**
 * How long a run of changes pauses before a frame that has to load again
 * takes the last of them: a pick, then the next, reloads it once.
 */
export const SETTLE_MS = 300;

/**
 * `value`, once it has held for `delay` milliseconds: the first value at
 * once, then each that holds. For the frames a change has to reload, so a
 * run of picks reloads once; a frame that takes a change over its channel
 * takes it at once instead.
 */
export function useSettled<T>(value: T, delay: number = SETTLE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
