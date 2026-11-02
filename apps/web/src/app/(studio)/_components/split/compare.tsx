'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { optionNote, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';
import {
  differences,
  GRID_OTHERS,
  gridPage,
  heavyPlate,
  changeLine,
  heldLine,
  VARY_AXES,
  wipeStep,
  type CompareMode,
  type VaryAxis,
  type CompareSelection,
} from '~/lib/studio/compare';
import {
  createPreviewScheduler,
  GRID_MAX_LIVE,
  MAX_HEAVY,
  type PreviewScheduler,
} from '~/lib/studio/preview-scheduler';
import { CompositionThumbnail, paletteOf, typeOf, useShownSelection } from './pickers';
import { Segmented } from './studio-split';

// Studio's Compare, Demo's and Owner's (the Studio mockup's compareMode; the design
// director's ST-M5): A is the look pinned as Compare started, and the rail
// keeps editing B. Side by side and the wipe are the two live frames, never
// more, at one scale, filling the stage's height. The grid's plates start as
// drawings and go live through the preview scheduler as they come into view or
// are pointed at, four at most, each static but the one pointed at (round 5,
// P0-2b). The bar above says what differs, with Swap and Stop.

const VARY_LABELS: Record<VaryAxis, string> = {
  variant: 'Composition',
  colorScheme: 'Scheme',
  typography: 'Type',
  designLanguage: 'Language',
};

/** What the grid's position line calls a page's plates, by the axis Vary picks. */
const VARY_PLURALS: Record<VaryAxis, string> = {
  variant: 'Compositions',
  colorScheme: 'Schemes',
  typography: 'Type pairings',
  designLanguage: 'Languages',
};

/** Compare's bar: what differs, then the layout, Readable, Swap and Stop. */
export function CompareBar({
  catalog,
  a,
  b,
  mode,
  onMode,
  readable,
  onReadable,
  onSwap,
  onStop,
  compact = false,
  vary,
}: {
  catalog: AppearanceCatalog;
  a: CompareSelection;
  b: CompareSelection;
  /** The grid's varied axis: in the grid, the bar names what every plate keeps of A instead. */
  vary?: VaryAxis;
  /** At a phone's width: no layouts to pick, since A and B flip in one frame. */
  compact?: boolean;
  mode: CompareMode;
  onMode: (mode: CompareMode) => void;
  readable: boolean;
  onReadable: () => void;
  onSwap: () => void;
  onStop: () => void;
}) {
  const label = (axis: CatalogAxis) =>
    catalog.axes.find((entry) => entry.axis === axis)?.label ?? axis;
  const name = (axis: CatalogAxis, value: string) =>
    optionNote(catalog, axis, value).option?.name ?? value;
  const differ = differences(a, b);
  return (
    <div className="studio-compare__bar" role="group" aria-label="Compare A and B">
      {mode === 'grid' && vary && !compact ? (
        // The grid shows A and its neighbours, not B: the bar says what every plate keeps of
        // A, in place of A against B (M1). At a phone's width there are no plates, only the
        // flip between A and B, so the bar says what that compares (OWN-2).
        <p className="studio-compare__summary studio-compare__held">{heldLine(catalog, a, vary)}</p>
      ) : (
        <p className="studio-compare__summary">
          <strong>
            {differ.length === 0
              ? 'No differences yet'
              : differ.length === 1
                ? '1 difference'
                : `${differ.length} differences`}
          </strong>
          {differ.map((axis) => (
            <span key={axis} className="studio-compare__chip">
              {label(axis)}: {name(axis, a[axis])} vs {name(axis, b[axis])}
            </span>
          ))}
          <span className="studio-compare__rest">
            {differ.length === 0
              ? 'Change B in the controls to compare.'
              : 'Everything else matches.'}
            {compact ? ' Flip between A and B below.' : null}
          </span>
        </p>
      )}
      <span className="studio-compare__tools">
        {compact ? null : (
          <Segmented
            label="Compare layout"
            value={mode}
            options={[
              { id: 'side', label: 'Side by side' },
              { id: 'wipe', label: 'Wipe' },
              { id: 'grid', label: 'Grid of 4' },
            ]}
            onChange={(next) => onMode(next as CompareMode)}
          />
        )}
        {mode === 'grid' || compact ? null : (
          <button
            type="button"
            className="studio-barbutton"
            aria-pressed={readable}
            onClick={onReadable}
          >
            Readable 1024
          </button>
        )}
        <button type="button" className="studio-barbutton" onClick={onSwap}>
          Swap A and B
        </button>
        <button type="button" className="studio-barbutton studio-barbutton--quiet" onClick={onStop}>
          Stop comparing
        </button>
      </span>
    </div>
  );
}

