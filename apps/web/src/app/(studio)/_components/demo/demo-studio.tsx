'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DemoBackend, LocalSources } from '~/lib/demo/browser-backend';
import { demoStateLines, SANDBOX_LINE } from '~/lib/demo/state-lines';
import {
  frameSource,
  studioLocation,
  type DemoSelection,
  type DemoSource,
  type SchemeModes,
  type SelectionRules,
} from '~/lib/demo/url-state';
import { REDUCED_MOTION, VIEWPORTS, viewportLabel, type Viewport } from '~/lib/preview-frame';
import { optionNote, type AppearanceCatalog, type CatalogAxis } from '~/lib/studio/appearance';
import type { StudioPolicy } from '~/lib/studio/backend';
import { tasksFor, type StudioTask, type TaskId } from '~/lib/studio/tasks';
import { AxisField } from '../shell/axis-field';
import { StudioFrame } from '../shell/studio-frame';
import { ContentTask } from './demo-content';
import { DemoFrame } from './demo-frame';
import { LocalFrameHost } from './demo-local-frame';

// Demo Studio (#9, design note sections 2 and 3): Studio's frame, with the
// sandbox line in its header, over the demo's three tasks. Appearance has a
// field and a reset for each of the five axes and one reset for the whole
// demo; Preview has the frame's viewport, display mode, and motion; Content
// imports a pair of documents and exports the current one. Each shows one
// frame with the selection: the sample at /sample; once the visitor asks for
// it and only when the server verified one, the read-only reference (#9),
// which nothing here can change; and otherwise, once the visitor has
// imported a pair, /preview/local with their documents, which only this tab
// holds and the URL never names. It reaches storage only through the browser
// backend its page hands it, and never a server. Nothing here publishes,
// saves a draft, or signs anyone in or out.

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
  /**
   * The read-only reference startup verified (#9): the name its portfolio
   * gives and its own selection. Null or absent, nothing offers or names one.
   */
  readonly reference?: DemoReferenceProps | null;
  /** What the frame shows as the backend arrives: the source its URL named. */
  readonly initialSource?: DemoSource;
}

export interface DemoReferenceProps {
  readonly name: string;
  readonly defaults: DemoSelection;
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
  reference = null,
  initialSource = 'sample',
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
  // The sample unless the page has a reference and the visitor asked for it.
  const [source, setSource] = useState<DemoSource>(reference ? initialSource : 'sample');
  const showing: DemoSource = reference ? source : 'sample';
  const [local, setLocal] = useState<LocalSources | null>(() => backend?.localSources() ?? null);
  const [viewportId, setViewportId] = useState<Viewport['id']>('desktop');
  const [motion, setMotion] = useState<'system' | 'reduce'>('system');
  const systemReduces = useSystemReducesMotion();

  // A backend the page hands over later brings its own selection, read as this renders.
  const [shown, setShown] = useState(backend);
  if (backend !== shown) {
    setShown(backend);
    setSelection(backend?.selection() ?? null);
    setSource(reference ? initialSource : 'sample');
    setLocal(backend?.localSources() ?? null);
  }

  // The URL follows the selection, in place, so Back leaves Studio.
  useEffect(() => {
    if (!selection) return;
    const { pathname, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      studioLocation(pathname, hash, selection, rules, showing),
    );
  }, [selection, rules, showing]);

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

  const ownerOf = () =>
    showing === 'reference' && reference ? `${reference.name}'s own` : "the sample's own";

  function resetAxis(axis: CatalogAxis) {
    if (!backend) return;
    const next = backend.resetAxis(axis);
    setSelection(next);
    setNotice(`${labelOf(axis)} is back to ${ownerOf()}, ${nameOf(axis, next[axis])}.`);
  }

  /** The frame on the reference, in its own published appearance, or back on the sample. */
  function show(next: DemoSource) {
    if (!backend || !reference) return;
    setSelection(backend.showSource(next === 'reference' ? reference.defaults : null));
    setSource(next);
    setNotice(
      next === 'reference'
        ? `Showing ${reference.name}'s published portfolio, read-only. Nothing here changes ${reference.name}'s site.`
        : local
          ? 'Showing your documents again.'
          : 'Showing the neutral sample again.',
    );
  }

  function resetAll() {
    if (!backend) return;
    setSource('sample');
    setSelection(backend.resetAll());
    setLocal(null);
    setNotice(
      "The demo is back to the sample's own appearance, and this browser holds none of it.",
    );
  }

