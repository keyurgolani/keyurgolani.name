'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DemoBackend, LocalSources } from '~/lib/demo/browser-backend';
import { changeLine, defaultMode, type CompareMode, type VaryAxis } from '~/lib/studio/compare';
import { demoStateLines, SANDBOX_LINE } from '~/lib/demo/state-lines';
import {
  frameDocument,
  frameKind,
  frameSource,
  HOME_PAGE,
  holdsMotion,
  modeFits,
  selectionSteps,
  sourceAfterImport,
  studioLocation,
  taskFragment,
  type DemoSelection,
  type DemoSource,
  type FramePage,
  type SchemeModes,
  type SelectionRules,
} from '~/lib/demo/url-state';
import { REDUCED_MOTION, VIEWPORTS, viewportLabel, type Viewport } from '~/lib/preview-frame';
import {
  inPlaceAppearance,
  optionNote,
  type AppearanceCatalog,
  type CatalogAxis,
} from '~/lib/studio/appearance';
import type { StudioPolicy } from '~/lib/studio/backend';
import { commit, historyOf, redo, undo, undoShortcut, type History } from '~/lib/studio/history';
import { offeredRecipes, surprise, withRecipe, type Recipe } from '~/lib/studio/recipes';
import { tasksFor, type StudioTask, type TaskId } from '~/lib/studio/tasks';
import { StudioFrame } from '../shell/studio-frame';
import { Icon } from '../split/icons';
import {
  AXIS_LINES,
  AXIS_TABS,
  AxisMini,
  AxisPicker,
  AxisTools,
  readyCount,
  RecipeStrip,
  currentSub,
  stepOption,
} from '../split/pickers';
import {
  DeviceWidths,
  HistoryButtons,
  MenuButton,
  MenuStageTools,
  OpenFullPage,
  ScaleBadge,
  Segmented,
  StudioMark,
  StudioSplit,
  StudioSplitPending,
  usePlatform,
  useSettled,
  type SplitSection,
} from '../split/studio-split';
import { CompareBar, CompareFlip, CompareGrid, CompareSide, CompareWipe } from '../split/compare';
import { ContentTask } from './demo-content';
import { DemoFrame, plateMotion } from './demo-frame';
import { LocalFrameHost } from './demo-local-frame';
import {
  frameGate,
  frameRequestedAfter,
  NARROW_STUDIO,
  type FrameEvent,
  type FrameGate,
} from './frame-gate';

// Demo Studio (#9, design note sections 2 and 3): Studio's frame, with the
// sandbox line in its header, over the demo's two tasks. Appearance is the
// viewing booth (the Studio mockup, owner direction, 2026-10-25): recipes,
// then a picker with previous, next, Keep, and Reset for each of the five
// axes in the rail; the source, undo and redo, and Share in the top bar; the
// frame on a neutral grey stage under its device widths, scale, and motion;
// Reset demo, Export setup, the sandbox line, and the status in the bottom
// bar. Content is the same split over the same stage (DEM-1): its rail holds
// Export setup and the import of a pair of documents, under the same look bar,
// and every way to it, the bottom bar's Export setup, the phone menu's, and the
// Tasks menu, stays in the split. Each shows one frame with the
// selection: the sample at /sample; once the visitor asks for
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
  /** The sample's case study the page switch opens, by its slug, or null when it has none. */
  readonly caseStudy?: string | null;
  /**
   * Whether the frame may load its document from the start, as it may once
   * its gate let it (frame-gate.ts). The page starts without: the frame
   * waits until its stage is near the window, or at a phone's width until asked.
   */
  readonly initialFrameRequested?: boolean;
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

function subscribeToWidth(change: () => void) {
  const query = window.matchMedia(NARROW_STUDIO);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether Studio is at a phone's width (frame-gate.ts): false on the server. */
function useNarrowStudio(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(NARROW_STUDIO).matches,
    () => false,
  );
}

/**
 * The frame's viewport: the one the visitor picked, or until they pick one,
 * the mobile preset at a phone's width and the desktop preset otherwise.
 */
