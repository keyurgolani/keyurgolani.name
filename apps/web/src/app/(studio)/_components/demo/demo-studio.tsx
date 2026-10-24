'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import type { StudioPolicy } from '~/lib/studio/backend';
import { tasksFor, type StudioTask, type TaskId } from '~/lib/studio/tasks';
import { AxisField } from '../shell/axis-field';
import { StudioFrame } from '../shell/studio-frame';
import { DemoFrame } from './demo-frame';

// Demo Studio (#9, design note section 2): Studio's frame, with the sandbox
// line in its header, over the demo's two tasks. Appearance has a field and
// a reset for each of the five axes and one reset for the whole demo;
// Preview has the frame's viewport, display mode, and motion. Each shows one
// frame of the sample with the selection. It reaches storage only through
// the browser backend its page hands it, and never a server. Nothing here
// publishes, saves a draft, or signs anyone in or out.

export interface DemoStudioProps {
  /** What the build offers on each axis, without generated schemes, which /sample can't render. */
  readonly catalog: AppearanceCatalog;
  readonly schemeModes?: SchemeModes;
  /** What the deployment's policy grants: Demo Studio's tasks, behind sandbox.view. */
  readonly policy: StudioPolicy;
  /** The browser backend, once the page has loaded it, or null until then. */
  readonly backend: DemoBackend | null;
  /** The backend's chunk didn't arrive, so the demo can't start. */
  readonly failed?: boolean;
  /** The task shown before the URL names one, as on the server. */
  readonly task?: TaskId;
}

/**
 * What a value the build doesn't offer means in the demo: what renders in its
 * place, and nothing about publishing, which the demo doesn't have.
 */