/** A live frame's pane, headed A Pinned or B Editing; its room is the pane's, so both share a scale. */
function Pane({
  side,
  children,
  onBackToA,
}: {
  side: 'a' | 'b';
  children: ReactNode;
  onBackToA?: () => void;
}) {
  return (
    <section
      className="studio-compare__pane"
      data-side={side}
      data-fit-room
      aria-label={side === 'a' ? 'A, pinned' : 'B, editing'}
    >
      <header className="studio-compare__head">
        <span className="studio-compare__tag">{side === 'a' ? 'A' : 'B'}</span>
        <span className="studio-compare__what">{side === 'a' ? 'Pinned' : 'Editing'}</span>
        {side === 'a' && onBackToA ? (
          <button type="button" className="studio-compare__link" onClick={onBackToA}>
            Go back to A
          </button>
        ) : side === 'b' ? (
          <span className="studio-compare__note">The controls change this one</span>
        ) : null}
      </header>
      <div className="studio-compare__frame">{children}</div>
    </section>
  );
}

/** A and B side by side, each in its own pane at the same scale. */
export function CompareSide({
  frameA,
  frameB,
  onBackToA,
}: {
  frameA: ReactNode;
  frameB: ReactNode;
  onBackToA: () => void;
}) {
  return (
    <div className="studio-compare studio-compare--side">
      <Pane side="a" onBackToA={onBackToA}>
        {frameA}
      </Pane>
      <Pane side="b">{frameB}</Pane>
    </div>
  );
}

/**
 * A over B at the full scale, A showing left of the divider and B right of it.
 * The divider is a slider: arrows, Page Up and Down, Home and End move it, and
 * so does a drag on its handle.
 */
export function CompareWipe({
  frameA,
  frameB,
  at,
  onAt,
}: {
  frameA: ReactNode;
  frameB: ReactNode;
  at: number;
  onAt: (at: number) => void;
}) {
  const room = useRef<HTMLDivElement | null>(null);
  const fromPointer = (clientX: number) => {
    const box = room.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onAt(Math.round(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100))));
  };
  return (
    <div
      className="studio-compare studio-compare--wipe"
      data-fit-room
      style={{ '--wipe': `${at}%` } as CSSProperties}
    >
      <div ref={room} className="studio-compare__stack">
        <div className="studio-compare__layer" data-side="b">
          {frameB}
        </div>
        <div className="studio-compare__layer studio-compare__layer--a" data-side="a">
          {frameA}
        </div>
        <div
          className="studio-compare__divider"
          role="slider"
          tabIndex={0}
          aria-label="Wipe between A and B"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={at}
          aria-valuetext={`${at}% A, ${100 - at}% B`}
          onKeyDown={(event) => {
            const next = wipeStep(at, event.key);
            if (next === null) return;
            event.preventDefault();
            onAt(next);
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            fromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
          }}
        >
          <span className="studio-compare__grip" aria-hidden="true" />
        </div>
        <span className="studio-compare__corner" data-side="a" aria-hidden="true">
          A
        </span>
        <span className="studio-compare__corner" data-side="b" aria-hidden="true">
          B
        </span>
      </div>
    </div>
  );
}

/**
 * One still. Varying the composition, the page itself, as its package commits
 * it; on the other axes, or for a composition with none, the composition
 * drawn in the plate's scheme, filling it, with a line in its type.
 */
function PlateStill({
  catalog,
  selection,
}: {
  catalog: AppearanceCatalog;
  selection: CompareSelection;
}) {
  // Every plate's poster is its composition's drawing in the plate's own palette, the same for
  // every composition (round 5, P0-2a): never a package's committed still, which is the v1
  // fixture with its slot names, until each lane makes it again from the neutral sample.
  const palette = paletteOf(catalog, useShownSelection(selection));
  const font = typeOf(catalog, selection.typography);
  return (
    <span className="studio-plate__still" aria-hidden="true">
      <CompositionThumbnail id={selection.variant} palette={palette} />
      <span
        className="studio-plate__type"
        style={{ background: palette.canvas, color: palette.text, fontFamily: font.display }}
      >
        I make failure legible.
      </span>
    </span>
  );
}

