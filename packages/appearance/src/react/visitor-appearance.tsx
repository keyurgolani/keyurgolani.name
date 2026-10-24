'use client';

// VisitorAppearance (#19, Slice 3, item 3): what fills #5's
// VisitorControlSlot. An in-flow Disclosure labeled Appearance holds a form
// that posts the selectable axes to the preference route, Slice 4's POST
// /api/appearance: a native select per id axis, its packs grouped by tier
// with Stable first or its variants by name, and a radio group for the
// display mode. A choice the current selection can't take is disabled with
// the reason. Apply submits the form, and Reset to site default clears the
// preference. That form works with no JavaScript, in a plate, and before
// the page hydrates.
//
// With JavaScript, and a `refresh` from the host (Next's router.refresh;
// nothing here imports next/*), each change saves at once and Apply hides:
// the control POSTs the form's values as JSON, preloads the stylesheets the
// route's answer names for the new selection, then calls refresh in a
// transition, so the page renders in it with its stylesheets already there.
// The page names no stylesheet it doesn't render (#6's purity check).
// If that fails or takes over ten seconds, nothing changes and Retry
// reloads the page. What happens goes to a polite live region.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { partId } from '../ids';
import { Action } from '../primitives/action';
import { Radio } from '../primitives/form';
import { Select } from '../primitives/select';
import { Disclosure } from '../primitives/surface';
import { attributeAxis } from '../boundary';
import type { IdAxis } from '../axes';
import { APPEARANCE_PREFERENCE_ROUTE, type VisitorAppearanceModel } from '../visitor-model';
import { useBoundary, useBoundaryId, useHydrated } from './boundary-root';
import { BROWSER_SAVE, saveAppearance, type SaveBody, type SaveDeps } from './save';

export interface VisitorAppearanceProps {
  /** What to offer: visitorAppearanceModel()'s result. With no control, nothing renders. */
  readonly model: VisitorAppearanceModel;
  /** The page to come back to after a form post: its path, query, and fragment. */
  readonly returnTo: string;
  /**
   * Renders the page again once the preference is saved, as Next's
   * router.refresh() does. Without it, the control is the form alone.
   */
  readonly refresh?: () => void;
  /** Where the form posts. */
  readonly action?: string;
  /** The control's language, when the portfolio's isn't English. */
  readonly lang?: string;
  /** How a save runs. Tests give fakes; the browser's own is the default. */
  readonly save?: SaveDeps;
  /** What Retry does: reload the page. */
  readonly reload?: () => void;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly timedOut: boolean };

const STATUS_TEXT = {
  saving: 'Applying the appearance…',
  saved: 'Appearance applied.',
  failed: "Couldn't apply that, so nothing changed. Retry reloads the page.",
  timedOut: 'That took more than ten seconds, so nothing changed. Retry reloads the page.',
} as const;

/** Each control's value as the model has it, by field name. */
function applied(model: VisitorAppearanceModel): Record<string, string> {
  return Object.fromEntries(model.controls.map((control) => [control.name, control.value]));
}

/** What the form holds now, by field name, without the return path. */
function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of new FormData(form)) {
    if (name !== 'return' && typeof value === 'string') values[name] = value;
  }
  return values;
}

/**
 * Puts each control back to `values` in place, so focus stays where the
 * visitor left it. The controls stay uncontrolled, as the server rendered
 * them, so hydration never turns one into a controlled input.
 */
function restore(form: HTMLFormElement, values: Readonly<Record<string, string>>) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field && 'value' in field) (field as { value: string }).value = value;
  }
}

export function VisitorAppearance({
  model,
  returnTo,
  refresh,
  action = APPEARANCE_PREFERENCE_ROUTE,
  lang,
  save = BROWSER_SAVE,
  reload,
}: VisitorAppearanceProps) {
  const id = useBoundaryId('appearance');
  const { plate } = useBoundary();
  const hydrated = useHydrated();
  const live = Boolean(refresh) && hydrated && !plate;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const initial = useMemo(() => applied(model), [model]);
  // The page rendered a selection: the form shows what's applied now.
  useEffect(() => {
    if (form.current) restore(form.current, initial);
  }, [initial]);

  if (model.controls.length === 0) return null;

  const run = async (body: SaveBody) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setSaving(true);
    const outcome = await saveAppearance({ action, body, signal: controller.signal }, save);
    if (outcome === 'superseded') return;
    setSaving(false);
    if (outcome === 'saved') {
      setStatus({ kind: 'saved' });
      startTransition(() => refresh?.());
    } else {
      if (form.current) restore(form.current, initial);
      setStatus({ kind: 'failed', timedOut: outcome === 'timed-out' });
    }
  };

  // Every handler is there from the first render and checks `live` when it
  // runs, so no control changes element when the page hydrates and the
  // control goes live: focus and the nodes stay where they were.
  const change = () => {
    if (!live || !form.current) return;
    void run(formValues(form.current));
  };

  const text =
    saving || pending
      ? STATUS_TEXT.saving
      : status.kind === 'saved'
        ? STATUS_TEXT.saved
        : status.kind === 'failed'
          ? status.timedOut
            ? STATUS_TEXT.timedOut
            : STATUS_TEXT.failed
          : '';

  return (
    <div data-ui-slot="appearance-control" lang={lang}>
      <Disclosure summary="Appearance" id={id}>
        <form
          ref={form}
          data-ui-slot="appearance-control.form"
          method="post"
          action={action}
          aria-busy={saving || pending || undefined}
          // A plate never goes live, and its form takes no handler at all.
          onSubmit={
            plate
              ? undefined
              : (event) => {
                  if (!live) return;
                  event.preventDefault();
                  void run(formValues(event.currentTarget));
                }
          }
        >
          <input type="hidden" name="return" value={returnTo} />
          {model.controls.map((control) =>
            control.axis === 'displayMode' ? (
              <Radio
                key={control.axis}
                id={partId(id, 'display-mode')}
                legend={control.label}
                name={control.name}
                description={control.note}
                options={control.groups.flatMap((group) => group.choices)}
                defaultValue={control.value}
                onChange={change}
              />
            ) : (
              <Select
                key={control.axis}
                id={`appearance-${attributeAxis(control.axis as IdAxis)}`}
                label={control.label}
                name={control.name}
                groups={control.groups.map((group) => ({
                  label: group.tier ? group.label : undefined,
                  choices: group.choices,
                }))}
                defaultValue={control.value}
                onChange={change}
              />
            ),
          )}
          <div data-ui-slot="appearance-control.actions">
            <Action type="submit" emphasis="primary" hidden={live || undefined}>
              Apply
            </Action>
            <Action
              type="submit"
              name="reset"
              value="1"
              onClick={(event) => {
                if (!live) return;
                event.preventDefault();
                void run({ reset: true });
              }}
            >
              Reset to site default
            </Action>
            {live && status.kind === 'failed' ? (
              <Action onClick={() => (reload ?? (() => window.location.reload()))()}>Retry</Action>
            ) : null}
          </div>
          <p data-ui-slot="appearance-control.status" role="status">
            {text}
          </p>
        </form>
      </Disclosure>
    </div>
  );
}
