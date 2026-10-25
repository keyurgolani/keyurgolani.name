'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AppearanceSelection } from '@portfolio/schema';
import {
  customViewport,
  CUSTOM_WIDTH,
  frameTitle,
  REDUCED_MOTION,
  renderedVariant,
  type AppearanceOptions,
  viewportLabel,
  VIEWPORTS,
  type FrameSubjectKind,
  type Viewport,
} from '~/lib/preview-frame';
import type { MintRequest } from './grant-session';
import { DeviceWidths } from '../split/studio-split';
import { AppearanceControls } from './appearance-controls';
import { createFrameLink, type FrameSide } from './frame-link';
import { PreviewSurface, type PreviewSurfaceHandle } from './preview-surface';

// /studio/preview's client part (#7, Slice 4, items 1 and 4): the controls,
// before the frame in tab order and never over it, then one PreviewSurface,
// or two side by side to compare (item 7). The viewport is a width
// simulation; the display mode, contrast, and motion change the frame in
// place; enhancements, JavaScript, the content, an appearance override, and
// Refresh load it again, and focus comes back to the control that did. Motion
// only reduces: when the owner's system already reduces it, the control is
// off and says so. Compared, each frame has its own grant, nonce, port, and
// appearance override, and linking their scrolling and navigation is off
// until the owner turns it on (frame-link.ts). #8's Studio shell takes these
// controls in.
//
// In the Appearance view's split (owner direction, 2026-10-25), the
// workspace's own controls drive the frame: its pending selection is the
// frame's appearance override, which a new grant renders in a copy of the
// site's text, never the draft. There the toolbar has the device widths as
// buttons, the display mode, motion, and contrast, which change the frame in
// place, and Refresh; the full-window preview keeps the rest. Its live region
// says only what went wrong, since every pick reloads the frame.

/** Something the content control offers: the draft, the live revision, or a fixture. */
export interface PreviewChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: FrameSubjectKind;
  readonly subject: MintRequest['subject'];
  /** The variant its site selects, which the frame's title names, or null when it names none. */
  readonly variant: string | null;
  /** The appearance its site selects, which a frame's override starts from, or null. */
  readonly appearance: AppearanceSelection | null;
}

export interface StudioPreviewProps {
  readonly csrfToken: string;
  readonly choices: readonly PreviewChoice[];
  /** The frame's sandbox with JavaScript on, as the page decided it for this deployment. */
  readonly sandbox: string;
  readonly previewOrigin: string | null;
  /** What this build registers for a frame's appearance override to select. */
  readonly appearanceOptions: AppearanceOptions;
  /** Where "Sign in again" goes. */
  readonly signIn: string;
  /**
   * Item focus (#8, Slice 4 item 6): the section a form item selected, which
   * the first frame scrolls to and outlines, once it's ready. Null for none.
   */
  readonly focusAnchor?: string | null;
  /**
   * `split` for the Appearance view's preview pane: one frame, whose
   * appearance override is `override`, and the toolbar's controls alone.
   * `page`, the default, is /studio/preview's.
   */
  readonly layout?: 'page' | 'split';
  /** In the split, the frame's appearance override: the workspace's pending selection, or null for the site's own. */
  readonly override?: AppearanceSelection | null;
  /** In the split, more of the toolbar, after its own controls: the workspace's section picker and links. */
  readonly toolbar?: ReactNode;
}

type Environment = MintRequest['environment'];