/**
 * How much later a plate that gives up the heavy slot loads its static document than the plate
 * taking the slot loads its heavy one. Both used to load once the pointer had rested SETTLE_MS,
 * in the same tick, so the two frames' style and layout ran in one rendering update, about 60 ms
 * at the lab's 4x CPU, a long task each hand-off (the Compare sweep's perf cell). Apart, each
 * frame's is about 30 ms. The plate giving up the slot keeps its moving frame that much longer.
 */
export const HAND_OFF_MS = 400;

/**
 * Whether a plate's frame shows its heavy document: at once when the plate takes the heavy slot,
 * and HAND_OFF_MS after it gives the slot up, unless it takes it back first.
 */
export function useHandedOff(heavy: boolean): boolean {
  const [held, setHeld] = useState(heavy);
  // Taking the slot holds it at once, derived as it renders; giving it up lets go on a timer.
  if (heavy && !held) setHeld(true);
  useEffect(() => {
    if (heavy || !held) return;
    const timer = setTimeout(() => setHeld(false), HAND_OFF_MS);
    return () => clearTimeout(timer);
  }, [heavy, held]);
  return heavy || held;
}

/**
 * A plate's poster, or its live frame once the scheduler lets it hold one: it asks for a slot
 * when it comes within a viewport of the screen, and when the pointer or the focus is on it.
 * The frame is `live`'s, the selection on the same load path as a pick, scaled into the plate.
 */
function PlateView({
  id,
  scheduler,
  heavy,
  poster,
  live,
  onPoint,
}: {
  id: string;
  scheduler: PreviewScheduler;
  heavy: boolean;
  poster: ReactNode;
  live: ((heavy: boolean) => ReactNode) | undefined;
  onPoint: (id: string | null) => void;
}) {
  const root = useRef<HTMLSpanElement | null>(null);
  // The frame's document lags a hand-off by HAND_OFF_MS; the slot and the marker don't.
  const frameHeavy = useHandedOff(heavy);
  const isLive = useSyncExternalStore(
    scheduler.subscribe,
    () => scheduler.isLive(id),
    () => false,
  );
  // Whether it can go live at all, as a boolean, so a new render function each render
  // registers nothing again.
  const canLive = live !== undefined;
  useEffect(
    () => (canLive ? scheduler.register(id, 'light') : undefined),
    [scheduler, id, canLive],
  );
  // The heavy slot moves with the pointer: the tier changes in place, keeping the plate's slot.
  useEffect(() => {
    if (canLive) scheduler.setTier(id, heavy ? 'heavy' : 'light');
  }, [scheduler, id, heavy, canLive]);
  useEffect(() => {
    const element = root.current;
    if (!canLive || !element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) scheduler.setNear(id, entry.isIntersecting);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scheduler, id, canLive]);
  const point = () => {
    onPoint(id);
    scheduler.request(id);
  };
  return (
    <span
      ref={root}
      className="studio-plate__view"
      data-fit-room
      data-compare-live={isLive ? 'live' : 'still'}
      data-motion={isLive ? (heavy ? 'full' : 'static') : undefined}
      onPointerEnter={point}
      onPointerLeave={() => onPoint(null)}
      onFocusCapture={point}
    >
      {isLive && live ? live(frameHeavy) : poster}
    </span>
  );
}

/** A plate's key in the grid's scheduler: its axis and value, which tell the four apart. */
const plateKey = (vary: VaryAxis, selection: CompareSelection) => `${vary}:${selection[vary]}`;

/**
 * The grid: A, then its neighbours on the axis Vary picks, each with Use this and Pin as A.
 * Only A wears a letter, since it is Compare's A; the others are named by their pick on that
 * axis alone, never B to D, which would read as Compare's B (the clarity fix, M1). The bar
 * above says what every plate keeps of A.
 */
