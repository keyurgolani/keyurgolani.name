'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
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
import type { ToFramePayload } from '~/preview/protocol';
import { PHONE_STUDIO, useMatchesMedia } from '../split/studio-split';
import { AppearanceControls } from './appearance-controls';
import { PreviewSurface, type PreviewSurfaceHandle } from './preview-surface';

// /studio/preview's client part (#7, Slice 4, items 1 and 4): the controls,
// before the frame in tab order and never over it, then one PreviewSurface.
// The viewport is a width simulation; the display mode, contrast, and motion
// change the frame in place; enhancements, JavaScript, the content, an
// appearance override, and Refresh load it again, and focus comes back to the
// control that did. Motion only reduces: when the owner's system already
// reduces it, the control is off and says so. #8's Studio shell takes these
// controls in. Comparing is Owner Studio's Compare (OWN-2), the one Demo
// Studio has: this page's "Compare two frames" checkbox, its second frame,
// and its linking, the pattern the owner rejected, are gone.
//
// In the Appearance view's split (owner direction, 2026-10-25), this is the
// frame alone: the workspace draws the rail and the bars, and passes the bar's
// device width and motion down. Its pending selection is the frame's
// appearance override, which a new grant renders in a copy of the site's
// text, never the draft, only when the composition changes, since the
// document is server-rendered; every other axis goes over the channel as an
// in-place `appearance`, with no load. Its live region says only what went
// wrong.

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
  /** In the split, the appearance the frame shows in place, over its channel, or null for its grant's own. */
  readonly inPlace?: ToFramePayload<'appearance'> | null;
  /**
   * In the split, Compare's name for the frame: "A, pinned", "B, editing", or
   * a Grid of 4 plate's pick. Its region's name is this, and its title starts
   * with it, so two frames on the stage never share one. Absent, "Preview".
   */
  readonly lead?: string;
  /**
   * In the split, what the workspace's bar over the frame chose: the device
   * width, motion, and how the frame fits the stage, and where its scale goes.
   * The workspace draws the bar and the rail itself, so they never wait for
   * this chunk; here is the frame alone.
   */
  readonly view?: {
    readonly viewportId: Viewport['id'];
    readonly motion: 'system' | 'reduce';
    readonly fit: 'contain' | 'fill';
    readonly onScale: (scale: number) => void;
    /** The route the frame shows (the page switch), which it navigates to over #7's channel. */
    readonly route?: string;
    /** Hears the frame's route when the reader follows a link in it. */
    readonly onRoute?: (route: string) => void;
    /** Shows the problems that keep the saved draft from a preview: Content's findings. */
    readonly onShowProblems?: () => void;
    /** The task that lists them, when it isn't the workspace's own: "Content". */
    readonly problemsIn?: string;
  };
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

const noChange = () => () => {};

