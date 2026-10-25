'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import type { AppearanceSelection } from '@portfolio/schema';
import {
  AXES,
  appearanceEdits,
  appearanceFindings,
  appearanceOf,
  optionNote,
  type AppearanceCatalog,
  type AppearanceState,
  type SiteEdit,
  type VisitorControl,
} from '~/lib/studio/appearance';
import type { StudioDraft } from '~/lib/studio/documents';
import type { PreviewChoice } from '../preview/studio-preview';
import { StudioSplit, useSettled } from '../split/studio-split';
import { AxisField } from './axis-field';

// #7's preview loads with the Appearance task, never with the rest of /studio.
const StudioPreview = dynamic(
  () => import('../preview/studio-preview').then((module) => module.StudioPreview),
  {
    ssr: false,
    loading: () => (
      <p className="studio-source__note" aria-busy="true">
        Loading the preview…
      </p>
    ),
  },
);
import type { AppearanceOptions } from '~/lib/preview-frame';

// The Appearance workspace (#8, Slice 5 items 1, 3, and 8): five
// independent selectors over the saved draft's site document, the
// composition, design language, color scheme, typography, and display
// mode, each with its visitor control, and what each choice means before
// publish: the validator's own findings, tier, provenance, performance, and
// access, and what renders in place of a value this build doesn't offer.
// Applying makes one #4 edit per changed axis, so the other four stay as
// they are. Below it, #7's preview of the saved draft, in its frame under a
// grant: its environment controls change the frame alone, never the draft.
//
// Beside it (owner direction, 2026-10-25): with a preview, the form is the
// split's controls pane and the preview fills the rest, showing each pending
// choice as it's made. The choices go to the frame as its appearance
// override, which a new grant renders in a copy of the site's text, so the
// draft never changes until Apply to the draft, the one write. A run of picks
// settles before the frame loads again. Visitor controls aren't part of an
// override, so the frame shows them once they're applied.

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
  const model = draft?.documents.portfolio.model as { sections?: unknown } | null | undefined;
  if (!model || !Array.isArray(model.sections)) return [];
  return model.sections.flatMap((section: unknown) => {
    const { id, title, kind } = (section ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string') return [];
    return [{ id, title: typeof title === 'string' && title !== '' ? title : String(kind ?? id) }];
  });
}