export function demoUnoffered(fallback: string) {
  return `This build doesn't offer it, so ${fallback} shows in its place.`;
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

function subscribeToHash(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
}

/** The task the URL names, by its fragment or a `task` query, as Owner Studio reads it: '' on the server. */
function useUrlTask(): string {
  return useSyncExternalStore(
    subscribeToHash,
    () =>
      window.location.hash.slice(1) ||
      (new URLSearchParams(window.location.search).get('task') ?? ''),
    () => '',
  );
}

export function DemoStudio({
  catalog,
  schemeModes,
  policy,
  backend,
  failed = false,
  task: initialTask,
}: DemoStudioProps) {
  const rules: SelectionRules = useMemo(() => ({ catalog, schemeModes }), [catalog, schemeModes]);
  const tasks = useMemo(() => tasksFor(policy.allowed, 'demo'), [policy.allowed]);
  const named = useUrlTask();
  const active: StudioTask | undefined =
    tasks.find((each) => each.id === named) ??
    tasks.find((each) => each.id === initialTask) ??
    tasks[0];
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

  const ready = backend !== null && selection !== null;
  const lines = ready ? demoStateLines(catalog, selection, backend.persistent()) : [];

  return (
    <StudioFrame
      status={<SandboxLine />}
      tasks={tasks}
      current={active?.id}
      noScript={
        <p className="studio-alert">
          Demo Studio needs JavaScript: it keeps your changes in this browser. Turn JavaScript on
          for this site, then reload the page, or <a href="/sample">see the sample without it</a>.
        </p>
      }
      state={
        <>
          {ready ? (
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
          ) : failed ? (
            <div className="studio-alert" role="alert">
              <p>
                Demo Studio couldn&apos;t load: part of it didn&apos;t arrive. Check your
                connection, then reload the page.
              </p>
              <button
                type="button"
                className="studio-button"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          ) : (
            <p className="studio-state__waiting" aria-busy="true">
              Loading the demo…
            </p>
          )}
          <p className="studio-state__notice" role="status">
            {notice}
          </p>
        </>
      }
    >
      {ready && active ? (
        <section className="studio-task" aria-labelledby="studio-task-heading">
          <h2 id="studio-task-heading" className="studio-task__heading">
            {active.label}
          </h2>
          {active.id === 'preview' ? (
            <PreviewTask
              catalog={catalog}
              selection={selection}
              rules={rules}
              viewportId={viewportId}
              motion={motion}
              systemReduces={systemReduces}
              onViewport={setViewportId}
              onMotion={setMotion}
              onChoose={(axis, value) => void choose(axis, value)}
            />
          ) : (
            <>
              <div className="studio-appearance__form">
                {catalog.axes.map(({ axis, label }) => (
                  <div key={axis} className="studio-appearance__axis">
                    <AxisField
                      id={`studio-appearance-${axis}`}
                      axis={axis}
                      label={label}
                      value={selection[axis]}
                      catalog={catalog}
                      unoffered={demoUnoffered}
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
              <SampleFrame
                catalog={catalog}
                selection={selection}
                rules={rules}
                viewportId={viewportId}
                reduced={motion === 'reduce' && !systemReduces}
              />
            </>
          )}
        </section>
      ) : null}
    </StudioFrame>
  );
}

function SampleFrame({
  catalog,
  selection,
  rules,
  viewportId,
  reduced,
}: {
  catalog: AppearanceCatalog;
  selection: DemoSelection;
  rules: SelectionRules;
  viewportId: Viewport['id'];
  reduced: boolean;
}) {
  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const name = optionNote(catalog, 'variant', selection.variant).option?.name ?? selection.variant;
  return (
    <DemoFrame
      src={frameSource(selection, rules, { reduceMotion: reduced })}
      title={`Demo sample, ${name}, ${viewportLabel(viewport)}`}
      viewport={viewport}
    />
  );
}

function PreviewTask({
  catalog,
  selection,
  rules,
  viewportId,
  motion,
  systemReduces,
  onViewport,
  onMotion,
  onChoose,
}: {
  catalog: AppearanceCatalog;
  selection: DemoSelection;
  rules: SelectionRules;
  viewportId: Viewport['id'];
  motion: 'system' | 'reduce';
  systemReduces: boolean;
  onViewport: (id: Viewport['id']) => void;
  onMotion: (motion: 'system' | 'reduce') => void;
  onChoose: (axis: CatalogAxis, value: string) => void;
}) {
  const label = catalog.axes.find(({ axis }) => axis === 'displayMode')?.label ?? 'Display mode';
  return (
    <>
      <div className="studio-preview__controls">
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor="studio-demo-viewport">
            Width (simulated)
          </label>
          <select
            id="studio-demo-viewport"
            className="studio-input"
            value={viewportId}
            onChange={(event) => onViewport(event.currentTarget.value as Viewport['id'])}
          >
            {VIEWPORTS.map((each) => (
              <option key={each.id} value={each.id}>
                {viewportLabel(each)}
              </option>
            ))}
          </select>
        </div>
        <div className="studio-preview__field">
          <AxisField
            id="studio-appearance-displayMode"
            axis="displayMode"
            label={label}
            value={selection.displayMode}
            catalog={catalog}
            unoffered={demoUnoffered}
            onChange={(value) => onChoose('displayMode', value)}
          />
        </div>
        <div className="studio-preview__field">
          <label className="studio-label" htmlFor="studio-demo-motion">
            Motion
          </label>
          <select
            id="studio-demo-motion"
            className="studio-input"
            value={systemReduces ? 'reduce' : motion}
            disabled={systemReduces}
            aria-describedby={systemReduces ? 'studio-demo-motion-note' : undefined}
            onChange={(event) => onMotion(event.currentTarget.value as 'system' | 'reduce')}
          >
            <option value="system">Follow system</option>
            <option value="reduce">Reduced</option>
          </select>
          {systemReduces ? (
            <p id="studio-demo-motion-note" className="studio-preview__note">
              Reduced by system
            </p>
          ) : null}
        </div>
      </div>
      <SampleFrame
        catalog={catalog}
        selection={selection}
        rules={rules}
        viewportId={viewportId}
        reduced={motion === 'reduce' && !systemReduces}
      />
    </>
  );
}
