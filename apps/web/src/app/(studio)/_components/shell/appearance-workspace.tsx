'use client';

import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AppearanceSelection } from '@portfolio/schema';
import {
  appearanceEdits,
  appearanceFindings,
  appearanceOf,
  appearanceOfSite,
  canonicalState,
  inPlaceAppearance,
  needsLoad,
  optionNote,
  type AppearanceCatalog,
  type AppearanceState,
  type CatalogAxis,
  type SiteEdit,
  type VisitorControl,
} from '~/lib/studio/appearance';
import type { RevisionDetail } from '~/lib/studio/backend';
import { caseStudySlug, pageOfRoute, pageRoute, type FramePage } from '~/lib/studio/pages';
import type { StudioDraft } from '~/lib/studio/documents';
import { commit, historyOf, redo, undo, undoShortcut, type History } from '~/lib/studio/history';
import {
  changeLine,
  defaultMode,
  type CompareMode,
  type CompareSelection,
  type VaryAxis,
} from '~/lib/studio/compare';
import type { StateChip } from '~/lib/studio/state-model';
import type { PreviewChoice, StudioPreviewProps } from '../preview/studio-preview';
import { CompareBar, CompareFlip, CompareGrid, CompareSide, CompareWipe } from '../split/compare';
import { Icon } from '../split/icons';
import {
  AXIS_LINES,
  AXIS_TABS,
  AxisMini,
  AxisPicker,
  AxisTools,
  readyCount,
  currentSub,
  stepOption,
} from '../split/pickers';
import {
  DeviceWidths,
  HistoryButtons,
  MenuButton,
  MenuStageTools,
  OpenFullPage,
  PHONE_STUDIO,
  ScaleBadge,
  Segmented,
  StudioSplit,
  useMatchesMedia,
  usePlatform,
  useSettled,
  type SplitSection,
} from '../split/studio-split';

import {
  REDUCED_MOTION,
  VIEWPORTS,
  type AppearanceOptions,
  type Viewport,
} from '~/lib/preview-frame';

type PreviewModule = typeof import('../preview/studio-preview');

/**
 * #7's preview, which loads with the Appearance task and never with the rest
 * of /studio. While its part loads it says so; if the part doesn't arrive, an
 * alert says so, and Try again, which takes focus, asks for it again.
 */