export function AppearanceWorkspace({
  draft,
  dirty,
  saving,
  canWrite,
  catalog,
  csrfToken,
  preview,
  onApply,
}: {
  draft: StudioDraft | null;
  dirty: boolean;
  saving: boolean;
  canWrite: boolean;
  catalog: AppearanceCatalog;
  csrfToken: string;
  preview: PreviewSetup | null;
  onApply: (edits: SiteEdit[]) => void;
}) {
  const saved = useMemo(() => (draft ? appearanceOf(draft) : null), [draft]);
  // The workspace's own choices, from the saved draft until the owner changes one.
  const [chosen, setChosen] = useState<{ from: number; state: AppearanceState } | null>(null);
  const state = chosen && draft && chosen.from === draft.version ? chosen.state : saved;
  const [section, setSection] = useState('');
  // The pending selection, as the frame's override, once a run of picks settles: '' for the saved one.
  const pending =
    saved &&
    state &&
    AXES.every((axis) => state.selection[axis] !== '') &&
    AXES.some((axis) => state.selection[axis] !== saved.selection[axis])
      ? JSON.stringify(state.selection)
      : '';
  // Back to the saved selection, as Apply takes it, the frame follows at once.
  const settled = useSettled(pending);
  const shown = pending === '' ? '' : settled;
  const override = useMemo(
    () => (shown === '' ? null : (JSON.parse(shown) as AppearanceSelection)),
    [shown],
  );

  if (!draft) {
    return (
      <p className="studio-task__pending">
        Save a draft first: the workspace edits its site document.
      </p>
    );
  }
  if (!saved || !state) {
    return (
      <p className="studio-task__pending">
        The saved draft&apos;s site document doesn&apos;t read, so there&apos;s no appearance to
        show. Fix it in the content source.
      </p>
    );
  }
  const edits = appearanceEdits(saved, state);
  const findings = appearanceFindings(draft);
  const blocked = !canWrite || dirty || saving || edits.length === 0;
  const change = (next: AppearanceState) => setChosen({ from: draft.version, state: next });
  const choice: PreviewChoice = {
    id: 'draft',
    label: `Draft, version ${draft.version}`,
    kind: 'draft',
    subject: { draft: draft.draftId, version: draft.version },
    // An unoffered composition previews as what renders in its place, the catalog's own fallback.
    variant: optionNote(catalog, 'variant', saved.selection.variant).option
      ? saved.selection.variant
      : (catalog.axes.find(({ axis }) => axis === 'variant')?.fallback ?? saved.selection.variant),
    appearance: saved.selection as unknown as AppearanceSelection,
  };

  const form = (
    <form
      className="studio-appearance__form"
      aria-label="Appearance"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onApply(edits);
      }}
    >
      {catalog.axes.map(({ axis, label }) => {
        const value = state.selection[axis];
        return (
          <fieldset key={axis} className="studio-appearance__axis">
            <legend>{label}</legend>
            <AxisField
              id={`studio-appearance-${axis}`}
              axis={axis}
              label={`${label} the site shows`}
              value={value}
              catalog={catalog}
              disabled={!canWrite}
              unoffered={(fallback) => (
                <>
                  This build doesn&apos;t offer it, so {fallback} shows in its place, and it blocks
                  publishing.
                </>
              )}
              onChange={(next) =>
                change({ ...state, selection: { ...state.selection, [axis]: next } })
              }
            />
            <div
              className="studio-appearance__control"
              role="radiogroup"
              aria-label={`Visitors and ${label.toLowerCase()}`}
            >
              {(['locked', 'selectable'] as const satisfies readonly VisitorControl[]).map(
                (control) => (
                  <label key={control} className="studio-appearance__radio">
                    <input
                      type="radio"
                      name={`studio-visitor-${axis}`}
                      value={control}
                      checked={state.controls[axis] === control}
                      disabled={!canWrite}
                      onChange={() =>
                        change({ ...state, controls: { ...state.controls, [axis]: control } })
                      }
                    />
                    {control === 'locked'
                      ? 'Locked: every visitor sees this'
                      : 'Visitors may choose their own'}
                  </label>
                ),
              )}
            </div>
          </fieldset>
        );
      })}
      <section className="studio-appearance__findings" aria-labelledby="studio-appearance-findings">
        <h3 id="studio-appearance-findings">Before publish</h3>
        {findings.length === 0 ? (
          <p>The saved draft&apos;s appearance has no findings.</p>
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
      <div className="studio-source__actions">
        <button type="submit" className="studio-button" aria-disabled={blocked ? true : undefined}>
          {saving ? 'Applying…' : 'Apply to the draft'}
        </button>
        <p className="studio-source__note">
          {dirty
            ? 'Save or resolve your unsaved source changes first.'
            : edits.length === 0
              ? 'Nothing changed.'
              : `Saves ${edits.length === 1 ? 'one change' : `${edits.length} changes`} as a new draft version. The live site doesn't change.`}
        </p>
      </div>
    </form>
  );

  if (!preview) return <div className="studio-appearance">{form}</div>;
  return (
    <div className="studio-appearance">
      <StudioSplit
        controlsLabel="Appearance controls"
        previewHeading="Preview of the saved draft"
        controls={form}
      >
        <StudioPreview
          csrfToken={csrfToken}
          choices={[choice]}
          sandbox={preview.sandbox}
          previewOrigin={preview.previewOrigin}
          signIn={preview.signIn}
          appearanceOptions={preview.appearanceOptions}
          focusAnchor={section === '' ? null : section}
          layout="split"
          override={override}
          toolbar={
            <>
              <PreviewSections sections={sectionsOf(draft)} value={section} onChange={setSection} />
              <p className="studio-preview__note">
                The frame shows your choices as you make them, and the draft changes only when you
                apply them. Visitor controls show once applied. The preview&apos;s own controls
                change the frame, never the draft.{' '}
                <a href="/studio/preview">Open the full-window preview</a>
              </p>
            </>
          }
        />
      </StudioSplit>
    </div>
  );
}

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