export function frameViewportId(picked: Viewport['id'] | null, narrow: boolean): Viewport['id'] {
  return picked ?? (narrow ? 'mobile' : 'desktop');
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
  initialFrameRequested = false,
  caseStudy = null,
}: DemoStudioProps) {
  const rules: SelectionRules = useMemo(() => ({ catalog, schemeModes }), [catalog, schemeModes]);
  const tasks = useMemo(() => tasksFor(policy.allowed, 'demo'), [policy.allowed]);
  const recipes = useMemo(
    () =>
      offeredRecipes(catalog, (selection) =>
        modeFits(schemeModes, selection.colorScheme, selection.displayMode),
      ),
    [catalog, schemeModes],
  );
  const named = useUrlTask();
  const active: StudioTask | undefined =
    tasks.find((each) => each.id === named) ??
    tasks.find((each) => each.id === initialTask) ??
    tasks[0];
  const [selection, setSelection] = useState<DemoSelection | null>(
    () => backend?.selection() ?? null,
  );
  // Undo and redo over the visitor's picks, recipes, and resets; a source change starts afresh.
  const [history, setHistory] = useState<History<DemoSelection> | null>(() => {
    const first = backend?.selection();
    return first ? historyOf(first) : null;
  });
  // The axes a recipe or Surprise me leaves alone.
  const [kept, setKept] = useState<ReadonlySet<CatalogAxis>>(() => new Set());
  // Each Reset demo, so the Content panel starts again with no report of what it cleared.
  const [resets, setResets] = useState(0);
  const [notice, setNotice] = useState('');
  const shortcut = undoShortcut(usePlatform());
  // The sample unless the page has a reference and the visitor asked for it.
  const [source, setSource] = useState<DemoSource>(reference ? initialSource : 'sample');
  const showing: DemoSource = reference ? source : 'sample';
  const [local, setLocal] = useState<LocalSources | null>(() => backend?.localSources() ?? null);
  const narrow = useNarrowStudio();
  const [pickedViewport, setViewportId] = useState<Viewport['id'] | null>(null);
  const viewportId = frameViewportId(pickedViewport, narrow);
  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const [motion, setMotion] = useState<'system' | 'reduce'>('system');
  const systemReduces = useSystemReducesMotion();
  // The frame's scale, which the bar's badge shows and the bar over the frame spans.
  const [scale, setScale] = useState(1);
  // Whether the frame was let load its document (frame-gate.ts), kept across tasks.
  // A tab that already holds an import has shown the visitor a preview: no poster after it.
  const [frameRequested, setFrameRequested] = useState(
    () => initialFrameRequested || Boolean(backend?.localSources()),
  );
  const requestFrame = useCallback(() => setFrameRequested(true), []);
  const frameAfter = (event: FrameEvent) =>
    setFrameRequested((requested) => frameRequestedAfter(requested, event));
  const pickViewport = (id: Viewport['id']) => {
    setViewportId(id);
    frameAfter('viewport');
  };
  const load: FrameLoad = {
    gate: frameGate(narrow),
    requested: frameRequested,
    onRequest: requestFrame,
    onAnnounce: setNotice,
  };
  // A task change starts the status afresh: what it said of the last task's changes is stale
  // on the next, so it never stays as the next task's line (DEM-1).
  const [taskWas, setTaskWas] = useState(active?.id);
  if (taskWas !== active?.id) {
    setTaskWas(active?.id);
    setNotice('');
  }
  // The bottom bar's status line follows the live region once a run of changes settles.
  const status = useSettled(notice, STATUS_MS);

  // Compare (the Studio mockup's compareMode): A pinned as it started, B the rail's.
  const [compare, setCompare] = useState<CompareState | null>(null);
  // The page the frame shows (the mockup's page switch), keeping the selection.
  const [pageKind, setPageKind] = useState<FramePage['kind']>('home');
  // No preview on intent here (the round 4 design review, P0-2): until the demo's frame
  // takes a pack in place, a pointer resting on an option would only say "Previewing"
  // over a frame that doesn't show it. A pick commits on click, and Owner Studio keeps its hover.

  // A backend the page hands over later brings its own selection, read as this renders.
  const [shown, setShown] = useState(backend);
  if (backend !== shown) {
    setShown(backend);
    const first = backend?.selection() ?? null;
    setSelection(first);
    setHistory(first ? historyOf(first) : null);
    setSource(reference ? initialSource : 'sample');
    setLocal(backend?.localSources() ?? null);
    if (backend?.localSources()) frameAfter('imported');
  }

  // The URL follows the selection, in place, so Back leaves Studio.
  useEffect(() => {
    if (!selection) return;
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      studioLocation(pathname, taskFragment(search, hash), selection, rules, showing),
    );
  }, [selection, rules, showing]);

  const labelOf = (axis: CatalogAxis) =>
    catalog.axes.find((each) => each.axis === axis)?.label ?? axis;
  const nameOf = (axis: CatalogAxis, value: string) =>
    optionNote(catalog, axis, value).option?.name ?? value;
  const undoHint = `Undo with ${shortcut}.`;

  /**
   * Moves the demo to `next`, as one edit batch the backend checks step by
   * step: the history takes it as an entry, or, for undo and redo, as `moved`.
   */
  async function moveTo(
    next: DemoSelection,
    {
      group = null,
      said,
      moved,
    }: {
      group?: string | null;
      said: string;
      moved?: History<DemoSelection>;
    },
  ): Promise<boolean> {
    if (!backend || !selection) return false;
    // A change to what the frame shows is asking to see it.
    frameAfter('choose');
    const steps = selectionSteps(rules, backend.selection(), next);
    if (steps.length === 0) return false;
    const working = await backend.workingDraft();
    if (working.kind !== 'read' || !working.value) return false;
    const result = await backend.applyEdits({
      draftId: working.value.draftId,
      expectedVersion: working.value.version,
      edits: steps.map(({ axis, value }) => ({
        document: 'site',
        pointer: `/appearance/${axis}`,
        op: 'set',
        value,
      })),
    });
    if (result.kind === 'saved') {
      const now = backend.selection();
      setSelection(now);
      setHistory(
        (before) => moved ?? commit(before ?? historyOf(now), now, { group, now: Date.now() }),
      );
      setNotice(said);
      return true;
    }
    if (result.kind === 'failed') setNotice(`Nothing changed. ${result.message}`);
    return false;
  }

  // A change builds on the backend's selection, not the render's: two quick picks
  // before a render each keep the other's axis.
  function choose(axis: CatalogAxis, value: string) {
    if (!selection || !backend) return;
    void moveTo(
      { ...backend.selection(), [axis]: value },
      { group: axis, said: `${labelOf(axis)} is now ${nameOf(axis, value)}. ${undoHint}` },
    );
  }

  function applyRecipe(recipe: Recipe, surprised = false) {
    if (!selection || !backend) return;
    void moveTo(withRecipe(backend.selection(), recipe, kept), {
      said: `${surprised ? 'Surprise: ' : ''}${recipe.name}${kept.size > 0 ? ', keeping your pinned axes' : ''}. ${undoHint}`,
    });
  }

  function surpriseMe() {
    if (!selection) return;
    const picked = surprise(recipes, selection, kept, Math.random());
    if (picked) applyRecipe(picked, true);
    else setNotice('Every recipe matches what you have, with your pinned axes kept.');
  }

  function step(direction: 'undo' | 'redo') {
    if (!history) return;
    const moved = direction === 'undo' ? undo(history) : redo(history);
    if (moved === history) return;
    void moveTo(moved.present, {
      moved,
      said: direction === 'undo' ? 'Undone.' : 'Redone.',
    });
  }

  const ownerOf = () =>
    showing === 'reference' && reference ? `${reference.name}'s own` : "the sample's own";

  function resetAxis(axis: CatalogAxis) {
    if (!backend) return;
    const next = backend.resetAxis(axis);
    setSelection(next);
    setHistory((before) => commit(before ?? historyOf(next), next, { now: Date.now() }));
    setNotice(`${labelOf(axis)} is back to ${ownerOf()}, ${nameOf(axis, next[axis])}. ${undoHint}`);
  }

  /** The frame on the reference, in its own published appearance, or back on the sample. */
  function show(next: DemoSource) {
    if (!backend || !reference) return;
    const now = backend.showSource(next === 'reference' ? reference.defaults : null);
    setSelection(now);
    setHistory(historyOf(now));
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
    const now = backend.resetAll();
    setSelection(now);
    setHistory(historyOf(now));
    setKept(new Set());
    setLocal(null);
    setResets((count) => count + 1);
    setNotice(
      "The demo is back to the sample's own appearance, and this browser holds none of it.",
    );
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice('Link copied. It opens the demo with this look.');
    } catch {
      setNotice("Couldn't copy the link. Copy it from the address bar: it carries this look.");
    }
  }

  function startCompare(mode: CompareMode | null = null, vary: VaryAxis = 'variant') {
    if (!selection) return;
    // Compare, its Grid too, asks to see its frames: at a phone's width they load with no tap.
    frameAfter('compare');
    setCompare({ a: selection, mode, vary, wipe: 50, side: 'b' });
    setNotice(
      mode === 'grid'
        ? 'Comparing: your look is pinned as A, beside its neighbours.'
        : "Comparing: your look is pinned as A. You're editing B.",
    );
  }

  function stopCompare() {
    setCompare(null);
    setNotice('Stopped comparing.');
  }

  function swapCompare() {
    if (!compare || !selection) return;
    const was = selection;
    void moveTo(compare.a, { said: "Swapped A and B. You're editing what was A." }).then(
      (moved) => {
        if (moved) setCompare((now) => (now ? { ...now, a: was } : now));
      },
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

  // Both tasks are the workspace: Content's rail is its own, over the same stage. It is from
  // the first paint, the backend still loading, so the page has the box the split takes once
  // it mounts and nothing moves as it does (CLS 0.201 at 390 when the shell's header and
  // navigation gave way to it).
  const workspace = active?.id === 'appearance' || active?.id === 'content';
  const content = active?.id === 'content';
  const stateList = (
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
  );
  const reduced = motion === 'reduce' && !systemReduces;
  // The case study and the Work section are the sample's own: the reference and an import
  // show their home.
  const pageOffered = (kind: FramePage['kind']) =>
    kind === 'home' || (showing === 'sample' && !local && (kind === 'work' || caseStudy !== null));
  const page: FramePage =
    !pageOffered(pageKind) || pageKind === 'home'
      ? HOME_PAGE
      : pageKind === 'case' && caseStudy
        ? { kind: 'case', slug: caseStudy }
        : { kind: 'work' };
  const frameOf = (
    shown: DemoSelection | null,
    fit: 'width' | 'contain' | 'fill',
    side?: 'A' | 'B',
  ) =>
    ready && shown ? (
      <ContentFrame
        catalog={catalog}
        selection={shown}
        rules={rules}
        local={local}
        viewportId={viewportId}
        reduced={reduced}
        load={load}
        source={showing}
        fit={fit}
        page={page}
        {...(side ? { side } : {})}
        {...(side === 'A' ? {} : { onScale: setScale })}
        {...(reference ? { referenceName: reference.name } : {})}
      />
    ) : null;
  const frame = (fit: 'width' | 'contain' | 'fill') => frameOf(selection, fit);
  // A Grid of 4 plate's live frame (round 5, P0-2b): its selection on the same load path as a
  // pick, filling the plate's width from the top as Side by side does (S1), static unless it
  // holds the grid's one heavy slot.
  const plateFrame = (shown: DemoSelection, heavy: boolean, plate: string) =>
    ready ? (
      <ContentFrame
        catalog={catalog}
        selection={shown}
        plate={plate}
        rules={rules}
        local={local}
        viewportId={viewportId}
        reduced={reduced}
        liveMotion={heavy}
        load={load}
        source={showing}
        // The whole viewport, 1440 by 900 at the desktop width, scaled into a plate its shape (DEM-3).
        fit="contain"
        page={page}
        {...(reference ? { referenceName: reference.name } : {})}
      />
    ) : null;
  // The frame's document in a tab of its own: the bar's button, or the phone's menu.
  const fullPage =
    ready && selection
      ? frameSource(selection, rules, { reduceMotion: reduced, source: showing, page })
      : '/sample';
  const fullPageName = local ? 'Open the sample in a new tab' : 'Open full page';
  const compareMode: CompareMode | null =
    compare && selection ? (compare.mode ?? defaultMode(compare.a, selection)) : null;
  const compareStage =
    compare && selection && compareMode ? (
      <div className="studio-compare__room">
        <CompareBar
          catalog={catalog}
          a={compare.a}
          b={selection}
          mode={compareMode}
          onMode={(mode) => setCompare((now) => (now ? { ...now, mode } : now))}
          readable={viewportId === 'tablet'}
          onReadable={() => pickViewport(viewportId === 'tablet' ? 'desktop' : 'tablet')}
          onSwap={swapCompare}
          onStop={stopCompare}
          compact={narrow}
          vary={compare.vary}
        />
        {narrow ? (
          <CompareFlip
            side={compare.side}
            onSide={(side) => setCompare((now) => (now ? { ...now, side } : now))}
            frameA={frameOf(compare.a, 'fill', 'A')}
            frameB={frameOf(selection, 'fill', 'B')}
          />
        ) : compareMode === 'grid' ? (
          <CompareGrid
            catalog={catalog}
            a={compare.a}
            b={selection}
            vary={compare.vary}
            onVary={(vary) => setCompare((now) => (now ? { ...now, vary } : now))}
            onUse={(next) =>
              void moveTo(next, {
                // B takes the plate's whole selection, so the notice names every axis that moves (M2).
                said: `B is now ${changeLine(catalog, selection, next) ?? nameOf(compare.vary, next[compare.vary])}. ${undoHint}`,
              })
            }
            onPin={(next) => {
              setCompare((now) => (now ? { ...now, a: next } : now));
              setNotice(`Pinned ${nameOf(compare.vary, next[compare.vary])} as A.`);
            }}
            live={plateFrame}
          />
        ) : compareMode === 'wipe' ? (
          <CompareWipe
            frameA={frameOf(compare.a, 'contain', 'A')}
            frameB={frameOf(selection, 'contain', 'B')}
            at={compare.wipe}
            onAt={(wipe) => setCompare((now) => (now ? { ...now, wipe } : now))}
          />
        ) : (
          // Each pane's device is as tall as the pane at its scale, so both frames fill the stage.
          <CompareSide
            frameA={frameOf(compare.a, 'fill', 'A')}
            frameB={frameOf(selection, 'fill', 'B')}
            onBackToA={() => void moveTo(compare.a, { said: `B is back to A's look. ${undoHint}` })}
          />
        )}
      </div>
    ) : null;

  // The rail: recipes first, then the five axes, heaviest first.
  const axisSection = (axis: CatalogAxis): SplitSection => {
    const label = labelOf(axis);
    const noun = label.toLowerCase();
    const options = catalog.axes.find((entry) => entry.axis === axis)?.options ?? [];
    const value = selection![axis];
    const step = (direction: -1 | 1) => {
      const next = stepOption(options, value, direction);
      if (next) choose(axis, next);
    };
    return {
      id: axis,
      label,
      tab: AXIS_TABS[axis],
      count: axis === 'displayMode' ? undefined : readyCount(options),
      // Display mode is pinned open at the rail's foot on wide screens (the round 5b mockups).
      pinned: axis === 'displayMode',
      description: AXIS_LINES[axis],
      look: {
        specimen: <AxisMini axis={axis} catalog={catalog} selection={selection!} />,
        name: nameOf(axis, value),
        ...(axis === 'displayMode' ? {} : { step }),
      },
      current: {
        name: nameOf(axis, value),
        ...(currentSub(catalog, axis, value) ? { sub: currentSub(catalog, axis, value)! } : {}),
      },
      tools: (
        <AxisTools
          noun={noun}
          {...(axis === 'displayMode' ? {} : { onStep: step })}
          kept={kept.has(axis)}
          onKeep={() =>
            setKept((now) => {
              const next = new Set(now);
              if (next.has(axis)) next.delete(axis);
              else next.add(axis);
              return next;
            })
          }
          onReset={() => resetAxis(axis)}
          canReset={backend !== null && value !== backend.defaults()[axis]}
        />
      ),
      content: (
        <div className="studio-appearance__axis" data-axis={axis}>
          <AxisPicker
            axis={axis}
            catalog={catalog}
            label={label}
            value={value}
            selection={selection!}
            unoffered={demoUnoffered}
            onChange={(next) => choose(axis, next)}
            {...(axis === 'variant' ? { onCompare: () => startCompare('grid', 'variant') } : {})}
          />
          {axis === 'variant' ? (
            <button
              type="button"
              className="studio-textbutton studio-compare-phone"
              onClick={() => startCompare('grid', 'variant')}
            >
              Compare compositions
            </button>
          ) : null}
        </div>
      ),
    };
  };
  const stripId = 'studio-recipes';
  // The recipes first, as the round 5b index and the phone's tabs have them, then the axes.
  const sections: SplitSection[] = ready
    ? [
        ...(recipes.length > 0
          ? [
              {
                id: 'recipes',
                label: 'Start from a recipe',
                tab: 'Recipes',
                count: recipes.length,
                // An action, not a value (P2-1): a recipe applies at once and stays no state,
                // so the row says what it does and has no previous and next, here or on a phone.
                description: 'A recipe sets all five at once. Kept axes stay as they are.',
                action: { icon: 'recipe', line: 'Sets all five at once' },
                content: (
                  <RecipeStrip
                    id={stripId}
                    recipes={recipes}
                    catalog={catalog}
                    onApply={(recipe) => applyRecipe(recipe)}
                    onSurprise={surpriseMe}
                  />
                ),
              } satisfies SplitSection,
            ]
          : []),
        ...RAIL_AXES.filter((axis) => catalog.axes.some((entry) => entry.axis === axis)).map(
          axisSection,
        ),
      ]
    : [];
  const pageSwitch = (
    <Segmented
      label="Page"
      caption="Page"
      className="studio-split__page"
      value={page.kind}
      options={[
        { id: 'home', label: 'Home' },
        { id: 'work', label: 'Work', disabled: !pageOffered('work') },
        {
          id: 'case',
          label: 'Case study',
          disabled: !pageOffered('case'),
          reason: 'No case study in this portfolio',
        },
      ]}
      onChange={(next) => setPageKind(next as FramePage['kind'])}
    />
  );
  const historyButtons = history ? (
    <HistoryButtons
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      onUndo={() => step('undo')}
      onRedo={() => step('redo')}
      shortcut={shortcut}
    />
  ) : null;
  const sourceName =
    showing === 'reference' && reference
      ? { name: reference.name, kind: 'Published, read-only' }
      : local
        ? { name: 'Your documents', kind: 'Imported' }
        : { name: 'Sample portfolio', kind: 'Neutral sample' };
  const sourceMenu = (
    <MenuButton
      className="studio-source-menu"
      label={
        // Its name is what it shows, then what it is.
        <>
          <Icon name="doc" />
          <span className="studio-source-menu__name">{sourceName.name}</span>{' '}
          <span className="studio-source-menu__kind">{sourceName.kind}</span>
          <span className="studio-visually-hidden">, the content source</span>
        </>
      }
    >
      {(close) => (
        <>
          {reference ? (
            <div className="studio-menu__group" role="group" aria-labelledby="studio-source-show">
              <span id="studio-source-show" className="studio-menu__heading">
                Show
              </span>
              <button
                type="button"
                className="studio-menu__item"
                aria-pressed={showing !== 'reference'}
                onClick={() => {
                  close();
                  if (showing === 'reference') show('sample');
                }}
              >
                {showing === 'reference'
                  ? local
                    ? 'Back to your documents'
                    : 'Back to the neutral sample'
                  : local
                    ? 'Your documents'
                    : 'The neutral sample'}
              </button>
              <button
                type="button"
                className="studio-menu__item"
                aria-pressed={showing === 'reference'}
                onClick={() => {
                  close();
                  if (showing !== 'reference') show('reference');
                }}
              >
                {showing === 'reference'
                  ? `${reference.name}'s published portfolio (read-only)`
                  : `Show ${reference.name}'s published portfolio (read-only)`}
              </button>
            </div>
          ) : null}
          <nav className="studio-menu__group" aria-label="Studio tasks">
            <span className="studio-menu__heading" aria-hidden="true">
              Tasks
            </span>
            {tasks.map((each) => (
              <a
                key={each.id}
                href={`#${each.id}`}
                className="studio-menu__item studio-shell__task"
                aria-current={each.id === active?.id ? 'page' : undefined}
                aria-describedby={each.id === 'content' ? 'studio-source-content-hint' : undefined}
                onClick={close}
              >
                {each.label}
              </a>
            ))}
            <span id="studio-source-content-hint" className="studio-menu__hint">
              Import your own pair, or export this setup
            </span>
          </nav>
          {/* What this setup is and where it came from, once, behind one disclosure (P2-8). */}
          <details className="studio-menu__about">
            <summary className="studio-menu__item">About this setup</summary>
            <div className="studio-menu__state">{stateList}</div>
          </details>
        </>
      )}
    </MenuButton>
  );
  const shareButton = (
    <>
      <button
        type="button"
        className="studio-barbutton"
        aria-pressed={compare !== null}
        onClick={() => (compare ? stopCompare() : startCompare())}
      >
        <Icon name="compare" />
        Compare
      </button>
      <button type="button" className="studio-barbutton" onClick={() => void share()}>
        <Icon name="share" />
        Share
      </button>
    </>
  );

  // What the demo says until its backend arrives, or that it couldn't load: in the state
  // section, or where the workspace's stage goes while the workspace waits for it.
  const loading = failed ? (
    <div className="studio-alert" role="alert">
      <p>
        Demo Studio couldn&apos;t load: part of it didn&apos;t arrive. Check your connection, then
        reload the page.
      </p>
      <button type="button" className="studio-button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  ) : (
    <p className="studio-state__waiting" aria-busy="true">
      Loading the demo…
    </p>
  );
  // The name leads home, to Appearance: in the page first, so a skip link's first stop is one a
  // visitor can see and reach (WCAG 2.4.1).
  const brand = <StudioMark tag="Demo" home={{ href: '#appearance', current: !content }} />;

  return (
    <StudioFrame
      status={<SandboxLine />}
      tasks={tasks}
      current={active?.id}
      workspace={workspace}
      noScript={
        <p className="studio-alert">
          Demo Studio needs JavaScript: it keeps your changes in this browser. Turn JavaScript on
          for this site, then reload the page, or <a href="/sample">see the sample without it</a>.
        </p>
      }
      state={
        <>
          {ready && !workspace ? stateList : null}
          {ready || workspace ? null : loading}
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
          <StudioSplit
            brand={brand}
            bar={
              <>
                {sourceMenu}
                <span className="studio-split__divider" aria-hidden="true" />
                {historyButtons}
              </>
            }
            barEnd={shareButton}
            phoneBar={
              <>
                {historyButtons}
                <MenuButton
                  className="studio-more"
                  icon="more"
                  name="More: content, share, export, reset"
                  label={null}
                >
                  {(close) => (
                    <>
                      <nav className="studio-menu__group" aria-label="Studio tasks">
                        {tasks.map((each) => (
                          <a
                            key={each.id}
                            href={`#${each.id}`}
                            className="studio-menu__item studio-shell__task"
                            aria-current={each.id === active.id ? 'page' : undefined}
                            onClick={close}
                          >
                            {each.label}
                          </a>
                        ))}
                      </nav>
                      <div className="studio-menu__group">
                        <button
                          type="button"
                          className="studio-menu__item"
                          aria-pressed={compare !== null}
                          onClick={() => {
                            close();
                            if (compare) stopCompare();
                            else startCompare();
                          }}
                        >
                          Compare A and B
                        </button>
                        <button
                          type="button"
                          className="studio-menu__item"
                          onClick={() => {
                            close();
                            void share();
                          }}
                        >
                          Share
                        </button>
                        {/* Open full page and the scale leave the phone's single stage row for this menu. */}
                        {history ? (
                          <MenuStageTools
                            canRedo={history.future.length > 0}
                            onRedo={() => step('redo')}
                            close={close}
                          >
                            <DeviceWidths value={viewportId} onChange={pickViewport} />
                            {pageSwitch}
                          </MenuStageTools>
                        ) : null}
                        <p className="studio-menu__note">Shown at {Math.round(scale * 100)}%</p>
                        <a
                          className="studio-menu__item"
                          href={fullPage}
                          target="_blank"
                          rel="noopener"
                          onClick={close}
                        >
                          {fullPageName}
                        </a>
                        <a
                          className="studio-menu__item"
                          href="#content"
                          aria-current={content ? 'page' : undefined}
                          onClick={close}
                        >
                          Export setup
                        </a>
                        <button
                          type="button"
                          className="studio-menu__item"
                          onClick={() => {
                            close();
                            resetAll();
                          }}
                        >
                          Reset demo
                        </button>
                      </div>
                      <div className="studio-menu__state">{stateList}</div>
                    </>
                  )}
                </MenuButton>
              </>
            }
            previewHeading="Preview"
            {...(compare
              ? {
                  railTop: (
                    <p className="studio-compare__banner">
                      You&apos;re editing B. A stays pinned as it was.
                    </p>
                  ),
                }
              : {})}
            sections={sections}
            {...(content
              ? {
                  railLabel: 'Export and import',
                  railContent: (
                    <ContentTask
                      // Reset demo starts the panel again, with no report of what it cleared.
                      key={resets}
                      backend={backend}
                      onSource={(sources) => {
                        setLocal(sources);
                        // The visitor has seen their documents in a frame: clearing them brings no poster.
                        frameAfter(sources !== null ? 'imported' : 'cleared');
                        // An import shows in the frame: off the reference, and on the visitor's own look.
                        const next = sourceAfterImport(showing, sources !== null);
                        if (next !== showing) {
                          const now = backend.showSource(null);
                          setSelection(now);
                          setHistory(historyOf(now));
                          setSource(next);
                        } else {
                          setSelection(backend.selection());
                        }
                      }}
                    />
                  ),
                  // A look row opens its axis back in Appearance.
                  onLookOpen: () => {
                    window.location.hash = 'appearance';
                  },
                }
              : {})}
            // The sheet opens on the composition, the recipes a tab before it.
            firstTab="variant"
            history={{ undo: () => step('undo'), redo: () => step('redo') }}
            // The demo's bottom bar (#9): Reset demo, and Export setup, which the Content task
            // holds, or from there the way back to Appearance.
            railBar={
              <>
                <button
                  type="button"
                  className="studio-barbutton studio-barbutton--quiet"
                  onClick={resetAll}
                >
                  Reset demo
                </button>
                {content ? (
                  <a className="studio-barbutton" href="#appearance">
                    <Icon name="chevL" />
                    Back to Appearance
                  </a>
                ) : (
                  <a className="studio-barbutton" href="#content">
                    <Icon name="download" />
                    Export setup
                  </a>
                )}
              </>
            }
            status={
              <>
                <p className="studio-split__sandbox">{SANDBOX_LINE}</p>
                {/* The live region is the shell's; this line shows what it said, once settled. */}
                <p className="studio-split__status" aria-hidden="true">
                  {status}
                </p>
              </>
            }
            sheetFoot={<p className="studio-split__sandbox">{SANDBOX_LINE}</p>}
            {...(compare ? {} : { frameWidth: viewport.width * scale })}
            toolbar={{
              start: (
                <>
                  <DeviceWidths value={viewportId} onChange={pickViewport} />
                  <ScaleBadge scale={scale} />
                </>
              ),
              center: pageSwitch,
              end: (
                <>
                  <Segmented
                    label={systemReduces ? 'Motion, reduced by system' : 'Motion'}
                    caption="Motion"
                    className="studio-split__motion"
                    value={systemReduces ? 'reduce' : motion}
                    disabled={systemReduces}
                    reason="Your system asks for reduced motion"
                    options={[
                      { id: 'system', label: 'Follow system' },
                      { id: 'reduce', label: 'Reduced' },
                    ]}
                    onChange={(value) => setMotion(value as 'system' | 'reduce')}
                  />
                  <OpenFullPage href={fullPage} label={fullPageName} />
                </>
              ),
            }}
            stage={compareStage ?? frame(narrow ? 'fill' : 'contain')}
          />
        </section>
      ) : workspace && active ? (
        // The same section and box as the split's, its name and its waiting line in them.
        <section className="studio-task" aria-labelledby="studio-task-heading">
          <h2 id="studio-task-heading" className="studio-task__heading">
            {active.label}
          </h2>
          <StudioSplitPending brand={brand}>{loading}</StudioSplitPending>
        </section>
      ) : null}
    </StudioFrame>
  );
}

