'use client';

import type { AppearanceSelection } from '@portfolio/schema';
import type { AppearanceOption, AppearanceOptions } from '~/lib/preview-frame';

// One frame's appearance override (#7, item 7): the composition, design
// language, color scheme, and typography the frame renders, starting from
// what the version's site selects. The override is a whole selection, which
// the frame's next grant renders in place of the site's, in a copy of the
// site's text and never the draft. Its display mode is the site's: the
// Display mode control sets what the frame shows in place.

/** The parts of an appearance these controls set, each with its label and its options. */
const PARTS = [
  { key: 'variant', label: 'Composition', options: 'variants' },
  { key: 'designLanguage', label: 'Design language', options: 'designLanguages' },
  { key: 'colorScheme', label: 'Color scheme', options: 'colorSchemes' },
  { key: 'typography', label: 'Typography', options: 'typography' },
] as const;

export interface AppearanceControlsProps {
  /** Ids for the controls, unique on the page. */
  readonly idPrefix: string;
  /** What the fieldset is called: Appearance, or First frame's appearance. */
  readonly legend: string;
  /** What the version's site selects, or null when it selects no whole appearance. */
  readonly own: AppearanceSelection | null;
  /** The frame's appearance now: the site's own, or the override. */
  readonly value: AppearanceSelection | null;
  readonly options: AppearanceOptions;
  /** A part changed, from `control`: the whole selection it makes, or null when that's the site's own. */
  readonly onChange: (next: AppearanceSelection | null, control: HTMLElement) => void;
}

/** `options`, with the site's own `current` among them when this build doesn't register it. */
function withCurrent(options: readonly AppearanceOption[], current: string) {
  return options.some(({ id }) => id === current)
    ? options
    : [...options, { id: current, name: `${current}, not installed` }];
}

const same = (a: AppearanceSelection, b: AppearanceSelection) =>
  PARTS.every(({ key }) => a[key] === b[key]) && a.displayMode === b.displayMode;

export function AppearanceControls({
  idPrefix,
  legend,
  own,
  value,
  options,
  onChange,
}: AppearanceControlsProps) {
  const shown = value ?? own;
  return (
    <fieldset
      className="studio-preview__appearance"
      disabled={own === null}
      aria-describedby={own === null ? `${idPrefix}-none` : undefined}
    >
      <legend className="studio-label">{legend}</legend>
      {PARTS.map(({ key, label, options: list }) => (
        <div key={key} className="studio-preview__field">
          <label className="studio-label" htmlFor={`${idPrefix}-${key}`}>
            {label}
          </label>
          <select
            id={`${idPrefix}-${key}`}
            className="studio-input"
            value={shown?.[key] ?? ''}
            onChange={(event) => {
              if (!own || !shown) return;
              const next = { ...shown, [key]: event.currentTarget.value };
              onChange(same(next, own) ? null : next, event.currentTarget);
            }}
          >
            {shown ? (
              withCurrent(options[list], shown[key]).map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))
            ) : (
              <option value="">None</option>
            )}
          </select>
        </div>
      ))}
      {own === null ? (
        <p id={`${idPrefix}-none`} className="studio-preview__note">
          This version&apos;s site selects no whole appearance, so it renders as the site has it.
        </p>
      ) : null}
    </fieldset>
  );
}