function LazyPreview(props: StudioPreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    readonly attempt: number;
    readonly module: PreviewModule | null;
  } | null>(null);
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    import('../preview/studio-preview').then(
      (module) => {
        if (live) setLoaded({ attempt, module });
      },
      () => {
        if (live) setLoaded({ attempt, module: null });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const failed = loaded !== null && loaded.attempt === attempt && loaded.module === null;
  useEffect(() => {
    if (failed) retry.current?.focus();
  }, [failed]);
  if (loaded?.module) return createElement(loaded.module.StudioPreview, props);
  if (failed) {
    return (
      <div className="studio-alert" role="alert">
        <p>
          The preview couldn&apos;t load: part of Studio didn&apos;t arrive. Check your connection,
          then try again.
        </p>
        <button
          ref={retry}
          type="button"
          className="studio-button"
          onClick={() => setAttempt((count) => count + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <p className="studio-source__note" aria-busy="true">
      Loading the preview…
    </p>
  );
}

// The Appearance workspace (#8, Slice 5 items 1, 3, and 8): five
// independent axes over the saved draft's site document, the composition,
// color scheme, typography, design language, and display mode, each with
// its visitor control, and what each choice means before publish: the
// validator's own findings, tier, provenance, performance, and access, and
// what renders in place of a value this build doesn't offer. Applying makes
// one #4 edit per changed axis, so the other four stay as they are.
//
// The workspace (owner direction, 2026-10-25; the design dossier's part 3,
// and the Studio mockup's owner view): the axes are pickers in the rail, each
// option a specimen of itself, with previous, next, and Reset in its head and
// a Let visitors choose switch under it, beside #7's live preview, which
// shows each pending choice as it's made. Undo and redo walk the pending
// choices; Save draft and Publish sit in the top bar, the state line in the
// bottom bar. Every
// axis but the composition goes to the frame in place, over its channel,
// with no load; a new composition loads it once, under a grant whose
// appearance override renders the pending selection in a copy of the site's
// text, and the frame comes back to where its reader was. The draft never
// changes until Save draft, the one write. Visitor controls aren't
// part of an override, so the frame shows them once they're applied. What an
// option is sits behind its info disclosure, and the findings before
// publish in one summary in the rail's footer.
//
// Before any draft exists, the workspace works over the live revision: the
// controls start from its site, the frame previews it, and opening writes
// nothing. The first Save draft starts the working draft from the live revision,
// through draft.create, and applies the edits over that version, as one
// action in the shell.

/** What the page decided for the preview, which the shell passes on. */
export interface PreviewSetup {
  readonly sandbox: string;
  readonly previewOrigin: string | null;
  readonly appearanceOptions: AppearanceOptions;
  readonly signIn: string;
}

/** A section of the draft's portfolio a preview can show: its id and its title. */
export interface PreviewSection {
  readonly id: string;
  readonly title: string;
}

/** The saved draft's sections, by their ids, from the model the store parsed. */
export function sectionsOf(draft: StudioDraft | null): PreviewSection[] {
  return sectionsOfModel(draft?.documents.portfolio.model);
}

/** A portfolio model's sections, by their ids: a draft's, or the live revision's. */
export function sectionsOfModel(portfolio: unknown): PreviewSection[] {
  const model = portfolio as { sections?: unknown } | null | undefined;
  if (!model || !Array.isArray(model.sections)) return [];
  return model.sections.flatMap((section: unknown) => {
    const { id, title, kind } = (section ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string') return [];
    return [{ id, title: typeof title === 'string' && title !== '' ? title : String(kind ?? id) }];
  });
}

/** The rail's axes, heaviest first, as the dossier orders them. */
export const RAIL_AXES: readonly CatalogAxis[] = Object.freeze([
  'variant',
  'colorScheme',
  'typography',
  'designLanguage',
  'displayMode',
]);

const parse = (key: string) => JSON.parse(key) as Record<CatalogAxis, string>;

/** How long a pointer rests on an option before the frame previews it. */
const INTENT_MS = 50;

/** When a pick came, for coalescing a run of them; read only in event handlers. */
const clock = () => Date.now();

/** What the shell gives the workspace's bars: Studio's name, the task links, Sign out, and the state. */
export interface WorkspaceChrome {
  /** The top bar's rail zone: Studio's name. */
  readonly brand: ReactNode;
  /** The top bar's task links. */
  readonly nav: ReactNode;
  /** The session's own action, at the top bar's end: Sign out. */
  readonly session: ReactNode;
  /** The state line's parts, from the shell's state model. */
  readonly states: readonly StateChip[];
  /** What the shell's live region last said, which the bottom bar shows once settled. */
  readonly notice: string;
  /** Says `text` in the shell's live region: what Compare and its Use this did. */
  readonly announce?: (text: string) => void;
  /** The live revision's number, for the line that says what visitors still see. */
  readonly liveNumber: number | null;
  /**
   * Publish's rule, the Publish history task's own, so the bar's button and
   * the Checks chip never disagree: whether the policy lets this session
   * publish, why the draft can't go now (null when it can), and how many of
   * the whole draft's findings block it, not the appearance's alone.
   */
  readonly publish: {
    readonly allowed: boolean;
    readonly blocker: string | null;
    readonly blocking: number;
    /** Opens the publish confirmation over the split, where the backend can publish. */
    readonly open?: () => void;
  };
}

const NO_PUBLISH: WorkspaceChrome['publish'] = { allowed: false, blocker: null, blocking: 0 };

/** The visitor control as a switch: off is locked, on lets visitors choose. */
function VisitorSwitch({
  axis,
  label,
  value,
  disabled,
  onChange,
}: {
  axis: CatalogAxis;
  label: string;
  value: VisitorControl;
  disabled: boolean;
  onChange: (next: VisitorControl) => void;
}) {
  const ids = useId();
  const on = value === 'selectable';
  return (
    <button
      type="button"
      role="switch"
      className="studio-switch"
      data-axis={axis}
      aria-checked={on}
      aria-labelledby={`${ids}-name`}
      aria-describedby={`${ids}-state`}
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (!disabled) onChange(on ? 'locked' : 'selectable');
      }}
    >
      <span className="studio-switch__text">
        <span id={`${ids}-name`} className="studio-switch__name">
          Let visitors choose<span className="studio-visually-hidden"> {label}</span>
        </span>
        <span id={`${ids}-state`} className="studio-switch__state">
          {on ? `Visitors can pick their own ${label}` : 'Everyone sees your choice'}
        </span>
      </span>
      <span className="studio-switch__track" aria-hidden="true" />
    </button>
  );
}

export function AppearanceWorkspace({
  draft,
  dirty,
  saving,
  canWrite,
  catalog,
  csrfToken,
  preview,
  live = null,
  chrome,
  content = null,
  showProblemsInContent,
  onApply,
}: {
  draft: StudioDraft | null;
  dirty: boolean;
  saving: boolean;
  canWrite: boolean;
  catalog: AppearanceCatalog;
  csrfToken: string;
  preview: PreviewSetup | null;
  /**
   * The live revision, read, while there's no draft: the workspace starts
   * from its site, `undefined` while it loads, and null when there's none.
   */
  live?: RevisionDetail | null | undefined;
  /** The workspace's bars, from the shell. */
  chrome?: WorkspaceChrome;
  /**
   * Content's rail, when the task is Content (the Studio mockup's
   * studio-owner-content): its fields in the rail over this same stage, which
   * keeps its page, device, and frame, and Save draft saving them, with any
   * unsaved appearance picks, `edits`, in the same write (OWN-5).
   */
  content?: {
    readonly rail: ReactNode;
    readonly onSave: (edits: SiteEdit[]) => void;
    /** Shows the rail's findings, the next step a preview the saved draft can't render offers. */
    readonly showProblems?: () => void;
  } | null;
  /**
   * Saves `edits`: over the draft, with any unsaved text in the same write, or, with no draft
   * yet, to the draft its first Save starts.
   */
  onApply: (edits: SiteEdit[]) => void;
  /**
   * Appearance's way to the problems a blocked preview names: the Content task, its findings
   * shown there. Content's own rail has `content.showProblems` instead.
   */
  showProblemsInContent?: () => void;
}) {
  const ids = useId();
  // A retired id reads as its survivor (LANG-1): checked in the picker, with no edit pending, so
  // the stored value stays as it is until the owner saves a change on that axis.
  const saved = useMemo(
    () =>
      canonicalState(
        catalog,
        draft ? appearanceOf(draft) : live ? appearanceOfSite(live.documents.site.model) : null,
      ),
    [catalog, draft, live],
  );
  // What the choices start from: the draft's version, or the live revision before there's a draft.
  const from = draft ? `draft:${draft.version}` : live ? `revision:${live.revisionId}` : '';
  // The workspace's own choices, with undo and redo, from the saved draft until the owner changes one.
  const [chosen, setChosen] = useState<{ from: string; history: History<AppearanceState> } | null>(
    null,
  );
  const history = chosen && from !== '' && chosen.from === from ? chosen.history : null;
  const state = history ? history.present : saved;
  const caseSlug = caseStudySlug((draft ?? live)?.documents.portfolio.model);
  const [section, setSection] = useState('');
  // The portfolio section of the Content field that has focus, which the frame outlines.
  const [fieldSection, setFieldSection] = useState<string | null>(null);
  // The page the frame shows (the Studio mockup's page switch): Home, its Work section, or
  // the portfolio's case study, over the same selection.
  const [pageKind, setPageKind] = useState<FramePage['kind']>('home');
  const shortcut = undoShortcut(usePlatform());
  // The bar over the frame: the device width, motion, and the frame's scale.
  const phone = useMatchesMedia(PHONE_STUDIO);
  const systemReduces = useMatchesMedia(REDUCED_MOTION);
  const [pickedViewport, setViewportId] = useState<Viewport['id'] | null>(null);
  const viewportId: Viewport['id'] = pickedViewport ?? (phone ? 'mobile' : 'desktop');
  const viewport = VIEWPORTS.find(({ id }) => id === viewportId) ?? VIEWPORTS[0]!;
  const [motion, setMotion] = useState<'system' | 'reduce'>('system');
  const [scale, setScale] = useState(1);
  const notice = useSettled(chrome?.notice ?? '', 500);
  // Compare (OWN-2, Demo Studio's own, shared): A pinned as it was when Compare started, B the
  // rail's pending picks. Each side and each Grid of 4 plate is a frame of its own, under a
  // grant of its own, minted and revoked as the single frame's is.
  const [compare, setCompare] = useState<CompareState | null>(null);

  // What the frame's grant renders: the saved selection, or the pending one
  // the last composition change loaded it with. Every other change goes in place.
  const selectionKey = state ? JSON.stringify(state.selection) : '';
  // Settled with what it started from, so a selection a reload dropped, still settling
  // from before a conflict, never mints for the version that replaced it.
  const settled = useSettled(JSON.stringify([from, selectionKey]));
  const [settledFrom, settledSelection] = JSON.parse(settled) as [string, string];
  const settledKey = settledFrom === from ? settledSelection : '';
  const [minted, setMinted] = useState<{ from: string; key: string }>({ from, key: '' });
  const mintedKey = minted.from === from ? minted.key : '';
  if (saved && settledKey !== '') {
    const next = parse(settledKey);
    const base = mintedKey === '' ? saved.selection : parse(mintedKey);
    const complete = Object.values(next).every((value) => value !== '');
    if (complete && needsLoad(catalog, next, base)) {
      const same = JSON.stringify(next) === JSON.stringify(saved.selection);
      const key = same ? '' : settledKey;
      if (key !== mintedKey || minted.from !== from) setMinted({ from, key });
    }
  }
  const override = useMemo(
    () => (mintedKey === '' ? null : (JSON.parse(mintedKey) as AppearanceSelection)),
    [mintedKey],
  );
  // Preview on intent (the dossier's ST4): what a mouse points at shows in the frame, in
  // place, after a 50ms settle, and goes the moment it leaves or on Escape. It's never
  // chosen, written, or announced, and an axis the frame can't take in place has none.
  const [intent, setIntent] = useState<{ axis: CatalogAxis; value: string } | null>(null);
  const settle = useRef<number | null>(null);
  const point = (axis: CatalogAxis) => (value: string | null) => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = null;
    if (value === null) {
      setIntent(null);
      return;
    }
    settle.current = window.setTimeout(() => setIntent({ axis, value }), INTENT_MS);
  };
  useEffect(() => {
    if (!intent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIntent(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [intent]);
  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );
  const intentKey = intent ? `${intent.axis}=${intent.value}` : '';
  const inPlace = useMemo(() => {
    if (selectionKey === '') return null;
    const chosen = parse(selectionKey);
    const [axis, value] = intentKey === '' ? [] : intentKey.split('=');
    if (axis && value) {
      const shown = inPlaceAppearance(catalog, { ...chosen, [axis]: value });
      if (shown) return shown;
    }
    return inPlaceAppearance(catalog, chosen);
  }, [catalog, selectionKey, intentKey]);

  if (!draft && live === undefined) {
    return (
      <p className="studio-task__pending" aria-busy="true">
        Loading the live revision…
      </p>
    );
  }
  if (!draft && !live) {
    return (
      <p className="studio-task__pending">
        There&apos;s no draft and no live revision yet, so there&apos;s no appearance to start from.
        Start a draft in Content.
      </p>
    );
  }
  if (!saved || !state) {
    return (
      <p className="studio-task__pending">
        {draft
          ? "The saved draft's site document doesn't read, so there's no appearance to show. Fix it in the content source."
          : "The live revision's site document selects no appearance. Start a draft in Content to set one."}
      </p>
    );
  }
  const edits = appearanceEdits(saved, state);
  const findings = draft ? appearanceFindings(draft) : [];
  // Save draft saves whatever is unsaved, from either task, in one write (OWN-5).
  const blocked = !canWrite || saving || (edits.length === 0 && !(dirty && draft));
  const change = (next: AppearanceState, group: string | null = null) =>
    setChosen({
      from,
      history: commit(history ?? historyOf(saved), next, { group, now: clock() }),
    });
  const move = (direction: 'undo' | 'redo') => {
    if (!history) return;
    setChosen({ from, history: direction === 'undo' ? undo(history) : redo(history) });
  };
  const choice: PreviewChoice = {
    id: draft ? 'draft' : 'live',
    label: draft ? `Draft, version ${draft.version}` : 'Live revision',
    kind: draft ? 'draft' : 'revision',
    subject: draft
      ? { draft: draft.draftId, version: draft.version }
      : { revision: live!.revisionId },
    // An unoffered composition previews as what renders in its place, the catalog's own fallback.
    variant: optionNote(catalog, 'variant', saved.selection.variant).option
      ? saved.selection.variant
      : (catalog.axes.find(({ axis }) => axis === 'variant')?.fallback ?? saved.selection.variant),
    appearance: saved.selection as unknown as AppearanceSelection,
  };

  const labelOf = (axis: CatalogAxis) =>
    catalog.axes.find((entry) => entry.axis === axis)?.label ?? axis;
  const nameOf = (axis: CatalogAxis, value: string) =>
    optionNote(catalog, axis, value).option?.name ?? value;
  const axes = RAIL_AXES.filter((axis) => catalog.axes.some((entry) => entry.axis === axis));
  const changedAxes = axes.filter(
    (axis) =>
      state.selection[axis] !== saved.selection[axis] ||
      state.controls[axis] !== saved.controls[axis],
  );
  // Compare (OWN-2): offered where the owner can change B, in Appearance, beside a preview.
  const canCompare = canWrite && preview !== null && !content;
  const comparing = canCompare && compare !== null ? compare : null;
  const say = (text: string) => chrome?.announce?.(text);
  const undoHint = `Undo with ${shortcut}.`;
  /** B takes `next` whole, as one pending pick: Undo takes it back, and nothing is written until Save draft. */
  const pickAll = (next: CompareSelection) =>
    change({ ...state, selection: { ...state.selection, ...next } }, null);
  const startCompare = (mode: CompareMode | null = null, vary: VaryAxis = 'variant') => {
    setCompare({ a: state.selection, mode, vary, wipe: 50, side: 'b' });
    say(
      mode === 'grid'
        ? 'Comparing: your look is pinned as A, beside its neighbours.'
        : "Comparing: your look is pinned as A. You're editing B.",
    );
  };
  const stopCompare = () => {
    setCompare(null);
    say('Stopped comparing.');
  };
  const swapCompare = () => {
    if (!comparing) return;
    const was = state.selection;
    pickAll(comparing.a);
    setCompare({ ...comparing, a: was });
    say(`Swapped A and B. You're editing what was A. ${undoHint}`);
  };
  const sections: SplitSection[] = axes.map((axis) => {
    const label = labelOf(axis);
    const noun = label.toLowerCase();
    const options = catalog.axes.find((entry) => entry.axis === axis)?.options ?? [];
    const value = state.selection[axis];
    const changed = changedAxes.includes(axis);
    const pick = (next: string) =>
      change({ ...state, selection: { ...state.selection, [axis]: next } }, axis);
    const step = (direction: -1 | 1) => {
      const next = stepOption(options, value, direction);
      if (next) pick(next);
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
        specimen: <AxisMini axis={axis} catalog={catalog} selection={state.selection} />,
        name: nameOf(axis, value),
        ...(axis === 'displayMode' || !canWrite ? {} : { step }),
      },
      marker: changed ? <span className="studio-split__marker">Unsaved</span> : null,
      current: {
        name: nameOf(axis, value),
        ...(currentSub(catalog, axis, value) ? { sub: currentSub(catalog, axis, value)! } : {}),
      },
      tools: canWrite ? (
        <AxisTools
          noun={noun}
          {...(axis === 'displayMode'
            ? {}
            : {
                onStep: (direction: -1 | 1) => {
                  const next = stepOption(options, value, direction);
                  if (next) pick(next);
                },
              })}
          onReset={() =>
            change({
              selection: { ...state.selection, [axis]: saved.selection[axis] },
              controls: { ...state.controls, [axis]: saved.controls[axis] },
            })
          }
          canReset={changed}
        />
      ) : undefined,
      content: (
        <fieldset className="studio-appearance__axis" data-axis={axis}>
          <legend className="studio-appearance__legend">{label}</legend>
          <AxisPicker
            axis={axis}
            catalog={catalog}
            label={`${label} the site shows`}
            value={value}
            selection={state.selection}
            disabled={!canWrite}
            unoffered={(fallback) => (
              <>
                This build doesn&apos;t offer it, so {fallback} shows in its place, and it blocks
                publishing.
              </>
            )}
            onChange={pick}
            onIntent={axis === 'variant' ? undefined : point(axis)}
            {...(axis === 'variant' && canCompare
              ? { onCompare: () => startCompare('grid', 'variant') }
              : {})}
          >
            <VisitorSwitch
              axis={axis}
              label={noun}
              value={state.controls[axis]}
              disabled={!canWrite}
              onChange={(control) =>
                change({ ...state, controls: { ...state.controls, [axis]: control } }, null)
              }
            />
          </AxisPicker>
          {axis === 'variant' && canCompare ? (
            <button
              type="button"
              className="studio-textbutton studio-compare-phone"
              onClick={() => startCompare('grid', 'variant')}
            >
              Compare compositions
            </button>
          ) : null}
        </fieldset>
      ),
    };
  });

  const summary = (
    <details className="studio-summary">
      <summary className="studio-summary__head">
        <Icon name="info" />
        <span>
          Before publish:{' '}
          {findings.length === 0
            ? 'no findings'
            : findings.length === 1
              ? 'one finding'
              : `${findings.length} findings`}
        </span>
        <Icon name="chevD" className="studio-info__chevron" />
      </summary>
      <section className="studio-appearance__findings" aria-label="Before publish">
        {findings.length === 0 ? (
          <p>
            {draft
              ? "The saved draft's appearance has no findings."
              : 'The live revision passed its checks when it was published.'}
          </p>
        ) : (
          <ul>
            {findings.map((finding, index) => (
              <li key={`${finding.code}${finding.pointer}${index}`}>
                <strong>{finding.severity === 'warning' ? 'Warning' : 'Blocks publishing'}:</strong>{' '}
                {finding.message} {finding.remediation}
              </li>
            ))}
          </ul>
        )}
      </section>
    </details>
  );
  // What Save draft will do, or why it can't, as the bottom bar says it.
  // In the state bar's own terms, so the two agree: the draft's next version, and the live revision.
  const changes = edits.length === 1 ? 'one change' : `${edits.length} changes`;
  // In Content, Appearance's unsaved picks stay in the frame, said as they are (C-M1): never
  // "the saved draft" while they're there. Save draft keeps them with the text, in one write,
  // from either task (OWN-5), so the hint names that way out, or Undo, which takes them back.
  const next = draft ? draft.version + 1 : 1;
  const saveNote = content
    ? edits.length > 0
      ? dirty
        ? `Save draft keeps your changes and your appearance picks as draft version ${next}.`
        : `The preview shows your unsaved appearance picks. Save draft keeps them as draft version ${next}, or Undo takes them back.`
      : dirty && draft
        ? `Save draft keeps your changes as draft version ${next}. The preview shows them once saved.`
        : 'The preview shows the saved draft.'
    : dirty && draft
      ? edits.length > 0
        ? `Save draft keeps ${changes} and your content changes as draft version ${next}.`
        : `Save draft keeps your content changes as draft version ${next}.`
      : edits.length === 0
        ? draft
          ? 'The preview shows the saved draft.'
          : 'The preview shows the live revision.'
        : draft
          ? `Save draft keeps ${changes} as draft version ${next}.`
          : `Save draft starts the working draft with ${changes}.`;
  // Unsaved text is the workspace's to save from either task now, so it shows from either (OWN-5).
  const pending = dirty || edits.length > 0;
  const visitorsSee =
    !content && pending && chrome?.liveNumber !== null && chrome?.liveNumber !== undefined
      ? ` Visitors still see revision ${chrome.liveNumber}.`
      : '';
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!blocked) onApply(edits);
  };
  const formId = `${ids}-appearance`;
  // Content's Save draft saves its text, through the shell, and the picks with it in the same
  // write, so a new version never drops them unsaid (OWN-5).
  const contentBlocked = !canWrite || saving || (!dirty && edits.length === 0);
  // In the top bar, "draft" is hidden where the bar is narrow, so it keeps one 48px row, and
  // the button's name stays Save draft, starting with what it shows (WCAG 2.5.3).
  const saveLabel = (className: string) =>
    saving ? (
      'Saving…'
    ) : className === 'studio-barbutton' ? (
      <>
        Save<span className="studio-split__save-rest"> draft</span>
      </>
    ) : (
      'Save draft'
    );
  const saveButton = (className: string) =>
    content ? (
      <button
        type="button"
        className={className}
        aria-disabled={contentBlocked ? true : undefined}
        onClick={() => {
          if (!contentBlocked) content.onSave(edits);
        }}
      >
        {saveLabel(className)}
      </button>
    ) : (
      <button
        type="submit"
        form={formId}
        className={className}
        aria-disabled={blocked ? true : undefined}
      >
        {saveLabel(className)}
      </button>
    );

  if (!preview) {
    // No preview in this session: the form alone, as #8 had it.
    return (
      <div className="studio-appearance">
        <form
          id={formId}
          className="studio-appearance__form"
          aria-label="Appearance"
          onSubmit={onSubmit}
        >
          {sections.map((each) => (
            <div key={each.id}>{each.content}</div>
          ))}
          {summary}
          <div className="studio-source__actions">
            {saveButton('studio-button')}
            <p className="studio-source__note">{saveNote}</p>
          </div>
        </form>
      </div>
    );
  }
  // The frame's page, focus, and motion, the single frame's and every compared frame's alike.
  const route = pageKind === 'case' && caseSlug ? pageRoute({ kind: 'case', slug: caseSlug }) : '/';
  const onRoute = (to: string) =>
    setPageKind((now) => (pageOfRoute(to) === 'case' ? 'case' : now === 'case' ? 'home' : now));
  const focusAnchor =
    pageKind === 'work' ? 'work' : content ? fieldSection : section === '' ? null : section;
  const frameMotion = systemReduces ? 'reduce' : motion;
  /**
   * A frame on the stage. With no `shown`, the rail's own: B, the pending picks, with the
   * single frame's override and in-place appearance, its scale, and its route. With one, a
   * compared frame of its own (A, or a Grid of 4 plate) under its own grant: its override only
   * when its composition needs a load, and every other axis in place over its channel, as the
   * single frame takes a pick. `still` holds its motion reduced, a plate without the heavy slot.
   */
  const stageFrame = (
    fit: 'contain' | 'fill',
    {
      shown = null,
      lead,
      still = false,
    }: { shown?: CompareSelection | null; lead?: string; still?: boolean } = {},
  ) => (
    <LazyPreview
      csrfToken={csrfToken}
      choices={[choice]}
      sandbox={preview.sandbox}
      previewOrigin={preview.previewOrigin}
      signIn={preview.signIn}
      appearanceOptions={preview.appearanceOptions}
      focusAnchor={shown ? null : focusAnchor}
      layout="split"
      override={
        shown
          ? needsLoad(catalog, shown, saved.selection)
            ? (shown as unknown as AppearanceSelection)
            : null
          : override
      }
      inPlace={shown ? inPlaceAppearance(catalog, shown) : inPlace}
      {...(lead ? { lead } : {})}
      view={{
        viewportId,
        motion: still ? 'reduce' : frameMotion,
        fit,
        onScale: shown ? ignoreScale : setScale,
        route,
        ...(shown ? {} : { onRoute }),
        ...(shown
          ? {}
          : content?.showProblems
            ? { onShowProblems: content.showProblems }
            : !content && showProblemsInContent
              ? { onShowProblems: showProblemsInContent, problemsIn: 'Content' }
              : {}),
      }}
    />
  );
  const compareMode: CompareMode | null = comparing
    ? (comparing.mode ?? defaultMode(comparing.a, state.selection))
    : null;
  const compareStage =
    comparing && compareMode ? (
      <div className="studio-compare__room">
        <CompareBar
          catalog={catalog}
          a={comparing.a}
          b={state.selection}
          mode={compareMode}
          onMode={(mode) => setCompare({ ...comparing, mode })}
          readable={viewportId === 'tablet'}
          onReadable={() => setViewportId(viewportId === 'tablet' ? 'desktop' : 'tablet')}
          onSwap={swapCompare}
          onStop={stopCompare}
          compact={phone}
          vary={comparing.vary}
        />
        {phone ? (
          <CompareFlip
            side={comparing.side}
            onSide={(side) => setCompare({ ...comparing, side })}
            frameA={stageFrame('fill', { shown: comparing.a, lead: 'A, pinned' })}
            frameB={stageFrame('fill', { lead: 'B, editing' })}
          />
        ) : compareMode === 'grid' ? (
          <CompareGrid
            catalog={catalog}
            a={comparing.a}
            b={state.selection}
            vary={comparing.vary}
            onVary={(vary) => setCompare({ ...comparing, vary })}
            onUse={(next) => {
              pickAll(next);
              // B takes the plate's whole selection, so the notice names every axis that moves (M2).
              say(
                `B is now ${changeLine(catalog, state.selection, next) ?? nameOf(comparing.vary, next[comparing.vary])}. Nothing is saved until Save draft. ${undoHint}`,
              );
            }}
            onPin={(next) => {
              setCompare({ ...comparing, a: next });
              say(`Pinned ${nameOf(comparing.vary, next[comparing.vary])} as A.`);
            }}
            live={(shown, heavy, name) => stageFrame('fill', { shown, lead: name, still: !heavy })}
          />
        ) : compareMode === 'wipe' ? (
          <CompareWipe
            frameA={stageFrame('contain', { shown: comparing.a, lead: 'A, pinned' })}
            frameB={stageFrame('contain', { lead: 'B, editing' })}
            at={comparing.wipe}
            onAt={(wipe) => setCompare({ ...comparing, wipe })}
          />
        ) : (
          <CompareSide
            frameA={stageFrame('fill', { shown: comparing.a, lead: 'A, pinned' })}
            frameB={stageFrame('fill', { lead: 'B, editing' })}
            onBackToA={() => {
              pickAll(comparing.a);
              say(`B is back to A's look. ${undoHint}`);
            }}
          />
        )}
      </div>
    ) : null;
  const compareButton = canCompare ? (
    <button
      type="button"
      className="studio-barbutton studio-compare-toggle"
      aria-pressed={comparing !== null}
      title="Compare"
      onClick={() => (comparing ? stopCompare() : startCompare())}
    >
      <Icon name="compare" />
      {/* Its name, shown where the bar has room and kept for assistive tech where it's an icon. */}
      <span className="studio-compare-toggle__text">Compare</span>
    </button>
  ) : null;
  const pageSwitch = (
    <Segmented
      label="Page"
      caption="Page"
      className="studio-split__page"
      value={pageKind}
      options={[
        { id: 'home', label: 'Home' },
        { id: 'work', label: 'Work' },
        {
          id: 'case',
          label: 'Case study',
          disabled: caseSlug === null,
          reason: 'No case study yet',
        },
      ]}
      onChange={(next) => setPageKind(next as FramePage['kind'])}
    />
  );
  const historyButtons = (
    <HistoryButtons
      canUndo={(history?.past.length ?? 0) > 0}
      canRedo={(history?.future.length ?? 0) > 0}
      onUndo={() => move('undo')}
      onRedo={() => move('redo')}
      shortcut={shortcut}
    />
  );
  const unsaved = pending ? (
    <span className="studio-split__unsaved">
      <span className="studio-dot" aria-hidden="true" />
      Unsaved changes
    </span>
  ) : null;
  // Which section a focused Content field is in: the frame outlines it, where it has one.
  const onFieldFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const pointer = target.closest('[data-pointer]')?.getAttribute('data-pointer') ?? '';
    const at = /^\/sections\/(\d+)(?:\/|$)/.exec(pointer);
    const model = draft?.documents.portfolio.model as
      { readonly sections?: readonly { readonly id?: unknown }[] } | undefined;
    const id = at ? model?.sections?.[Number(at[1])]?.id : undefined;
    // A work's fields are the Work section's, as the page switch's Work is.
    const work = pointer.startsWith('/works/') ? 'work' : null;
    setFieldSection(typeof id === 'string' && id !== '' ? id : work);
  };
  // Publish goes by the shell's rule over the whole draft, with this workspace's own unsaved picks on top.
  const rule = chrome?.publish ?? NO_PUBLISH;
  const unsavedFirst = !draft || edits.length > 0 || dirty;
  const blocking = rule.blocking;
  const publishable = rule.allowed && canWrite && !unsavedFirst && !saving && rule.blocker === null;
  const reason = (long: string, short: string) => (
    <span id={`${ids}-publish`} className="studio-split__reason">
      {/* The short form where the bar is narrow; only one shows, and that's the description. */}
      <span className="studio-split__reason-long">{long}</span>
      <span className="studio-split__reason-short">{short}</span>
    </span>
  );
  const publish = publishable ? (
    rule.open ? (
      // Publish asks first, in a dialog over the split (P1-9), and never leaves it.
      <button
        type="button"
        className="studio-barbutton studio-barbutton--primary"
        aria-haspopup="dialog"
        onClick={rule.open}
      >
        Publish
      </button>
    ) : (
      <a className="studio-barbutton studio-barbutton--primary" href="#history">
        Publish
      </a>
    )
  ) : (
    <>
      {!rule.allowed || !canWrite ? (
        reason("This session can't publish", "Can't publish")
      ) : unsavedFirst ? (
        reason('Save first to publish', 'Save first')
      ) : blocking === 0 ? (
        reason(`Not ready: ${rule.blocker ?? 'saving'}`, 'Not ready')
      ) : (
        <a id={`${ids}-publish`} className="studio-split__reason" href="#validation">
          <span className="studio-split__reason-long">
            Fix {blocking === 1 ? '1 check' : `${blocking} checks`} to publish
          </span>
          <span className="studio-split__reason-short">
            Fix {blocking === 1 ? '1 check' : `${blocking} checks`}
          </span>
        </a>
      )}
      <button
        type="button"
        className="studio-barbutton studio-barbutton--primary"
        aria-disabled="true"
        aria-describedby={`${ids}-publish`}
      >
        Publish
      </button>
    </>
  );
  const states = chrome?.states ?? [];
  const status = (
    <>
      <ul className="studio-states" aria-label="Where things stand">
        {edits.length > 0 ? (
          <li className="studio-states__item" data-tone="attention" data-state="appearance">
            <span className="studio-dot" aria-hidden="true" />
            <span className="studio-states__label">Unsaved</span>
            {changedAxes.length === 1
              ? `${labelOf(changedAxes[0]!)} changed`
              : `${changedAxes.length} axes changed`}
          </li>
        ) : null}
        {states.map((chip) => (
          <li
            key={chip.id}
            className="studio-states__item"
            data-tone={chip.tone}
            data-state={chip.id}
          >
            {chip.tone === 'attention' ? <Icon name="alert" /> : null}
            <span className="studio-states__label">{chip.label}</span>
            {chip.id === 'checks' && draft ? <a href="#validation">{chip.value}</a> : chip.value}
          </li>
        ))}
      </ul>
      <p className="studio-split__status" aria-hidden="true">
        {notice || `${saveNote}${visitorsSee}`}
      </p>
    </>
  );
  return (
    <StudioSplit
      brand={chrome?.brand ?? null}
      bar={chrome?.nav}
      barEnd={
        <>
          {compareButton}
          {historyButtons}
          {unsaved}
          {saveButton('studio-barbutton')}
          {publish}
          {chrome?.session}
        </>
      }
      phoneBar={
        <>
          {historyButtons}
          <MenuButton
            className="studio-more"
            icon="more"
            name="More: tasks and sign out"
            label={null}
          >
            {(close) => (
              // A followed link closes the menu, a task's as the full-window preview's.
              <div
                className="studio-menu__links"
                onClick={(event) => {
                  if ((event.target as Element).closest('a')) close();
                }}
              >
                {chrome?.nav}
                {canCompare ? (
                  <div className="studio-menu__group">
                    <button
                      type="button"
                      className="studio-menu__item"
                      aria-pressed={comparing !== null}
                      onClick={() => {
                        close();
                        if (comparing) stopCompare();
                        else startCompare();
                      }}
                    >
                      Compare A and B
                    </button>
                  </div>
                ) : null}
                <MenuStageTools
                  canRedo={(history?.future.length ?? 0) > 0}
                  onRedo={() => move('redo')}
                  close={close}
                >
                  <DeviceWidths value={viewportId} onChange={setViewportId} />
                  {pageSwitch}
                </MenuStageTools>
                <div className="studio-menu__group">
                  {/* Open full page and the scale leave the phone's single stage row for this menu. */}
                  <p className="studio-menu__note">Shown at {Math.round(scale * 100)}%</p>
                  <a
                    className="studio-menu__item"
                    href="/studio/preview"
                    target="_blank"
                    rel="noopener"
                  >
                    Open the full-window preview
                  </a>
                </div>
                <div className="studio-menu__group">{chrome?.session}</div>
              </div>
            )}
          </MenuButton>
        </>
      }
      {...(content
        ? {
            railLabel: 'Content fields',
            railContent: <div onFocusCapture={onFieldFocus}>{content.rail}</div>,
          }
        : {
            form: { id: formId, label: 'Appearance', onSubmit },
            railTop: comparing ? (
              <p className="studio-compare__banner">
                You&apos;re editing B. A stays pinned as it was. Nothing reaches the draft until you
                save it.
              </p>
            ) : (
              <p>
                Changes show in the preview at once. Nothing reaches the draft until you save it.
              </p>
            ),
          })}
      sections={content ? [] : sections}
      previewHeading={draft ? 'Preview of the saved draft' : 'Preview of the live revision'}
      railFooter={
        content ? null : (
          <>
            <PreviewSections
              sections={sectionsOfModel((draft ?? live)?.documents.portfolio.model)}
              value={section}
              onChange={setSection}
            />
            {summary}
          </>
        )
      }
      status={status}
      sheetFoot={
        <div className="studio-split__sheet-save">
          {saveButton('studio-barbutton studio-barbutton--primary')}
          <p className="studio-split__sandbox">{saveNote}</p>
        </div>
      }
      history={{ undo: () => move('undo'), redo: () => move('redo') }}
      {...(comparing ? {} : { frameWidth: viewport.width * scale })}
      toolbar={{
        center: pageSwitch,
        start: (
          <>
            <DeviceWidths value={viewportId} onChange={setViewportId} />
            <ScaleBadge scale={scale} />
          </>
        ),
        end: (
          <>
            <Segmented
              label={systemReduces ? 'Preview motion, reduced by system' : 'Preview motion'}
              caption="Motion"
              className="studio-split__motion"
              value={systemReduces ? 'reduce' : motion}
              disabled={systemReduces}
              reason="Your system asks for reduced motion"
              options={[
                { id: 'system', label: 'Follow system' },
                { id: 'reduce', label: 'Reduced' },
              ]}
              onChange={(id) => setMotion(id as 'system' | 'reduce')}
            />
            <OpenFullPage href="/studio/preview" label="Open the full-window preview" />
          </>
        ),
      }}
      stage={
        <>
          {intent ? (
            // Over the frame's top, so the page switch keeps its place (P2-6). Not announced:
            // a hover preview is a glance, and the frame shows it.
            <p className="studio-split__intent studio-split__intent--over" aria-hidden="true">
              Previewing <b>{nameOf(intent.axis, intent.value)}</b>. Click to keep it, or press Esc.
            </p>
          ) : null}
          {compareStage ?? stageFrame(phone ? 'fill' : 'contain')}
        </>
      }
    />
  );
}

/** Compare's state: A, the layout picked (or null, the default), the grid's axis, the wipe, the phone's side. */
interface CompareState {
  readonly a: CompareSelection;
  readonly mode: CompareMode | null;
  readonly vary: VaryAxis;
  readonly wipe: number;
  readonly side: 'a' | 'b';
}

/** A compared frame's scale, which the toolbar's badge never shows: the badge is B's. */
const ignoreScale = () => {};

function PreviewSections({
  sections,
  value,
  onChange,
}: {
  sections: readonly PreviewSection[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="studio-preview__field">
      <label className="studio-label" htmlFor="studio-preview-section">
        Show a section in the preview
      </label>
      <select
        id="studio-preview-section"
        className="studio-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">None</option>
        {sections.map(({ id, title }) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </div>
  );
}
