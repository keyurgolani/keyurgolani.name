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
// the control loads the stylesheet the choice needs, waits for it to load,
// POSTs the form's values as JSON, then calls refresh in a transition, so
// the page renders in the new selection with its stylesheet already there.
// If that fails or takes over ten seconds, nothing changes and Retry
// reloads the page. What happens goes to a polite live region.

import { useMemo, useRef, useState, useTransition } from 'react';
import { partId } from '../ids';
import { Action } from '../primitives/action';
import { Radio } from '../primitives/form';
import { Select } from '../primitives/select';
import { Disclosure } from '../primitives/surface';
import { attributeAxis } from '../boundary';
import type { IdAxis } from '../axes';
import {
  APPEARANCE_PREFERENCE_ROUTE,
  type VisitorAppearanceModel,
  type VisitorAxisControl,
} from '../visitor-model';
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
  const initial = useMemo(() => applied(model), [model]);
  // What the form shows. It starts at what's applied, and goes back to it when a save fails.
  const [values, setValues] = useState(initial);
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    // The page rendered a new selection: show what's applied now.
    setShown(initial);
    setValues(initial);
  }

  if (model.controls.length === 0) return null;

  const run = async (body: SaveBody, stylesheets: readonly string[]) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setSaving(true);
    const outcome = await saveAppearance(
      { action, body, stylesheets, signal: controller.signal },
      save,
    );
    if (outcome === 'superseded') return;
    setSaving(false);
    if (outcome === 'saved') {
      setStatus({ kind: 'saved' });
      startTransition(() => refresh?.());
    } else {
      setValues(initial);
      setStatus({ kind: 'failed', timedOut: outcome === 'timed-out' });
    }
  };

  const change = (control: VisitorAxisControl, value: string) => {
    const next = { ...values, [control.name]: value };
    setValues(next);
    const stylesheet = control.groups
      .flatMap((group) => group.choices)
      .find((choice) => choice.value === value)?.stylesheet;
    void run(next, stylesheet ? [stylesheet] : []);
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
          data-ui-slot="appearance-control.form"
          method="post"
          action={action}
          aria-busy={saving || pending || undefined}
          onSubmit={
            live
              ? (event) => {
                  event.preventDefault();
                  void run(values, []);
                }
              : undefined
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
                {...(live
                  ? {
                      value: values[control.name],
                      onChange: (value: string) => change(control, value),
                    }
                  : { defaultValue: control.value })}
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
                {...(live
                  ? {
                      value: values[control.name],
                      onChange: (value: string) => change(control, value),
                    }
                  : { defaultValue: control.value })}
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
              onClick={
                live
                  ? (event) => {
                      event.preventDefault();
                      void run({ reset: true }, []);
                    }
                  : undefined
              }
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