export function CompareGrid({
  catalog,
  a,
  b,
  vary,
  onVary,
  onUse,
  onPin,
  live,
}: {
  catalog: AppearanceCatalog;
  a: CompareSelection;
  /** B, the rail's: Use this makes it a plate's whole selection, so its name says what moves. */
  b: CompareSelection;
  vary: VaryAxis;
  onVary: (axis: VaryAxis) => void;
  onUse: (selection: CompareSelection) => void;
  onPin: (selection: CompareSelection) => void;
  /** A plate's live frame, static unless `heavy`, named `name`: absent, the plates stay drawings. */
  live?: (selection: CompareSelection, heavy: boolean, name: string) => ReactNode;
}) {
  // The grid's own scheduler: its four plates live at once, one of them heavy at most.
  const [scheduler] = useState(() =>
    createPreviewScheduler({ maxLive: GRID_MAX_LIVE, maxHeavy: MAX_HEAVY }),
  );
  const [pointed, setPointed] = useState<string | null>(null);
  const positionId = useId();
  // The page of plates, kept with the axis it pages: another axis starts at its first.
  const [paged, setPaged] = useState<{ vary: VaryAxis; page: number }>({ vary, page: 0 });
  const grid = gridPage(catalog, a, vary, paged.vary === vary ? paged.page : 0);
  const plates = grid.plates;
  const name = (selection: CompareSelection) =>
    optionNote(catalog, vary, selection[vary]).option?.name ?? selection[vary];
  const last = grid.page === grid.pages - 1;
  const heavy = heavyPlate(
    plates.map((selection) => plateKey(vary, selection)),
    pointed,
  );
  return (
    <div className="studio-compare studio-compare--grid">
      <div className="studio-compare__grid-bar">
        <Segmented
          label="Vary"
          caption="Vary"
          value={vary}
          options={VARY_AXES.map((axis) => ({ id: axis, label: VARY_LABELS[axis] }))}
          onChange={(next) => onVary(next as VaryAxis)}
        />
        {grid.pages > 1 ? (
          // Says what a click does, Next 3, never "+30", with where the page is beside it (M3).
          // Its name is its visible text alone (WCAG 2.5.3, Label in Name), and the position
          // line is its description.
          <span className="studio-compare__pager">
            <span id={positionId} className="studio-compare__position">
              {`${VARY_PLURALS[vary]} ${grid.first} to ${grid.first + plates.length - 2} of ${grid.others} besides A`}
            </span>
            <button
              type="button"
              className="studio-barbutton"
              aria-describedby={positionId}
              onClick={() => setPaged({ vary, page: last ? 0 : grid.page + 1 })}
            >
              {last ? 'Back to the first' : `Next ${GRID_OTHERS}`}
            </button>
          </span>
        ) : null}
      </div>
      <ul className="studio-compare__plates" data-count={plates.length}>
        {plates.map((selection, at) => (
          <li
            key={`${vary}-${selection[vary]}`}
            className="studio-plate"
            data-pinned={at === 0}
            aria-label={at === 0 ? `A, pinned: ${name(selection)}` : name(selection)}
          >
            <span className="studio-plate__head">
              <span className="studio-plate__name">
                {at === 0 ? <span className="studio-compare__tag">A</span> : null}
                {/* The name alone: the language's specimen read as a blob at this size, and the
                    bar above names the language every plate keeps (DEM-3). */}
                {name(selection)}
              </span>
              {at === 0 ? (
                <span className="studio-plate__note">Pinned</span>
              ) : (
                <span className="studio-plate__actions">
                  <button
                    type="button"
                    className="studio-barbutton"
                    // The name starts with the visible label (WCAG 2.5.3), then says every
                    // pick B takes (M2).
                    aria-label={`Use this: make B ${changeLine(catalog, b, selection) ?? name(selection)}`}
                    onClick={() => onUse(selection)}
                  >
                    Use this
                  </button>
                  <button
                    type="button"
                    className="studio-barbutton studio-barbutton--quiet"
                    aria-label={`Pin as A: ${name(selection)}`}
                    onClick={() => onPin(selection)}
                  >
                    Pin as A
                  </button>
                </span>
              )}
            </span>
            <PlateView
              id={plateKey(vary, selection)}
              scheduler={scheduler}
              heavy={heavy === plateKey(vary, selection)}
              poster={<PlateStill catalog={catalog} selection={selection} />}
              live={live ? (isHeavy) => live(selection, isHeavy, name(selection)) : undefined}
              onPoint={setPointed}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** At a phone's width, one frame: A or B by a toggle above it. */
export function CompareFlip({
  side,
  onSide,
  frameA,
  frameB,
}: {
  side: 'a' | 'b';
  onSide: (side: 'a' | 'b') => void;
  frameA: ReactNode;
  frameB: ReactNode;
}) {
  return (
    <div className="studio-compare studio-compare--flip">
      <Segmented
        label="Show A or B"
        value={side}
        options={[
          { id: 'a', label: 'A, pinned' },
          { id: 'b', label: 'B, editing' },
        ]}
        onChange={(next) => onSide(next as 'a' | 'b')}
      />
      {/* The shown frame's own room, under the toggle, so it fills what's left and no more. */}
      <div className="studio-compare__flip-room" data-fit-room>
        {side === 'a' ? frameA : frameB}
      </div>
    </div>
  );
}