/**
 * Whether the page has hydrated, so a click reaches its script: false in the server's markup
 * (row 89, as Sign out's canSignOut, row 88).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noChange,
    () => true,
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
  inPlace = null,
  lead,
  view,
}: StudioPreviewProps) {
  const split = layout === 'split';
  const ids = useId();
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? '');
  const [pickedViewport, setViewportId] = useState<Viewport['id'] | null>(null);
  // In the split at a phone's width the frame starts on the mobile preset, as Demo Studio's does.
  const phone = useMatchesMedia(PHONE_STUDIO);
  const viewportId: Viewport['id'] =
    (split ? view?.viewportId : null) ?? pickedViewport ?? (split && phone ? 'mobile' : 'desktop');
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
  // Refresh takes a click once the page has hydrated: until then nothing would load the frame
  // again, so the server's markup holds it (row 89).
  const hydrated = useHydrated();
  /** The control that asked for a new load, which gets focus back once the frame settles. */
  const cause = useRef<HTMLElement | null>(null);
  const onSettled = useCallback(() => {
    const control = cause.current;
    cause.current = null;
    if (control && document.activeElement !== control) control.focus();
  }, []);

  // The page's frame takes its own controls' appearance override; the split's, the workspace's.
  const [own, setOwn] = useState<AppearanceSelection | null>(null);
  const appearanceOverride = split ? override : own;
  const first = useRef<PreviewSurfaceHandle | null>(null);
  // Item focus: the frame shows the section now, or as soon as it's ready.
  const focus = useRef(focusAnchor);
  useEffect(() => {
    focus.current = focusAnchor;
    if (focusAnchor) first.current?.focus(focusAnchor);
  }, [focusAnchor]);
  // The page switch: the frame goes to the route asked for, now if its channel is open, else
  // once it arrives. A route it went to itself is already there.
  const wanted = view?.route ?? '/';
  const at = useRef('/');
  useEffect(() => {
    if (wanted !== at.current && first.current?.navigate(wanted)) at.current = wanted;
  }, [wanted]);

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
  const motion = systemReduces ? 'reduce' : split && view ? view.motion : environment.motion;
  const request: MintRequest = {
    subject: choice.subject,
    environment: { ...environment, motion },
    ...(appearanceOverride ? { appearance: appearanceOverride } : {}),
  };
  const reloadFrom = (control: HTMLElement) => {
    cause.current = control;
  };
  const title = frameTitle(
    choice.kind,
    appearanceOverride
      ? renderedVariant(
          appearanceOverride.variant ?? choice.appearance?.variant ?? null,
          appearanceOptions.variants,
        )
      : choice.variant,
    viewport,
  );

  if (split && view) {
    return (
      <PreviewSurface
        handle={first}
        name={lead ?? 'Preview'}
        csrfToken={csrfToken}
        request={request}
        sandbox={javascript ? sandbox : ''}
        previewOrigin={previewOrigin}
        viewport={viewport}
        title={lead ? `${lead}: ${title}` : title}
        refresh={refresh}
        signIn={signIn}
        onSettled={onSettled}
        announce="problems"
        appearance={inPlace}
        keepPlace
        fit={view.fit}
        onScale={view.onScale}
        {...(view.onShowProblems ? { onShowProblems: view.onShowProblems } : {})}
        {...(view.problemsIn ? { problemsIn: view.problemsIn } : {})}
        onArrived={(route) => {
          at.current = route;
          if (route !== wanted && first.current?.navigate(wanted)) at.current = wanted;
          else if (focus.current) first.current?.focus(focus.current);
        }}
        onNavigated={(route) => {
          at.current = route;
          view.onRoute?.(route);
        }}
      />
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
              setOwn(null);
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
          {/* Held, in Studio's busy look, until the page hydrates: never natively disabled. */}
          <button
            type="button"
            className="studio-button"
            aria-disabled={hydrated ? undefined : true}
            onClick={(event) => {
              if (!hydrated) return;
              reloadFrom(event.currentTarget);
              setRefresh((count) => count + 1);
            }}
          >
            Refresh
          </button>
        </div>
        <p id={`${ids}-widths`} className="studio-preview__note">
          Widths simulate a device&apos;s layout width; the frame scales to fit. Forced colors,
          print, and touch input can&apos;t be previewed here.
        </p>
      </form>
      <div className="studio-preview__frames">
        <div className="studio-preview__frame">
          <AppearanceControls
            idPrefix={`${ids}-appearance`}
            legend="Appearance"
            own={choice.appearance}
            value={own}
            options={appearanceOptions}
            onChange={(next, control) => {
              reloadFrom(control);
              setOwn(next);
            }}
          />
          <PreviewSurface
            handle={first}
            name="Preview"
            csrfToken={csrfToken}
            request={request}
            sandbox={javascript ? sandbox : ''}
            previewOrigin={previewOrigin}
            viewport={viewport}
            title={title}
            refresh={refresh}
            signIn={signIn}
            onSettled={onSettled}
            onArrived={() => {
              if (focus.current) first.current?.focus(focus.current);
            }}
          />
        </div>
      </div>
    </div>
  );
}
