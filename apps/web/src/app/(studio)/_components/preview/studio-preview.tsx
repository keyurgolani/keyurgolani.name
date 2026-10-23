'use client';

import { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  customViewport,
  CUSTOM_WIDTH,
  frameTitle,
  REDUCED_MOTION,
  viewportLabel,
  VIEWPORTS,
  type FrameSubjectKind,
  type Viewport,
} from '~/lib/preview-frame';
import type { MintRequest } from './grant-session';
import { PreviewSurface } from './preview-surface';

// /studio/preview's client part (#7, Slice 4, items 1 and 4): the controls,
// before the frame in tab order and never over it, then one PreviewSurface.
// The viewport is a width simulation; the display mode, contrast, and motion
// change the frame in place; enhancements, JavaScript, the content, and
// Refresh load it again, and focus comes back to the control that did. Motion
// only reduces: when the owner's system already reduces it, the control is
// off and says so. #8's Studio shell takes these controls in.

/** Something the content control offers: the draft, the live revision, or a fixture. */
export interface PreviewChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: FrameSubjectKind;
  readonly subject: MintRequest['subject'];
  /** The variant its site selects, which the frame's title names, or null when it names none. */
  readonly variant: string | null;
}

export interface StudioPreviewProps {
  readonly csrfToken: string;
  readonly choices: readonly PreviewChoice[];
  /** The frame's sandbox with JavaScript on, as the page decided it for this deployment. */
  readonly sandbox: string;
  readonly previewOrigin: string | null;
  /** Where "Sign in again" goes. */
  readonly signIn: string;
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
}: StudioPreviewProps) {
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
  const request: MintRequest = {
    subject: choice.subject,
    environment: { ...environment, motion },
  };
  const reloadFrom = (control: HTMLElement) => {
    cause.current = control;
  };

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
        <p id={`${ids}-widths`} className="studio-preview__note">
          Widths simulate a device&apos;s layout width; the frame scales to fit. Forced colors,
          print, and touch input can&apos;t be previewed here.
        </p>
      </form>
      <PreviewSurface
        csrfToken={csrfToken}
        request={request}
        sandbox={javascript ? sandbox : ''}
        previewOrigin={previewOrigin}
        viewport={viewport}
        title={frameTitle(choice.kind, choice.variant, viewport)}
        refresh={refresh}
        signIn={signIn}
        onSettled={onSettled}
      />
    </div>
  );
}
