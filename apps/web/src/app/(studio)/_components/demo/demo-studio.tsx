'use client';

import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import type { DemoBackend } from '~/lib/demo/browser-backend';
import { demoStateLines, SANDBOX_LINE } from '~/lib/demo/state-lines';
import {
  frameSource,
  studioLocation,
  type DemoSelection,
  type SchemeModes,
  type SelectionRules,
} from '~/lib/demo/url-state';
import { REDUCED_MOTION, VIEWPORTS, viewportLabel, type Viewport } from '~/lib/preview-frame';
import { optionNote, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';
import { DemoFrame } from './demo-frame';

// Demo Studio's body (#9, design note section 2): the appearance pickers
// over the five axes, a reset for each and one for the whole demo, the
// preview's viewport and motion, and one frame of the sample with the
// selection. It reaches storage only through the browser backend its page
// hands it, and never a server. Owner Studio's shell frame (#8) holds it,
// with the sandbox line in the header: the shell's frame and its one axis
// field come out of the owner's files once #8's fourth pull request lands,
// and until then the page passes the picker in. Nothing here publishes,
// saves a draft, or signs anyone in or out.

export type DemoTask = 'appearance' | 'preview';

/** What one axis's picker gets: #8's AxisField takes exactly these. */
export interface AxisPickerProps {
  readonly axis: CatalogAxis;
  readonly label: string;
  readonly value: string;
  readonly catalog: AppearanceCatalog;
  readonly onChange: (value: string) => void;
}

export interface DemoStudioProps {
  /** What the build offers on each axis, without generated schemes, which /sample can't render. */
  readonly catalog: AppearanceCatalog;
  readonly schemeModes?: SchemeModes;
  /** The browser backend, once the page has loaded it, or null until then. */
  readonly backend: DemoBackend | null;
  readonly task: DemoTask;
  readonly AxisPicker: ComponentType<AxisPickerProps>;
}

/** The sandbox line every Demo Studio view shows in its header. */
export function SandboxLine() {
  return <p className="studio-shell__signed-in">{SANDBOX_LINE}</p>;
}

function subscribeToMotion(change: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether the visitor's system reduces motion: false on the server. */
function useSystemReducesMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export function DemoStudio({ catalog, schemeModes, backend, task, AxisPicker }: DemoStudioProps) {
  const ids = useId();
  const rules: SelectionRules = useMemo(() => ({ catalog, schemeModes }), [catalog, schemeModes]);
  const [selection, setSelection] = useState<DemoSelection | null>(
    () => backend?.selection() ?? null,
  );
  const [notice, setNotice] = useState('');
  const [viewportId, setViewportId] = useState<Viewport['id']>('desktop');
  const [motion, setMotion] = useState<'system' | 'reduce'>('system');
  const systemReduces = useSystemReducesMotion();

  // A backend the page hands over later brings its own selection, read as this renders.
  const [shown, setShown] = useState(backend);
  if (backend !== shown) {
    setShown(backend);
    setSelection(backend?.selection() ?? null);
  }

  // The URL follows the selection, in place, so Back leaves Studio.
  useEffect(() => {
    if (!selection) return;
    const { pathname, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      studioLocation(pathname, hash, selection, rules),
    );
  }, [selection, rules]);

  if (!backend || !selection) {
    return <p className="studio-state__waiting">Loading the demo…</p>;
  }
  const labelOf = (axis: CatalogAxis) =>
    catalog.axes.find((each) => each.axis === axis)?.label ?? axis;
  const nameOf = (axis: CatalogAxis, value: string) =>
    optionNote(catalog, axis, value).option?.name ?? value;

  async function choose(axis: CatalogAxis, value: string) {
    if (!backend) return;
    const working = await backend.workingDraft();
    if (working.kind !== 'read' || !working.value) return;
    const result = await backend.applyEdits({
      draftId: working.value.draftId,
      expectedVersion: working.value.version,
      edits: [{ document: 'site', pointer: `/appearance/${axis}`, op: 'set', value }],
    });
    if (result.kind === 'saved') {
      setSelection(backend.selection());
      setNotice(`${labelOf(axis)} is now ${nameOf(axis, value)}.`);
    } else if (result.kind === 'failed') {
      setNotice(`${labelOf(axis)} didn't change. ${result.message}`);
    }
  }

  function resetAxis(axis: CatalogAxis) {
    if (!backend) return;
    const next = backend.resetAxis(axis);
    setSelection(next);
    setNotice(`${labelOf(axis)} is back to the sample's own, ${nameOf(axis, next[axis])}.`);
  }

  function resetAll() {
    if (!backend) return;
    setSelection(backend.resetAll());
    setNotice(
      "The demo is back to the sample's own appearance, and this browser holds none of it.",
    );
  }

  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const reduced = motion === 'reduce' && !systemReduces;
  const lines = demoStateLines(catalog, selection, backend.persistent());
  const title = `Demo sample, ${nameOf('variant', selection.variant)}, ${viewportLabel(viewport)}`;
  const frame = (
    <DemoFrame
      src={frameSource(selection, rules, { reduceMotion: reduced })}
      title={title}
      viewport={viewport}
    />
  );

  return (
    <div className="studio-demo" data-task={task}>
      <section className="studio-state" aria-labelledby={`${ids}-state`}>
        <h2 id={`${ids}-state`} className="studio-state__heading">
          Where things stand
        </h2>
        <dl className="studio-state__lines">
          {lines.map((line) => (
            <div
              key={line.id}
              className="studio-state__line"
              data-state={line.id}
              data-tone={line.tone}
            >
              <dt>{line.label}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
        <p className="studio-state__notice" role="status">
          {notice}
        </p>
      </section>
      {task === 'appearance' ? (
        <section className="studio-task" aria-labelledby={`${ids}-task`}>
          <h2 id={`${ids}-task`} className="studio-task__heading">
            Appearance
          </h2>
          <div className="studio-appearance__form">
            {catalog.axes.map(({ axis, label }) => (
              <div key={axis} className="studio-appearance__axis">
                <AxisPicker
                  axis={axis}
                  label={label}
                  value={selection[axis]}
                  catalog={catalog}
                  onChange={(value) => void choose(axis, value)}
                />
                <button type="button" className="studio-button" onClick={() => resetAxis(axis)}>
                  Reset {label.toLowerCase()}
                </button>
              </div>
            ))}
            <div className="studio-source__actions">
              <button type="button" className="studio-button" onClick={resetAll}>
                Reset demo
              </button>
            </div>
          </div>
          {frame}
        </section>
      ) : (
        <section className="studio-task" aria-labelledby={`${ids}-task`}>
          <h2 id={`${ids}-task`} className="studio-task__heading">
            Preview
          </h2>
          <div className="studio-preview__controls">
            <div className="studio-preview__field">
              <label className="studio-label" htmlFor={`${ids}-viewport`}>
                Width (simulated)
              </label>
              <select
                id={`${ids}-viewport`}
                className="studio-input"
                value={viewportId}
                onChange={(event) => setViewportId(event.currentTarget.value as Viewport['id'])}
              >
                {VIEWPORTS.map((each) => (
                  <option key={each.id} value={each.id}>
                    {viewportLabel(each)}
                  </option>
                ))}
              </select>
            </div>
            <div className="studio-preview__field">
              <AxisPicker
                axis="displayMode"
                label={labelOf('displayMode')}
                value={selection.displayMode}
                catalog={catalog}
                onChange={(value) => void choose('displayMode', value)}
              />
            </div>
            <div className="studio-preview__field">
              <label className="studio-label" htmlFor={`${ids}-motion`}>
                Motion
              </label>
              <select
                id={`${ids}-motion`}
                className="studio-input"
                value={systemReduces ? 'reduce' : motion}
                disabled={systemReduces}
                aria-describedby={systemReduces ? `${ids}-motion-note` : undefined}
                onChange={(event) => setMotion(event.currentTarget.value as 'system' | 'reduce')}
              >
                <option value="system">Follow system</option>
                <option value="reduce">Reduced</option>
              </select>
              {systemReduces ? (
                <p id={`${ids}-motion-note`} className="studio-preview__note">
                  Reduced by system
                </p>
              ) : null}
            </div>
          </div>
          {frame}
        </section>
      )}
    </div>
  );
}
