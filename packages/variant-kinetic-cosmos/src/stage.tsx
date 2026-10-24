'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { Runtime } from './runtime';

// The opening's stage (#14), the motion layer on #6's runtime: the orbit
// turns, a bounded field of glyphs falls behind it, and a pointer can drag
// the orbit round. All of it is decoration, hidden from assistive
// technology, and none of it shows anything the words don't.
//
// The runtime decides, never data-motion alone: the stage carries
// data-runtime only while its runtime is active or paused, and the
// stylesheet starts the motion only under it. So the server's render, the
// first client render, reduced motion, a static environment, a failure, and
// a plate all show the still composition, with no glyph and no moving part.
// Paused, when the document is hidden, the stage is offscreen, or the
// visitor or a preview pauses it, the runtime's data-activity holds every
// animation where it is (experience-base.css). Every animation is a
// transform on a layer of its own, its duration a multiple of the motion
// pack's --ui-motion-slow, so timing comes from the selected packs.

/** Glyphs on each of the field's two layers. A constant: the field never grows with the content or the window. */
export const GLYPHS_PER_LAYER = 12;

/** Code punctuation, never words: the glyphs carry no content, and nothing from a section. */
const SYMBOLS = ['{', '}', '<', '>', '/', ';', '=', '+', '*', '(', ')', '[', ']', '|', '~', '#'];

const LAYERS = ['far', 'near'] as const;

interface Glyph {
  readonly symbol: string;
  readonly inline: string;
  readonly block: number;
  readonly size: 's' | 'm' | 'l';
}

const SIZES = ['s', 'm', 'l'] as const;

/** The fractional part of `value`. */
const frac = (value: number) => value - Math.floor(value);

/**
 * One layer's glyphs, the same on the server and every client: spread by
 * the golden ratio across the layer's inline axis and its first half, the
 * tile that repeats below it.
 */
function layerGlyphs(layer: number): Glyph[] {
  return Array.from({ length: GLYPHS_PER_LAYER }, (_, index) => {
    const at = index + layer * GLYPHS_PER_LAYER;
    return {
      symbol: SYMBOLS[(at * 7) % SYMBOLS.length]!,
      inline: `${(2 + frac(at * 0.618034 + layer * 0.31) * 94).toFixed(1)}%`,
      block: Math.round(frac(at * 0.381966 + layer * 0.17) * 480) / 10,
      size: SIZES[(at * 5) % SIZES.length]!,
    };
  });
}

const FIELD = LAYERS.map((name, layer) => ({ name, glyphs: layerGlyphs(layer) }));

const RINGS = ['inner', 'middle', 'outer'] as const;

/** The orbit's turn from a pointer's position, in degrees around `element`'s center. */
function angleAt(element: Element, x: number, y: number): number {
  const box = element.getBoundingClientRect();
  return (
    (Math.atan2(y - (box.top + box.height / 2), x - (box.left + box.width / 2)) * 180) / Math.PI
  );
}

interface StageMarkupProps {
  readonly children: ReactNode;
  readonly attachRoot?: (node: Element | null) => void;
  readonly runtime?: 'active' | 'paused';
  readonly turn?: RefObject<HTMLDivElement | null>;
  readonly handlers?: Readonly<Record<string, (event: PointerEvent<HTMLDivElement>) => void>>;
}

/** The stage's markup: the still, and with a runtime, what moves on it. */
function StageMarkup({ children, attachRoot, runtime, turn, handlers }: StageMarkupProps) {
  return (
    <div ref={attachRoot} className="kc-opening" data-runtime={runtime}>
      <div className="kc-glyphs" aria-hidden="true" data-type-role="code">
        {FIELD.map(({ name, glyphs }) => (
          <div key={name} className={`kc-glyphs__layer kc-glyphs__layer--${name}`}>
            {[0, 50].flatMap((tile) =>
              glyphs.map((glyph, index) => (
                <span
                  key={`${tile}-${index}`}
                  className={`kc-glyph kc-glyph--${glyph.size}`}
                  data-glyph={glyph.symbol}
                  style={{
                    insetInlineStart: glyph.inline,
                    insetBlockStart: `${glyph.block + tile}%`,
                  }}
                />
              )),
            )}
          </div>
        ))}
      </div>
      <div className="kc-orbit" aria-hidden="true" {...handlers}>
        <div ref={turn} className="kc-orbit__turn">
          <div className="kc-orbit__spin">
            {RINGS.map((ring) => (
              <span key={ring} className={`kc-orbit__ring kc-orbit__ring--${ring}`} />
            ))}
            {RINGS.map((ring) => (
              <span key={ring} className={`kc-orbit__satellite kc-orbit__satellite--${ring}`} />
            ))}
          </div>
        </div>
        <span className="kc-orbit__core" />
      </div>
      <div className="kc-opening__content">{children}</div>
    </div>
  );
}

/** The stage on its runtime: the only path that calls the hook, observes, or listens. */
function LiveStage({ children }: { readonly children: ReactNode }) {
  const { attachRoot, state } = Runtime.useEnhancementRuntime();
  const moving = state !== 'static';
  const turn = useRef<HTMLDivElement | null>(null);
  // Where the drag started, and the turn it started from.
  const drag = useRef<{ pointer: number; from: number; offset: number } | null>(null);
  const offset = useRef(0);

  const start = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = {
      pointer: event.pointerId,
      from: angleAt(event.currentTarget, event.clientX, event.clientY),
      offset: offset.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const move = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.pointer !== event.pointerId || !turn.current) return;
    offset.current =
      held.offset + angleAt(event.currentTarget, event.clientX, event.clientY) - held.from;
    turn.current.style.transform = `rotate(${offset.current.toFixed(2)}deg)`;
  }, []);
  const end = useCallback(() => {
    drag.current = null;
  }, []);
  // Back to the still composition, the orbit where the server drew it.
  useEffect(() => {
    if (moving) return;
    drag.current = null;
    offset.current = 0;
    turn.current?.style.removeProperty('transform');
  }, [moving]);
  // The drag only turns the orbit, and only while there's motion to have:
  // nothing it reveals is anywhere else, and the still composition has none.
  const handlers = moving
    ? { onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: end }
    : undefined;

  return (
    <StageMarkup
      attachRoot={attachRoot}
      runtime={state === 'static' ? undefined : state}
      turn={turn}
      handlers={handlers}
    >
      {children}
    </StageMarkup>
  );
}

/**
 * The opening's stage. In a plate it's the still markup alone, before any
 * runtime hook: no subscription, observer, listener, or attribute of the
 * runtime's. Anywhere else it's the live stage.
 */
export function OpeningStage({ children }: { readonly children: ReactNode }) {
  const { plate } = useBoundary();
  return plate ? <StageMarkup>{children}</StageMarkup> : <LiveStage>{children}</LiveStage>;
}