function subscribeToMotion(change: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether the owner's system reduces motion: false on the server. */
function useSystemReducesMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export function StudioPreview({
  csrfToken,
  choices,
  sandbox,
  previewOrigin,
  signIn,
  appearanceOptions,
  focusAnchor = null,
  layout = 'page',
  override = null,
  toolbar = null,
}: StudioPreviewProps) {
  const split = layout === 'split';
  const ids = useId();
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? '');
  const [viewportId, setViewportId] = useState<Viewport['id']>('desktop');
  const [customWidth, setCustomWidth] = useState(800);
  const [environment, setEnvironment] = useState<Environment>({
    displayMode: 'system',
    contrast: 'system',
    motion: 'system',
    enhancement: 'on',
  });
  const [javascript, setJavaScript] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const systemReduces = useSystemReducesMotion();
  /** The control that asked for a new load, which gets focus back once the frame settles. */
  const cause = useRef<HTMLElement | null>(null);
  const onSettled = useCallback(() => {
    const control = cause.current;
    cause.current = null;
    if (control && document.activeElement !== control) control.focus();
  }, []);

  // Comparison (#7, item 7): a second frame with its own grant, nonce, port,
  // and appearance override, and linking, off until the owner turns it on.
  const [compare, setCompare] = useState(false);
  const [linked, setLinked] = useState(false);
  const [own, setOverrides] = useState<readonly (AppearanceSelection | null)[]>([null, null]);
  // The split's frame takes the workspace's selection; the page's frames, their own controls'.
  const overrides = split ? [override, null] : own;
  const link = useRef(createFrameLink());
  const first = useRef<PreviewSurfaceHandle | null>(null);
  const second = useRef<PreviewSurfaceHandle | null>(null);
  const handles = [first, second] as const;
  const isLinked = !split && compare && linked;
  useEffect(() => {
    link.current.setLinked(isLinked);
  }, [isLinked]);
  // Item focus: the first frame shows the section now, or as soon as it's ready.
  const focus = useRef(focusAnchor);
  useEffect(() => {
    focus.current = focusAnchor;
    if (focusAnchor) first.current?.focus(focusAnchor);
  }, [focusAnchor]);
  const other = (side: FrameSide) => handles[side === 0 ? 1 : 0].current;

  const choice = choices.find(({ id }) => id === choiceId) ?? choices[0];
  if (!choice) {
    return (
      <p className="studio-status" role="status">
        Nothing to preview yet: there&apos;s no draft and no published revision.
      </p>
    );
  }
  const viewport =
    viewportId === 'custom'
      ? customViewport(customWidth)
      : (VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!);
  // Motion only reduces: a system that reduces it holds the frame reduced.
  const motion = systemReduces ? 'reduce' : environment.motion;
  const requestFor = (side: FrameSide): MintRequest => {
    const appearance = overrides[side] ?? null;
    return {
      subject: choice.subject,
      environment: { ...environment, motion },
      ...(appearance ? { appearance } : {}),
    };
  };
  const reloadFrom = (control: HTMLElement) => {
    cause.current = control;
  };
  const sides: readonly FrameSide[] = compare && !split ? [0, 1] : [0];
  const named = (side: FrameSide) =>
    sides.length === 2 ? (side === 0 ? 'First preview' : 'Second preview') : 'Preview';
  const titleOf = (side: FrameSide) => {
    const selected = overrides[side]?.variant ?? choice.appearance?.variant ?? null;
    const variant = overrides[side]
      ? renderedVariant(selected, appearanceOptions.variants)
      : choice.variant;
    return frameTitle(
      choice.kind,
      variant,
      viewport,
      sides.length === 2 ? (side === 0 ? 'first' : 'second') : undefined,
    );
  };

  const surface = (side: FrameSide) => (
    <PreviewSurface
      handle={handles[side]}
      name={named(side)}
      csrfToken={csrfToken}
      request={requestFor(side)}
      sandbox={javascript ? sandbox : ''}
      previewOrigin={previewOrigin}
      viewport={viewport}
      title={titleOf(side)}
      refresh={refresh}
      signIn={signIn}
      onSettled={onSettled}
      announce={split ? 'problems' : 'all'}
      scrollSync={isLinked}
      onArrived={(route) => {
        link.current.arrived(side, route);
        if (side === 0 && focus.current) handles[0].current?.focus(focus.current);
      }}
      onNavigated={(route) => {
        const to = link.current.navigated(side, route);
        const otherSide: FrameSide = side === 0 ? 1 : 0;
        if (to !== null && other(side)?.navigate(to)) link.current.moved(otherSide, to);
      }}
      onScrolled={(position) => {
        const to = link.current.scrolled(side, position);
        if (to !== null) other(side)?.scrollTo(to);
      }}
    />
  );

  if (split) {
    return (
      <div className="studio-preview" data-layout="split">
        <form
          className="studio-preview__controls studio-split__toolbar"
          aria-label="Preview controls"
          onSubmit={(event) => event.preventDefault()}
        >
          <DeviceWidths value={viewportId} onChange={setViewportId} />
          <div className="studio-preview__field">
            <label className="studio-label" htmlFor={`${ids}-mode`}>
              Display mode
            </label>
            <select
              id={`${ids}-mode`}
              className="studio-input"
              value={environment.displayMode}
              onChange={(event) =>
                setEnvironment({
                  ...environment,
                  displayMode: event.currentTarget.value as Environment['displayMode'],
                })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="high-contrast">High contrast</option>
            </select>
          </div>
          <div className="studio-preview__field">
            <label className="studio-label" htmlFor={`${ids}-motion`}>
              Motion
            </label>
            <select
              id={`${ids}-motion`}
              className="studio-input"
              value={motion}
              disabled={systemReduces}
              aria-describedby={systemReduces ? `${ids}-motion-note` : undefined}
              onChange={(event) =>
                setEnvironment({
                  ...environment,
                  motion: event.currentTarget.value as Environment['motion'],
                })
              }
            >
              <option value="system">System</option>
              <option value="reduce">Reduce</option>
            </select>
            {systemReduces ? (
              <p id={`${ids}-motion-note`} className="studio-preview__note">
                Reduced by system
              </p>
            ) : null}
          </div>
          <div className="studio-preview__field">
            <label className="studio-label" htmlFor={`${ids}-contrast`}>
              Contrast
            </label>
            <select
              id={`${ids}-contrast`}
              className="studio-input"
              value={environment.contrast}
              onChange={(event) =>
                setEnvironment({
                  ...environment,
                  contrast: event.currentTarget.value as Environment['contrast'],
                })
              }
            >
              <option value="system">System</option>
              <option value="more">More</option>
            </select>
          </div>
          <div className="studio-preview__field">
            <button
              type="button"
              className="studio-button"
              onClick={(event) => {
                reloadFrom(event.currentTarget);
                setRefresh((count) => count + 1);
              }}
            >
              Refresh
            </button>
          </div>
          {toolbar}
        </form>
        <div className="studio-preview__frames">
          <div className="studio-preview__frame">{surface(0)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-preview">
      <form
        className="studio-preview__controls"
        aria-label="Preview controls"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-content`}>
            Content
          </label>
          <select
            id={`${ids}-content`}
            className="studio-input"
            value={choice.id}
            onChange={(event) => {
              reloadFrom(event.currentTarget);
              setChoiceId(event.currentTarget.value);
              // Another version starts from its own site's appearance.
              setOverrides([null, null]);
            }}
          >
            {choices.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-viewport`}>
            Width (simulated)
          </label>
          <select
            id={`${ids}-viewport`}
            className="studio-input"
            value={viewportId}
            aria-describedby={`${ids}-widths`}
            onChange={(event) => setViewportId(event.currentTarget.value as Viewport['id'])}
          >
            {VIEWPORTS.map((each) => (
              <option key={each.id} value={each.id}>
                {viewportLabel(each)}
              </option>
            ))}
            <option value="custom">Custom width</option>
          </select>
        </div>
        {viewportId === 'custom' ? (
          <div className="studio-preview__field">
            <label className="studio-label" htmlFor={`${ids}-width`}>
              Custom width in pixels
            </label>
            <input
              id={`${ids}-width`}
              className="studio-input"
              type="number"
              min={CUSTOM_WIDTH.min}
              max={CUSTOM_WIDTH.max}
              step={1}
              value={customWidth}
              onChange={(event) => setCustomWidth(event.currentTarget.valueAsNumber)}
            />
          </div>
        ) : null}
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-mode`}>
            Display mode
          </label>
          <select
            id={`${ids}-mode`}
            className="studio-input"
            value={environment.displayMode}
            onChange={(event) =>
              setEnvironment({
                ...environment,
                displayMode: event.currentTarget.value as Environment['displayMode'],
              })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-motion`}>
            Motion
          </label>
          <select
            id={`${ids}-motion`}
            className="studio-input"
            value={motion}
            disabled={systemReduces}
            aria-describedby={systemReduces ? `${ids}-motion-note` : undefined}
            onChange={(event) =>
              setEnvironment({
                ...environment,
                motion: event.currentTarget.value as Environment['motion'],
              })
            }
          >
            <option value="system">System</option>
            <option value="reduce">Reduce</option>
          </select>
          {systemReduces ? (
            <p id={`${ids}-motion-note`} className="studio-preview__note">
              Reduced by system
            </p>
          ) : null}
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-contrast`}>
            Contrast
          </label>
          <select
            id={`${ids}-contrast`}
            className="studio-input"
            value={environment.contrast}
            onChange={(event) =>
              setEnvironment({
                ...environment,
                contrast: event.currentTarget.value as Environment['contrast'],
              })
            }
          >
            <option value="system">System</option>
            <option value="more">More</option>
          </select>
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-enhancement`}>
            Enhancements
          </label>
          <select
            id={`${ids}-enhancement`}
            className="studio-input"
            value={environment.enhancement}
            onChange={(event) => {
              reloadFrom(event.currentTarget);
              setEnvironment({
                ...environment,
                enhancement: event.currentTarget.value as Environment['enhancement'],
              });
            }}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor={`${ids}-javascript`}>
            JavaScript
          </label>
          <select
            id={`${ids}-javascript`}
            className="studio-input"
            value={javascript ? 'on' : 'off'}
            onChange={(event) => {
              reloadFrom(event.currentTarget);
              setJavaScript(event.currentTarget.value === 'on');
            }}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div className="studio-preview__field">
          <button
            type="button"
            className="studio-button"
            onClick={(event) => {
              reloadFrom(event.currentTarget);
              setRefresh((count) => count + 1);
            }}
          >
            Refresh
          </button>
        </div>
        <div className="studio-preview__field studio-preview__check">
          <input
            id={`${ids}-compare`}
            type="checkbox"
            checked={compare}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              setCompare(on);
              if (!on) setLinked(false);
            }}
          />
          <label className="studio-label" htmlFor={`${ids}-compare`}>
            Compare two frames
          </label>
        </div>
        <div className="studio-preview__field studio-preview__check">
          <input
            id={`${ids}-linked`}
            type="checkbox"
            checked={isLinked}
            disabled={!compare}
            aria-describedby={`${ids}-linked-note`}
            onChange={(event) => setLinked(event.currentTarget.checked)}
          />
          <label className="studio-label" htmlFor={`${ids}-linked`}>
            Link scrolling and navigation
          </label>
          <p id={`${ids}-linked-note`} className="studio-preview__note">
            Off, each frame scrolls and moves on its own.
          </p>
        </div>
        <p id={`${ids}-widths`} className="studio-preview__note">
          Widths simulate a device&apos;s layout width; the frame scales to fit. Forced colors,
          print, and touch input can&apos;t be previewed here.
        </p>
      </form>
      <div className="studio-preview__frames" data-compare={compare ? 'true' : undefined}>
        {sides.map((side) => (
          <div key={side} className="studio-preview__frame">
            <AppearanceControls
              idPrefix={`${ids}-appearance-${side}`}
              legend={
                compare
                  ? side === 0
                    ? "First frame's appearance"
                    : "Second frame's appearance"
                  : 'Appearance'
              }
              own={choice.appearance}
              value={overrides[side] ?? null}
              options={appearanceOptions}
              onChange={(next, control) => {
                reloadFrom(control);
                setOverrides((now) => now.map((each, at) => (at === side ? next : each)));
              }}
            />
            {surface(side)}
          </div>
        ))}
      </div>
    </div>
  );
}