  const ready = backend !== null && selection !== null;
  const lines = ready
    ? demoStateLines(
        catalog,
        selection,
        backend.persistent(),
        showing === 'reference' && reference ? reference : undefined,
      )
    : [];

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
          ) : null}
          {ready && reference ? (
            <div className="studio-source__actions">
              {showing === 'reference' ? (
                <button type="button" className="studio-button" onClick={() => show('sample')}>
                  {local ? 'Back to your documents' : 'Back to the neutral sample'}
                </button>
              ) : (
                <button type="button" className="studio-button" onClick={() => show('reference')}>
                  Show {reference.name}&apos;s published portfolio (read-only)
                </button>
              )}
            </div>
          ) : null}
          {ready ? null : failed ? (
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
              local={local}
              viewportId={viewportId}
              motion={motion}
              systemReduces={systemReduces}
              onViewport={setViewportId}
              onMotion={setMotion}
              onChoose={(axis, value) => void choose(axis, value)}
              source={showing}
              {...(reference ? { referenceName: reference.name } : {})}
            />
          ) : active.id === 'content' ? (
            <>
              <ContentTask
                backend={backend}
                onSource={(sources) => {
                  setLocal(sources);
                  // An import shows in the frame: off the reference, and on the visitor's own look.
                  if (sources && showing === 'reference') {
                    setSelection(backend.showSource(null));
                    setSource('sample');
                  } else {
                    setSelection(backend.selection());
                  }
                }}
              />
              <ContentFrame
                catalog={catalog}
                selection={selection}
                rules={rules}
                local={local}
                viewportId={viewportId}
                reduced={motion === 'reduce' && !systemReduces}
                source={showing}
                {...(reference ? { referenceName: reference.name } : {})}
              />
            </>
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
              <ContentFrame
                catalog={catalog}
                selection={selection}
                rules={rules}
                local={local}
                viewportId={viewportId}
                reduced={motion === 'reduce' && !systemReduces}
                source={showing}
                {...(reference ? { referenceName: reference.name } : {})}
              />
            </>
          )}
        </section>
      ) : null}
    </StudioFrame>
  );
}

/** The frame of what shows: the sample, or the read-only reference, by its name. */
interface FrameSource {
  readonly source: DemoSource;
  readonly referenceName?: string;
}

/**
 * The frame: the read-only reference while the visitor asked for it, else the
 * visitor's own documents in /preview/local while this tab holds them, else
 * the sample.
 */
function ContentFrame({
  catalog,
  selection,
  rules,
  local,
  viewportId,
  reduced,
  source,
  referenceName,
}: {
  catalog: AppearanceCatalog;
  selection: DemoSelection;
  rules: SelectionRules;
  local: LocalSources | null;
  viewportId: Viewport['id'];
  reduced: boolean;
} & FrameSource) {
  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const name = optionNote(catalog, 'variant', selection.variant).option?.name ?? selection.variant;
  const what =
    source === 'reference' && referenceName
      ? `${referenceName}'s published portfolio, read-only`
      : 'Demo sample';
  if (local && source !== 'reference') {
    return (
      <LocalFrameHost
        // A new frame for a change of motion, as /sample's query reloads its own.
        key={reduced ? 'reduced' : 'full'}
        sources={local}
        selection={selection}
        title={`Your documents, ${name}, ${viewportLabel(viewport)}`}
        viewport={viewport}
        reduced={reduced}
      />
    );
  }
  return (
    <DemoFrame
      src={frameSource(selection, rules, { reduceMotion: reduced, source })}
      title={`${what}, ${name}, ${viewportLabel(viewport)}`}
      viewport={viewport}
    />
  );
}

function PreviewTask({
  catalog,
  selection,
  rules,
  local,
  viewportId,
  motion,
  systemReduces,
  onViewport,
  onMotion,
  onChoose,
  source,
  referenceName,
}: {
  catalog: AppearanceCatalog;
  selection: DemoSelection;
  rules: SelectionRules;
  local: LocalSources | null;
  viewportId: Viewport['id'];
  motion: 'system' | 'reduce';
  systemReduces: boolean;
  onViewport: (id: Viewport['id']) => void;
  onMotion: (motion: 'system' | 'reduce') => void;
  onChoose: (axis: CatalogAxis, value: string) => void;
} & FrameSource) {
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
      <ContentFrame
        catalog={catalog}
        selection={selection}
        rules={rules}
        local={local}
        viewportId={viewportId}
        reduced={motion === 'reduce' && !systemReduces}
        source={source}
        {...(referenceName ? { referenceName } : {})}
      />
    </>
  );
}