/** How long the bottom bar's status line waits for a run of changes to settle. */
const STATUS_MS = 500;

/** Compare's state: A, the layout the visitor picked (or null, the default), the grid's axis, the wipe, the phone's side. */
interface CompareState {
  readonly a: DemoSelection;
  readonly mode: CompareMode | null;
  readonly vary: VaryAxis;
  readonly wipe: number;
  readonly side: 'a' | 'b';
}

/** The rail's axes, heaviest first, as the design dossier orders them, the display mode last. */
const RAIL_AXES: readonly CatalogAxis[] = Object.freeze([
  'variant',
  'colorScheme',
  'typography',
  'designLanguage',
  'displayMode',
]);

/** The frame of what shows: the sample, or the read-only reference, by its name. */
interface FrameSource {
  readonly source: DemoSource;
  readonly referenceName?: string;
}

/** When the sample's or the reference's frame loads its first document (frame-gate.ts). */
interface FrameLoad {
  readonly gate: FrameGate;
  readonly requested: boolean;
  readonly onRequest: () => void;
  readonly onAnnounce: (text: string) => void;
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
  load,
  source,
  referenceName,
  fit = 'width',
  onScale,
  page = HOME_PAGE,
  side,
  plate,
  liveMotion,
}: {
  catalog: AppearanceCatalog;
  selection: DemoSelection;
  rules: SelectionRules;
  local: LocalSources | null;
  viewportId: Viewport['id'];
  reduced: boolean;
  load: FrameLoad;
  /** How the frame fits its room: its width alone, contained in the workspace's stage, or across it at a phone's width. */
  fit?: 'width' | 'contain' | 'fill';
  onScale?: (scale: number) => void;
  /** The page it shows: Home, its Work section, or a case study. */
  page?: FramePage;
  /** Compare's side, which its name starts with, so two frames never share one. */
  side?: 'A' | 'B';
  /** A Grid of 4 plate's name, its pick on the varied axis, which its name starts with likewise. */
  plate?: string;
  /**
   * A Grid of 4 plate's motion, which moves with the heavy slot: whether it holds the slot. Its
   * document loads held, as a plate at rest is, and takes full motion in place over its channel
   * while it holds the slot, unless `reduced` or the reader's own setting reduces it; so taking
   * and giving up the slot loads no document (kgn-e/compare-perf). Absent, `reduced` alone.
   */
  liveMotion?: boolean;
} & FrameSource) {
  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const name = optionNote(catalog, 'variant', selection.variant).option?.name ?? selection.variant;
  // The sample and the reference take a scheme, type, language, or display mode over their
  // channel, in the same document, at once (DEM-2), and load again for any other change, once a
  // run of picks settles. The local frame takes every change over its channel.
  // A frame that does load again for a scheme, type, or language, having no channel open, loads
  // held still, so it never replays its opening (DEM-2's stopgap); a composition's change plays
  // it again. Derived as it renders, so a pick loads one source, not one and then another.
  const [shownAs, setShownAs] = useState<{ selection: DemoSelection; held: boolean }>({
    selection,
    held: false,
  });
  let held = shownAs.held;
  if (shownAs.selection !== selection) {
    held = holdsMotion(shownAs.selection, selection, shownAs.held);
    setShownAs({ selection, held });
  }
  // A plate's document is the held one whether or not it holds the heavy slot: the slot's motion
  // goes over the channel.
  const plateHeld = liveMotion !== undefined;
  const src = frameSource(selection, rules, {
    reduceMotion: reduced || plateHeld,
    holdMotion: held,
    source,
    page,
  });
  const documentKey = frameDocument(selection, {
    reduceMotion: reduced || plateHeld,
    source,
    page,
  });
  const motion = liveMotion === undefined ? null : plateMotion(liveMotion, reduced);
  const appearance = useMemo(() => inPlaceAppearance(catalog, selection), [catalog, selection]);
  const lead = side ? `${side}, ` : plate ? `${plate}, ` : '';
  const what = `${side ? `${side}, ${side === 'A' ? 'pinned' : 'editing'}: ` : plate ? `${plate}: ` : ''}${
    source === 'reference' && referenceName
      ? `${referenceName}'s published portfolio, read-only`
      : 'Demo sample'
  }`;
  if (local && frameKind(source, local !== null) === 'local') {
    return (
      <LocalFrameHost
        // A new frame for a change of motion, as /sample's query reloads its own: a plate's local
        // frame still loads again as it takes and gives up the heavy slot.
        key={reduced || (plateHeld && !liveMotion) ? 'reduced' : 'full'}
        sources={local}
        selection={selection}
        title={`${lead}Your documents, ${name}, ${viewportLabel(viewport)}`}
        viewport={viewport}
        reduced={reduced || (plateHeld && !liveMotion)}
        fit={fit}
        {...(onScale ? { onScale } : {})}
      />
    );
  }
  return (
    <DemoFrame
      src={src}
      document={documentKey}
      appearance={appearance}
      motion={motion}
      title={`${what}, ${name}, ${viewportLabel(viewport)}`}
      viewport={viewport}
      gate={load.gate}
      requested={load.requested}
      onRequest={load.onRequest}
      onAnnounce={load.onAnnounce}
      fit={fit}
      {...(onScale ? { onScale } : {})}
      // The stage's own frame keeps its document on screen until the next has painted, in two
      // frames at most (MAX_LIVE). Compare's two and the Grid's four each load in their one.
      twin={side === undefined && plate === undefined}
    />
  );
}
