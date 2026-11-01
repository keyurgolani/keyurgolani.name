'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Box, Headline, mix, type StudioThumbnail } from '@portfolio/kit/studio-thumbnail';
import { STUDIO_THUMBNAILS } from '~/lib/generated/registry.thumbnails';
import {
  optionNote,
  type AppearanceCatalog,
  type CatalogAxis,
  type CatalogOption,
  type SchemeAnchors,
  type Specimen,
} from '~/lib/studio/appearance';
import {
  ALL,
  catalogFilter,
  familyCounts,
  matchesQuery,
  quietToLoud,
  FAMILIES,
  type FamilyAxis,
  type FamilyCount,
} from '~/lib/studio/catalog-filter';
import {
  compositionFamilyCounts,
  compositionOptions,
  schemePlacement,
  typeRowOf,
} from '~/lib/studio/picker-catalog';
import type { Recipe, Selection } from '~/lib/studio/recipes';
import type { TypeStillRef } from '~/lib/studio/type-stills';
import { Icon, IconButton } from './icons';
import { RadioChoices, Segmented, useMatchesMedia, type ChoiceOption } from './studio-split';

// The Appearance pickers (owner direction, 2026-10-25; the Studio mockup's
// rail, studio-design.json "pickers"): every option a specimen of itself,
// drawn with the current values of the other axes, as an APG radio group.
// - A composition is a 16:10 drawing of its structure, in the current
//   scheme's colours and display font, with its name and its signature.
// - A color scheme is a split chip on its own light and dark grounds, under a
//   readout of the current one and a search.
// - A typography pack is a row: "Aa" in its display stack and a line in its body.
// - A design language is a row with a card corner and a button in its own
//   radius, border, and shadow, on the current ground, sorted quiet to loud.
// - The display mode is a segmented control, a mode the scheme lacks disabled
//   with the reason under it.
// What an option is, its tier, provenance, performance, and access, sits
// behind one About disclosure per axis. Both Studios use these; each says in
// its own words what a value the build doesn't offer means.

export interface AxisPickerProps {
  readonly axis: CatalogAxis;
  readonly catalog: AppearanceCatalog;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** The picker's accessible name, as its page words it. */
  readonly label: string;
  /** What a value the build doesn't offer means, given what renders in its place. */
  readonly unoffered: (fallback: string) => ReactNode;
  /** The current values of every axis, which the specimens are drawn with. */
  readonly selection?: Partial<Selection>;
  /** What goes between the picker and its About disclosure, such as Owner Studio's visitor switch. */
  readonly children?: ReactNode;
  /** Hears what a mouse points at, to preview it before a click, and null as it stops. */
  readonly onIntent?: (value: string | null) => void;
  /** Opens Compare on the compositions, for the composition picker's Compare tile or link. */
  readonly onCompare?: () => void;
}

/** A composition's signature, which its manifest gives Studio, for the line under its name. */
export const signatureOf = (catalog: AppearanceCatalog, id: string): string | null =>
  optionNote(catalog, 'variant', id).option?.signature ?? null;

/**
 * The line under an axis's current value in the phone sheet's current row: a composition's
 * signature, or where a typography pack's fonts come from ("Web fonts, 34 KB").
 */
export function currentSub(
  catalog: AppearanceCatalog,
  axis: CatalogAxis,
  value: string,
): string | null {
  const option = optionNote(catalog, axis, value).option;
  if (axis === 'variant') return option?.signature ?? null;
  if (axis !== 'typography' || option?.specimen?.kind !== 'type') return null;
  const type = option.specimen;
  if (type.source === 'system') return 'System fonts';
  return type.fontBytes ? `Web fonts, ${kbOf(type.fontBytes)}` : 'Web fonts';
}

/** The sheet's short tab for each axis (the design director's ST-S5), so all of them fit at 390. */
export const AXIS_TABS: Readonly<Record<CatalogAxis, string>> = Object.freeze({
  variant: 'Layout',
  colorScheme: 'Color',
  typography: 'Type',
  designLanguage: 'Style',
  displayMode: 'Mode',
});

/** What each axis is for, in one line under its head. */
export const AXIS_LINES: Readonly<Record<CatalogAxis, string>> = Object.freeze({
  variant: 'Layout, navigation and component design',
  colorScheme: 'Every color, in light and dark',
  typography: 'Fonts and the type scale',
  designLanguage: 'Shape, depth and effects, from quiet to loud',
  displayMode: 'What visitors see first',
});

/**
 * The axes a pointer previews before a click (the lead's ruling, P-5): scheme and mode only,
 * which the frame takes in place with nothing to fetch. Type, language, composition and
 * recipe commit on click, so hovering a type option never asks the frame for its fonts.
 */
export const HOVER_PREVIEW: ReadonlySet<CatalogAxis> = new Set<CatalogAxis>([
  'colorScheme',
  'displayMode',
]);

/** The option a value the build doesn't offer shows as, first and checked, so the picker never hides it. */
function unofferedOption(value: string): ChoiceOption {
  return {
    id: value,
    label: value === '' ? 'Not set' : value,
    name: `${value === '' ? 'Not set' : value}, not available in this build`,
  };
}

export function AxisPicker(props: AxisPickerProps) {
  const {
    axis,
    catalog,
    value,
    onChange,
    disabled,
    label,
    unoffered,
    selection = {},
    children,
    onCompare,
  } = props;
  // Only an axis the ruling lets preview hears the pointer, whatever a caller hands in.
  const onIntent = HOVER_PREVIEW.has(axis) ? props.onIntent : undefined;
  const shown = useShownSelection(selection);
  const note = optionNote(catalog, axis, value);
  const entry = catalog.axes.find((each) => each.axis === axis);
  const options = entry?.options ?? [];
  const extra = note.option ? [] : [unofferedOption(value)];
  const palette = paletteOf(catalog, shown);
  const font = typeOf(catalog, selection.typography);
  const picker = (() => {
    switch (axis) {
      case 'variant':
        return (
          <CompositionPicker
            label={label}
            value={value}
            disabled={disabled}
            onChange={onChange}
            extra={extra}
            catalog={catalog}
            palette={palette}
            onCompare={onCompare}
          />
        );
      case 'colorScheme':
        return (
          <SchemePicker
            label={label}
            value={value}
            disabled={disabled}
            onChange={onChange}
            onIntent={onIntent}
            extra={extra}
            options={options}
            font={font.display}
          />
        );
      case 'typography':
        return (
          <TypePicker
            label={label}
            value={value}
            disabled={disabled}
            onChange={onChange}
            extra={extra}
            options={options}
          />
        );
      case 'designLanguage':
        return (
          <LanguageList
            label={label}
            value={value}
            disabled={disabled}
            onChange={onChange}
            onIntent={onIntent}
            extra={extra}
            options={options}
            palette={palette}
          />
        );
      case 'displayMode': {
        const scheme = optionNote(catalog, 'colorScheme', selection.colorScheme ?? '').option;
        const modes = scheme?.specimen?.kind === 'scheme' ? scheme.specimen.modes : [];
        const lacks = (mode: string) =>
          (mode === 'light' || mode === 'dark') && modes.length > 0 && !modes.includes(mode);
        return (
          <>
            <Segmented
              label={label}
              className="studio-picker studio-picker--modes studio-segmented--block"
              value={value}
              disabled={disabled}
              onChange={onChange}
              onIntent={onIntent}
              options={[
                ...extra,
                ...options.map((option) => ({
                  id: option.id,
                  label: option.id === 'high-contrast' ? 'Contrast' : option.name,
                  name: option.name,
                  disabled: lacks(option.id),
                })),
              ]}
            />
            {scheme ? <p className="studio-axis__hint">{modeLine(scheme.name, modes)}</p> : null}
          </>
        );
      }
    }
  })();
  // A short rail's pinned Display mode folds its hint into its About, so the open picker keeps
  // the room (P1-4): the same line, shown in one place at a time.
  const modeScheme =
    axis === 'displayMode'
      ? optionNote(catalog, 'colorScheme', selection.colorScheme ?? '').option
      : undefined;
  const lead = modeScheme
    ? modeLine(
        modeScheme.name,
        modeScheme.specimen?.kind === 'scheme' ? modeScheme.specimen.modes : [],
      )
    : undefined;
  return (
    <>
      {picker}
      {children}
      {note.option ? (
        <OptionInfo axis={axis} option={note.option} lead={lead} />
      ) : (
        <p className="studio-picker__fallback">{unoffered(note.fallback ?? '')}</p>
      )}
    </>
  );
}

/** Why a display mode is or isn't there, from the scheme's sets. */
export function modeLine(scheme: string, modes: readonly string[]): string {
  const light = modes.includes('light');
  const dark = modes.includes('dark');
  if (modes.length === 0 || (light && dark)) {
    return `${scheme} has light and dark sets, so every mode is available.`;
  }
  return light
    ? `${scheme} has only a light set, so Dark isn't available.`
    : `${scheme} has only a dark set, so Light isn't available.`;
}

/**
 * A pack's tier, in words an owner reads, for its About: the catalog's word, then what it
 * means (docs/appearance.md: each tier meets the same contract; only Portfolio's own packs may
 * be stable, and pull requests check every stable design language against every composition).
 * It's never a tag on the option's row, where it took the name's room (P1-1) and said nothing.
 */
const TIER_WORDS: Readonly<Record<string, string>> = {
  stable: 'Stable: one of Portfolio\u2019s own, checked with every composition on every change',
  extended: 'Extended: held to the same contract as the stable ones',
  experimental: 'Experimental: held to the same contract as the stable ones',
};

function Check({ row = false }: { row?: boolean }) {
  return (
    <span className={row ? 'studio-tick studio-tick--row' : 'studio-tick'} aria-hidden="true">
      <Icon name="check" />
    </span>
  );
}

/**
 * What an option is, behind a disclosure: about, tier, provenance, performance,
 * and access. A composition's is shown to the owner, so it says what the
 * manifest's description says and nothing from its provenance, which names the
 * sources it was built from (round 4, B2).
 */
function OptionInfo({
  axis,
  option,
  lead,
}: {
  axis: CatalogAxis;
  option: CatalogOption;
  /** A line the axis shows beside its control, which a short rail shows here instead. */
  lead?: string;
}) {
  const { tier, performance, access } = option;
  const provenance = axis === 'variant' ? [] : option.provenance;
  // A composition still in progress says only that, as a draft that holds one shows it: never
  // its manifest's description, which a scaffold leaves as a placeholder.
  const description = inProgress(option)
    ? `${option.statusLabel ?? 'In progress'}: its lane hasn't signed it off, so it can't be picked yet.`
    : option.description;
  if (!description && !tier && provenance.length === 0 && !performance && !access) return null;
  const rows: [string, string][] = [];
  if (description) rows.push(['About', description]);
  if (tier) rows.push(['Tier', TIER_WORDS[tier] ?? tier]);
  if (provenance.length > 0) rows.push(['Provenance', provenance.join('; ')]);
  if (performance) rows.push(['Performance', performance]);
  if (access) rows.push(['Access', access]);
  return (
    <details className="studio-info" data-axis={axis}>
      <summary className="studio-info__summary">
        <Icon name="info" />
        <span>About {option.name}</span>
        <Icon name="chevD" className="studio-info__chevron" />
      </summary>
      {lead ? <p className="studio-info__lead">{lead}</p> : null}
      <dl className="studio-appearance__facts" data-axis={axis}>
        {rows.map(([term, text]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// ---------------------------------------------------------------- colour

/** The colours a specimen is drawn in: a scheme's anchors in one mode, and tones mixed from them. */
export interface Palette extends SchemeAnchors {
  readonly surface: string;
  readonly rule: string;
  readonly muted: string;
  readonly strong: string;
}

const NEUTRAL: SchemeAnchors = {
  canvas: '#f3f3f2',
  text: '#1d1d1f',
  accent: '#3a62c9',
  secondary: '#8a8f99',
};

/** `anchors` with the tones the specimens use. */
export function paletteFrom(anchors: SchemeAnchors): Palette {
  const { canvas, text } = anchors;
  return {
    ...anchors,
    surface: mix(canvas, text, 0.06),
    rule: mix(canvas, text, 0.16),
    muted: mix(canvas, text, 0.42),
    strong: mix(canvas, text, 0.62),
  };
}

/** The current scheme's palette, in the current mode: its dark set for dark, its light set otherwise. */
export function paletteOf(catalog: AppearanceCatalog, selection: Partial<Selection>): Palette {
  const scheme = optionNote(catalog, 'colorScheme', selection.colorScheme ?? '').option?.specimen;
  const sets = scheme?.kind === 'scheme' ? scheme : null;
  const dark = selection.displayMode === 'dark';
  const anchors = (dark ? (sets?.dark ?? sets?.light) : (sets?.light ?? sets?.dark)) ?? NEUTRAL;
  return paletteFrom(anchors);
}

/**
 * `selection` with a "system" display mode resolved to the mode the reader's system asks for,
 * as the preview frame resolves it: the specimens are drawn in what the frame shows, so a dark
 * OS never leaves light tiles beside a dark frame (P-5, item 6's palette check found it).
 */
export function useShownSelection(selection: Partial<Selection>): Partial<Selection> {
  const dark = useMatchesMedia('(prefers-color-scheme: dark)');
  const mode = selection.displayMode;
  return mode === undefined || mode === 'system'
    ? { ...selection, displayMode: dark ? 'dark' : 'light' }
    : selection;
}

/** The current typography's stacks, or the inherited ones. */
export function typeOf(catalog: AppearanceCatalog, id: string | undefined) {
  const specimen = optionNote(catalog, 'typography', id ?? '').option?.specimen;
  return specimen?.kind === 'type'
    ? { display: specimen.display, body: specimen.body }
    : { display: 'inherit', body: 'inherit' };
}

// ---------------------------------------------------------------- schemes

/** A scheme's character chips (ruling Q2): one axis, Earthy, Neutral and Vivid. */
const CHARACTERS = FAMILIES.colorScheme.filter(({ id }) =>
  ['earthy', 'neutral', 'vivid'].includes(id),
);

/**
 * The color schemes (the round 5b mockups, ruling Q2): a search, the character chips, an
 * Accessible-only switch, then split chips with their names, by character under All, and the
 * generated ones as a section of their own. A search looks across every character.
 */
function SchemePicker({
  label,
  value,
  disabled,
  onChange,
  extra,
  options,
  font,
  onIntent,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  extra: readonly ChoiceOption[];
  options: readonly CatalogOption[];
  font: string;
  onIntent?: (value: string | null) => void;
}) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  // Each scheme filed by its character; a generated one is its own section, with none.
  const placed = options.map((option) => {
    const where = schemePlacement(option);
    return {
      ...option,
      family: where.generated ? 'generated' : where.character,
      accessible: where.accessible,
    };
  });
  const current = placed.find((option) => option.id === value);
  const [character, setCharacter] = useState<string>(() =>
    current?.family && current.family !== 'generated' ? current.family : ALL,
  );
  const searching = query.trim() !== '';
  const shownCharacter = searching ? ALL : character;
  const byName = (a: CatalogOption, b: CatalogOption) => a.name.localeCompare(b.name, 'en');
  const pool = placed.filter(
    (option) =>
      option.family !== 'generated' &&
      (!accessibleOnly || option.accessible) &&
      matchesQuery(option, query),
  );
  const generated = placed
    .filter((option) => option.family === 'generated' && matchesQuery(option, query))
    .sort(byName);
  const list = pool
    .filter((option) => shownCharacter === ALL || option.family === shownCharacter)
    .sort(byName);
  const hits = list.length + (searching ? generated.length : 0);
  const counted: FamilyCount[] = [
    { id: ALL, label: 'All', count: pool.length },
    ...CHARACTERS.map(({ id, label: name }) => ({
      id,
      label: name,
      count: pool.filter((option) => option.family === id).length,
    })),
  ];
  // The checked one stays in the group whatever the filter, first, so the picker never loses it.
  const kept = [...list, ...(shownCharacter === ALL || searching ? generated : [])];
  const missing = kept.some((option) => option.id === value)
    ? []
    : placed.filter((option) => option.id === value);
  const nameOf = (option: CatalogOption) => {
    const specimen = option.specimen?.kind === 'scheme' ? option.specimen : null;
    const sets =
      specimen?.light && specimen.dark
        ? 'light and dark'
        : specimen?.light
          ? 'light only'
          : specimen?.dark
            ? 'dark only'
            : 'generated';
    return `${option.name}, ${sets}`;
  };
  const choices: ChoiceOption[] = [
    ...extra,
    ...[...missing, ...kept].map((option) => ({
      id: option.id,
      label: option.name,
      name: nameOf(option),
    })),
  ];
  const head = (name: string, count: number, why?: string) => (
    <div className="studio-choices__head">
      <span className="studio-group__name">
        {name} <span className="studio-group__count">{count}</span>
      </span>
      {why ? <span className="studio-group__why">{why}</span> : null}
    </div>
  );
  return (
    <div className="studio-schemes">
      <div className="studio-picker__top">
        <Search
          id={`${ids}-search`}
          label="Find a scheme"
          placeholder="Find a scheme, like sage or night"
          value={query}
          onChange={setQuery}
          count={searching ? `${hits} of ${options.length}` : null}
        />
        <FamilyChips
          axis="colorScheme"
          label="Scheme character"
          options={options}
          counted={counted}
          value={shownCharacter}
          onChange={(next) => {
            setQuery('');
            setCharacter(next);
          }}
        />
        <div className="studio-schemes__toggle">
          <button
            type="button"
            role="switch"
            className="studio-toggle"
            aria-checked={accessibleOnly}
            onClick={() => setAccessibleOnly((now) => !now)}
          >
            <span className="studio-toggle__track" aria-hidden="true" />
            Accessible only
          </button>
        </div>
      </div>
      {hits === 0 ? (
        <div className="studio-empty" role="status">
          <p>No scheme matches &ldquo;{query.trim()}&rdquo;.</p>
          <p className="studio-empty__hint">Try a color or a mood, like green, warm or night.</p>
          <button type="button" className="studio-textbutton" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </div>
      ) : null}
      <RadioChoices
        label={label}
        className="studio-picker studio-picker--schemes"
        value={value}
        disabled={disabled}
        onChange={onChange}
        onIntent={onIntent}
        options={choices}
        layout={(labels) => {
          const grid = (each: readonly CatalogOption[]) => (
            <div className="studio-scheme-grid">{each.map(({ id }) => labels.get(id))}</div>
          );
          const lead = [
            ...extra.map(({ id }) => labels.get(id)),
            ...missing.map(({ id }) => labels.get(id)),
          ];
          if (shownCharacter === ALL && !searching) {
            return (
              <>
                {lead.length > 0 ? <div className="studio-scheme-grid">{lead}</div> : null}
                {CHARACTERS.map(({ id, label: name }) => {
                  const group = list.filter((option) => option.family === id);
                  return group.length > 0 ? (
                    <div key={id} className="studio-scheme-run">
                      {head(name, group.length)}
                      {grid(group)}
                    </div>
                  ) : null;
                })}
                {/* A scheme with no character the chips name, as a third party's, under All. */}
                {list.some((option) => !CHARACTERS.some(({ id }) => id === option.family)) ? (
                  <div className="studio-scheme-run">
                    {grid(
                      list.filter((option) => !CHARACTERS.some(({ id }) => id === option.family)),
                    )}
                  </div>
                ) : null}
                {generated.length > 0 ? (
                  <div className="studio-scheme-run">
                    {head('Generated', generated.length, 'Made from one seed color')}
                    {grid(generated)}
                  </div>
                ) : null}
              </>
            );
          }
          const title = searching
            ? `Matching \u201c${query.trim()}\u201d`
            : (CHARACTERS.find(({ id }) => id === shownCharacter)?.label ?? '');
          return (
            <>
              {lead.length > 0 ? <div className="studio-scheme-grid">{lead}</div> : null}
              {hits > 0 ? (
                <div className="studio-listhead">
                  <span>{title}</span>
                  <span>
                    <b>{hits}</b> of {options.length}
                  </span>
                </div>
              ) : null}
              {grid(searching ? [...list, ...generated] : list)}
            </>
          );
        }}
        // Outside the group, so the checked scheme is its one Tab stop.
        after={() =>
          shownCharacter !== ALL && !searching && generated.length > 0 ? (
            <button
              type="button"
              className="studio-textbutton studio-schemes__generated"
              onClick={() => setCharacter(ALL)}
            >
              {generated.length} generated from a seed color
            </button>
          ) : null
        }
        render={(option, checked) => {
          const full = placed.find((each) => each.id === option.id);
          return (
            <>
              <span className="studio-scheme__art">
                <SchemeChip specimen={full?.specimen ?? null} font={font} />
                {checked ? <Check /> : null}
              </span>
              <span className="studio-choice__label studio-scheme__name">{option.label}</span>
              {full?.accessible ? <span className="studio-scheme__tag">Accessible</span> : null}
            </>
          );
        }}
      />
    </div>
  );
}

/** A split chip: the scheme's light ground on the left and its dark ground on the right, each with "Aa" and its accents. */
export function SchemeChip({
  specimen,
  font,
  small = false,
}: {
  specimen: Specimen | null;
  font?: string;
  small?: boolean;
}) {
  const scheme = specimen?.kind === 'scheme' ? specimen : null;
  const sides = [scheme?.light ?? null, scheme?.dark ?? null].filter(
    (side): side is NonNullable<typeof side> => side !== null,
  );
  const className = small ? 'studio-chip studio-chip--small' : 'studio-chip';
  if (sides.length === 0 && !scheme?.swatches.length) {
    // A generated scheme with nothing in its manifest to draw: a seed and the word, never
    // grey tones, which read as off or missing.
    return (
      <span className={`${className} studio-chip--generated`} aria-hidden="true">
        <Icon name="seed" />
        {small ? null : <span className="studio-chip__generated">Generated</span>}
      </span>
    );
  }
  if (sides.length === 0) {
    // A generated scheme: its swatches as a tonal ramp.
    return (
      <span className={`${className} studio-chip--ramp`} aria-hidden="true">
        {(scheme?.swatches ?? []).slice(0, 5).map((swatch, at) => (
          <span
            key={`${swatch}${at}`}
            className="studio-chip__tone"
            style={{ background: swatch }}
          />
        ))}
      </span>
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {sides.map((side, index) => (
        <span
          key={index}
          className={
            sides.length === 1 ? 'studio-chip__side studio-chip__side--single' : 'studio-chip__side'
          }
          style={{ background: side.canvas, color: side.text }}
        >
          <span className="studio-chip__aa" style={font ? { fontFamily: font } : undefined}>
            Aa
          </span>
          {sides.length === 1 && !small ? (
            <span className="studio-chip__only">{scheme?.light ? 'Light only' : 'Dark only'}</span>
          ) : null}
          <span className="studio-chip__dots">
            {[side.accent, side.secondary].map((dot, at) => (
              <span key={at} className="studio-chip__dot" style={{ background: dot }} />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- type

/** A pack's type row, from its specimen, or null for an option with none. */
const rowOf = (option: CatalogOption | undefined) => (option ? typeRowOf(option) : null);

/** "34 KB", for what a pack's fonts weigh. */
const kbOf = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * A type still: the pack's own face, shot from its vendored files (P-5), as an alpha mask that
 * CSS paints in Studio's ink, sized in rem so it scales with the reader's text at 1:1. Its alt
 * names the pack, the role it shows, and its character; the row's radio carries the name, so the
 * still sits in an aria-hidden span and its alt stays inert (C P2-10): leave it hidden, or the
 * radio's name doubles.
 */
function Still({ still, lazy }: { still: TypeStillRef; lazy: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a hashed Studio asset, sized in rem, never optimised
    <img
      className="studio-still"
      src={still.url}
      alt={still.alt}
      width={Math.round(still.widthRem * 16)}
      height={Math.round(still.heightRem * 16)}
      style={{ width: `${still.widthRem}rem`, height: `${still.heightRem}rem` }}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
    />
  );
}

/**
 * A type specimen's "Aa": the pack's still, or for a pack with none, "Aa" in its stack (a
 * system pack's own, or a self-hosted pack's fallback stack, never its web font).
 */
export function TypeSpecimen({
  specimen,
  lazy = false,
}: {
  specimen: Specimen | null;
  lazy?: boolean;
}) {
  const type = specimen?.kind === 'type' ? specimen : null;
  if (type?.stills) {
    return (
      // Hidden on purpose, its alt inert: the row's radio names the pack (C P2-10, Still above).
      <span className="studio-type__aa" aria-hidden="true" title={type.stills.aa.alt}>
        <Still still={type.stills.aa} lazy={lazy} />
      </span>
    );
  }
  return (
    <span
      className="studio-type__aa"
      aria-hidden="true"
      style={{ fontFamily: type?.display, fontWeight: type?.displayWeight }}
    >
      Aa
    </span>
  );
}

/** The sample line: the pack's line still, or the line in its body stack. */
function TypeLine({ specimen, lazy }: { specimen: Specimen | null; lazy: boolean }) {
  const type = specimen?.kind === 'type' ? specimen : null;
  if (type?.stills) {
    return (
      // Hidden on purpose, its alt inert: the row's radio names the pack (C P2-10, Still above).
      <span className="studio-type__line" aria-hidden="true" title={type.stills.line.alt}>
        <Still still={type.stills.line} lazy={lazy} />
      </span>
    );
  }
  return (
    <span
      className="studio-type__line studio-type__line--live"
      aria-hidden="true"
      style={{ fontFamily: type?.body }}
    >
      I make failure legible.
    </span>
  );
}

/** What a type row's radio reads beyond its name: where its fonts come from, and what its pictures show. */
function typeDescription(option: CatalogOption): string {
  const type = option.specimen?.kind === 'type' ? option.specimen : null;
  const row = rowOf(option);
  if (!type || !row) return '';
  if (row.source === 'system') return 'System fonts, nothing to download.';
  const weight = type.fontBytes ? `, ${kbOf(type.fontBytes)}` : '';
  const loads = `Web fonts${weight}, which the preview loads once you choose it.`;
  if (!row.stills) return `${loads} ${row.label}: Studio shows no picture of it.`;
  const { aa, line } = row.stills;
  return `${loads} Its pictures show ${aa.caption} and ${line.caption}.`;
}

/**
 * The typography picker (the round 5b mockups): style chips, then one radio group in two runs,
 * web fonts shown as stills and the system fonts every device has, each by name.
 */
function TypePicker({
  label,
  value,
  disabled,
  onChange,
  extra,
  options,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  extra: readonly ChoiceOption[];
  options: readonly CatalogOption[];
}) {
  const current = options.find((option) => option.id === value);
  const [style, setStyle] = useState<string>(() => rowOf(current)?.style ?? ALL);
  const styled = options.map((option) => ({ ...option, family: rowOf(option)?.style ?? null }));
  const byName = (a: CatalogOption, b: CatalogOption) => a.name.localeCompare(b.name, 'en');
  const shown = found(styled, { family: style, query: '' }, value);
  const web = shown.filter((option) => rowOf(option)?.source === 'self-hosted').sort(byName);
  // Every other one, a system pack or one with no specimen to tell, is set by name.
  const system = shown.filter((option) => rowOf(option)?.source !== 'self-hosted').sort(byName);
  const head = (name: string, count: number, why: string) => (
    <>
      <span className="studio-group__name">
        {name} <span className="studio-group__count">{count}</span>
      </span>
      <span className="studio-group__why">{why}</span>
    </>
  );
  const choices: ChoiceOption[] = [
    ...extra,
    ...[...web, ...system].map((option, at) => ({
      id: option.id,
      label: option.name,
      description: typeDescription(option),
      ...(at === 0 && web.length > 0
        ? {
            head: head(
              'Web fonts',
              web.length,
              'Shown as pictures here. The preview loads a pack once you choose it.',
            ),
          }
        : at === web.length
          ? { head: head('On every device', system.length, 'System fonts, nothing to download') }
          : {}),
    })),
  ];
  const order = new Map([...web, ...system].map((option, at) => [option.id, at]));
  return (
    // It opens at its top: the web fonts' pictures are how a pack is picked by its look (P1-4).
    // A deliberate trade: a checked system font, as Humanist UI, isn't in view on open, its
    // name in the axis's row above and the sheet's head (the delta review's P2-a).
    <div className="studio-types" data-open="top">
      <div className="studio-picker__top">
        <FamilyChips
          axis="typography"
          label="Type styles"
          options={styled}
          value={style}
          onChange={setStyle}
        />
      </div>
      <RadioChoices
        label={label}
        className="studio-picker studio-picker--type"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={choices}
        render={(option, checked) => {
          const full = options.find((each) => each.id === option.id);
          const row = rowOf(full);
          const type = full?.specimen?.kind === 'type' ? full.specimen : null;
          // The rail's first screen fetches its stills at once; the rest wait to scroll in.
          const lazy = !checked && (order.get(option.id) ?? 0) >= 4;
          return (
            <>
              <TypeSpecimen specimen={full?.specimen ?? null} lazy={lazy} />
              <span className="studio-type__text">
                <span className="studio-type__head">
                  <span className="studio-choice__label">{option.label}</span>
                  {row?.source === 'self-hosted' ? (
                    <span className="studio-type__meta" aria-hidden="true">
                      {row.stills ? (type?.fontBytes ? kbOf(type.fontBytes) : null) : row.label}
                    </span>
                  ) : row ? (
                    // The desktop list says it once in its run's head; a phone's card says it itself.
                    <span className="studio-type__meta studio-type__meta--card" aria-hidden="true">
                      System fonts
                    </span>
                  ) : null}
                </span>
                <TypeLine specimen={full?.specimen ?? null} lazy={lazy} />
              </span>
              {checked ? <Check row /> : null}
            </>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- languages

const px = (value: string) => Number.parseFloat(value) || 0;

/**
 * A radius at `factor` of its size: each corner's px value, "999px" a pill at any size. The
 * card corner is drawn at true scale (factor 1, A P2-D: at 0.6 Letterpress's 3px read as Minimal
 * Flat's square), the control as a miniature, its radius scaled with its size.
 */
function radiusAt(radius: string, factor = 1): string {
  return radius
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const value = px(part);
      if (value >= 999) return '999px';
      if (value <= 0) return '0';
      return `${Math.round(value * factor * 10) / 10}px`;
    })
    .join(' ');
}

/** How much smaller the specimen's control is than the real one, at a 16px root. */
const CONTROL_SCALE = 0.32;

/** A border at its own weight, up to 3px, and its own style: solid, dashed, double, or groove. */
function border(value: string, color: string): string {
  const [width = '1px', style = 'solid'] = value.split(/\s+/);
  const wide = px(width);
  return `${style === 'double' ? 3 : Math.min(wide, 3)}px ${style} ${color}`;
}

/**
 * How loud a language reads, from its tokens: heavier borders, stronger
 * shadows, blur, texture, light, and uneven corners each add. The list runs
 * quiet to loud.
 */
export function loudness(specimen: Specimen | null): number {
  if (specimen?.kind !== 'language') return 0;
  const { borderCard, shadowCard, backdropBlur = '0px', radiusCard, radiusControl } = specimen;
  const wide = px(borderCard);
  let score = wide >= 3 ? 3 : wide >= 2 ? 2 : wide > 0 ? 1 : 0.5;
  if (/double|dashed|outset|groove/.test(borderCard)) score += 1;
  if (shadowCard !== 'none') {
    const offsets = shadowCard.match(/-?\d+(?:\.\d+)?px/g)?.map(px) ?? [];
    const blur = Math.max(0, ...offsets);
    const hard = offsets.length >= 2 && offsets[2] === 0 && (offsets[0] !== 0 || offsets[1] !== 0);
    score += hard ? 3 : blur >= 28 ? 2 : /inset/.test(shadowCard) ? 1.5 : 1;
  }
  if (px(backdropBlur) > 0) score += 1;
  if (specimen.texture && specimen.texture !== 'none') score += 1;
  if (specimen.material === 'gradient') score += 0.5;
  if (/\s/.test(radiusCard.trim())) score += 1;
  if (px(radiusControl) >= 999) score += 0.5;
  return score;
}

/** A texture behind a card's content, in the scheme's own rule colour. */
function textureFill(texture: string | undefined, palette: Palette): string | undefined {
  switch (texture) {
    case 'lines':
      return `repeating-linear-gradient(0deg, transparent 0 2px, ${palette.rule} 2px 2.6px)`;
    case 'dots':
      return `radial-gradient(circle, ${palette.muted} 0.7px, transparent 0.8px) 0 0 / 4px 4px`;
    case 'pattern':
      return `repeating-linear-gradient(135deg, transparent 0 2px, ${palette.rule} 2px 3px)`;
    default:
      return undefined;
  }
}

/**
 * A design language's mini specimen: a card corner and a button in its own
 * radius, border weight and style, shadow depth, translucency, texture, and
 * density, on the current ground, each exaggerated so neighbours differ.
 */
export function LanguageSpecimen({
  specimen,
  palette = paletteFrom(NEUTRAL),
}: {
  specimen: Specimen | null;
  palette?: Palette;
}) {
  const language = specimen?.kind === 'language' ? specimen : null;
  const glass = px(language?.backdropBlur ?? '0px') > 0;
  // Density: a roomy language pads its card and sets its lines apart; a tight one packs them.
  const roomy = Math.min(1, Math.max(0, (px(language?.surfacePadding ?? '1rem') - 0.75) / 0.75));
  const tall = Math.min(1, Math.max(0, (px(language?.controlHeight ?? '2.5rem') - 2) / 0.875));
  const surface =
    language?.material === 'gradient'
      ? `linear-gradient(160deg, ${mix(palette.surface, '#ffffff', 0.5)}, ${mix(palette.surface, palette.text, 0.1)})`
      : palette.surface;
  const texture = textureFill(language?.texture, palette);
  const heavy = px(language?.borderCard ?? '1px') >= 2;
  // The card is drawn about twice the specimen's size and cropped to its window, so its corner,
  // border and shadow show at their true scale (A P2-D), up to the 30px radii, and only the
  // control is a miniature.
  const card: CSSProperties = {
    width: '7.5rem',
    height: '5rem',
    padding: `${(4 + roomy * 4).toFixed(1)}px`,
    gap: `${(1.5 + roomy * 2).toFixed(1)}px`,
    border: border(
      language?.borderCard ?? '1px solid',
      heavy ? palette.text : mix(palette.canvas, palette.text, 0.32),
    ),
    borderRadius: radiusAt(language?.radiusCard ?? '0'),
    boxShadow: shadowOf(language?.shadowCard ?? 'none', palette),
    background: glass ? `${palette.surface}8c` : texture ? `${texture}, ${surface}` : surface,
  };
  const controlPx = px(language?.controlHeight ?? '2.5rem') * 16;
  const button: CSSProperties = {
    height: `${(controlPx * CONTROL_SCALE).toFixed(1)}px`,
    width: `${(20 + tall * 6).toFixed(1)}px`,
    border: border(language?.borderControl ?? '1px solid', mix(palette.accent, palette.text, 0.45)),
    borderRadius: radiusAt(language?.radiusControl ?? '0', CONTROL_SCALE),
    background: palette.accent,
  };
  return (
    <span
      className="studio-language"
      data-glass={glass ? 'true' : undefined}
      style={{ background: palette.canvas }}
      aria-hidden="true"
    >
      {glass ? (
        <span className="studio-language__behind" style={{ background: palette.accent }} />
      ) : null}
      <span className="studio-language__card" style={card}>
        <i style={{ background: palette.text }} />
        <i style={{ background: palette.muted }} />
        <i style={{ background: palette.muted }} />
      </span>
      <span className="studio-language__button" style={button} />
    </span>
  );
}

/** A card shadow at its true offset and blur, as the card is at true scale, in the scheme's text colour. */
function shadowOf(shadow: string, palette: Palette): string {
  if (shadow === 'none' || shadow.trim() === '') return 'none';
  return shadow
    .replace(/color-mix\(in srgb, var\(--[a-z-]+\) \d+%, transparent\)/g, `${palette.text}66`)
    .replace(/var\(--[a-z-]+\)/g, palette.text);
}

/**
 * What a family and a search keep, with the checked option kept first when they
 * don't, so the picker never loses it.
 */
function found(
  options: readonly CatalogOption[],
  filter: { readonly family: string; readonly query: string },
  value: string,
) {
  const hits = catalogFilter(options, filter);
  return hits.some((option) => option.id === value)
    ? hits
    : [...options.filter((option) => option.id === value), ...hits];
}

/**
 * How far in from each end a focused chip's box stops, in rem: past the row's fade (1rem at its
 * start, 3rem at its end, studio.css) and its ring's 4px.
 */
const FADE_START_REM = 1.5;
const FADE_END_REM = 3.5;

/**
 * Which ends of a row that scrolls across have more past them: `none` while it all shows,
 * `end` at its start, `start` at its end, `both` between. A right-to-left row's scrollLeft
 * runs negative, so it's read by its size. Half a pixel either way is the row's own rounding.
 */
export function scrollEdges(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): 'none' | 'start' | 'end' | 'both' {
  const past = Math.abs(scrollLeft);
  const start = past > 0.5;
  const end = past + clientWidth < scrollWidth - 0.5;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

/**
 * An axis's family chips (the Studio mockup): All, then each family with its
 * count, one pressed at a time. A filter, not a choice, so they're toggle
 * buttons rather than another radio group.
 */
function FamilyChips({
  axis,
  label,
  options,
  value,
  onChange,
  counted,
}: {
  axis: FamilyAxis;
  label: string;
  options: readonly CatalogOption[];
  value: string;
  onChange: (family: string) => void;
  /** The chips' counts, when they count something else than every option, as ready ones. */
  counted?: readonly FamilyCount[];
}) {
  const counts = counted ?? familyCounts(axis, options);
  const row = useRef<HTMLDivElement>(null);
  // Which ends of the row have more past them, so it fades only there: a chip at an end with
  // nothing past it keeps its ring whole, never under the fade (the quality gate's perimeter).
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const mark = () => {
      element.dataset.more = scrollEdges(
        element.scrollLeft,
        element.clientWidth,
        element.scrollWidth,
      );
    };
    // A chip that takes focus under a fade comes out from under it, its ring with it: focus
    // alone doesn't scroll a chip that's in the row's box already, faded or not.
    const clear = (event: FocusEvent) => {
      const chip = event.target instanceof HTMLElement ? event.target : null;
      if (!chip || chip.parentElement !== element) return;
      const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const box = chip.getBoundingClientRect();
      const at = element.getBoundingClientRect();
      const over = box.right - (at.right - FADE_END_REM * root);
      const under = at.left + FADE_START_REM * root - box.left;
      // Instant whatever the row's scroll-behavior, so it never animates (reduced motion or
      // not). It runs before the browser's own scroll into view on focus, which then has
      // nothing to do: the chip is wholly in the row's box, clear of the fades, already.
      const more = element.dataset.more ?? 'none';
      if (over > 0 && (more === 'end' || more === 'both'))
        element.scrollBy({ left: over, behavior: 'instant' });
      else if (under > 0 && (more === 'start' || more === 'both'))
        element.scrollBy({ left: -under, behavior: 'instant' });
      mark();
    };
    mark();
    element.addEventListener('scroll', mark, { passive: true });
    element.addEventListener('focusin', clear);
    const observer = new ResizeObserver(mark);
    observer.observe(element);
    for (const chip of Array.from(element.children)) observer.observe(chip);
    return () => {
      element.removeEventListener('scroll', mark);
      element.removeEventListener('focusin', clear);
      observer.disconnect();
    };
  }, [counts.length]);
  if (counts.length <= 1) return null;
  return (
    <div ref={row} className="studio-families" role="group" aria-label={label}>
      {counts.map((family) => (
        <button
          key={family.id}
          type="button"
          className="studio-family"
          aria-pressed={value === family.id}
          onClick={() => onChange(family.id)}
        >
          {family.label}
          <span className="studio-family__count">{family.count}</span>
        </button>
      ))}
    </div>
  );
}

function Search({
  id,
  label,
  placeholder,
  value,
  onChange,
  count,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  count: string | null;
}) {
  return (
    <div className="studio-search">
      <label className="studio-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <Icon name="search" className="studio-search__icon" />
      <input
        id={id}
        className="studio-search__input"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...(count ? { 'aria-describedby': `${id}-count` } : {})}
      />
      {count ? (
        <span id={`${id}-count`} className="studio-search__count">
          {count}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The design languages (the round 5b mockups): a search and the family chips, then rows, each a
 * card corner and a control in the language's own geometry, quiet to loud within each family;
 * under All, a run a family, each with its head and count. Opens on the current one's family.
 */
function LanguageList({
  label,
  value,
  disabled,
  onChange,
  extra,
  options,
  palette,
  onIntent,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  extra: readonly ChoiceOption[];
  options: readonly CatalogOption[];
  palette: Palette;
  onIntent?: (value: string | null) => void;
}) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const current = options.find((option) => option.id === value);
  const [family, setFamily] = useState(() => {
    const id = current?.family;
    return FAMILIES.designLanguage.some((each) => each.id === id) ? (id as string) : ALL;
  });
  const searching = query.trim() !== '';
  const sorted = quietToLoud(options, (option) => loudness(option.specimen ?? null));
  const shown = found(sorted, { family, query }, value);
  const hits = catalogFilter(sorted, { family, query }).length;
  // Under All, with no search, a run a family, in the chips' order, each quiet to loud.
  const runs =
    family === ALL && !searching
      ? [
          ...FAMILIES.designLanguage.map(({ id, label: name }) => ({
            name,
            list: shown.filter((option) => option.family === id),
          })),
          {
            name: null,
            list: shown.filter(
              (option) => !FAMILIES.designLanguage.some(({ id }) => id === option.family),
            ),
          },
        ].filter(({ list }) => list.length > 0)
      : [{ name: null, list: shown }];
  const choices: ChoiceOption[] = [
    ...extra,
    ...runs.flatMap(({ name, list }) =>
      list.map((option, at) => ({
        id: option.id,
        label: option.name,
        ...(at === 0 && name
          ? {
              head: (
                <span className="studio-group__name">
                  {name} <span className="studio-group__count">{list.length}</span>
                </span>
              ),
            }
          : {}),
      })),
    ),
  ];
  return (
    <div className="studio-languages">
      <div className="studio-picker__top">
        <Search
          id={`${ids}-search`}
          label="Find a design language"
          placeholder="Find a language, like brutalist"
          value={query}
          onChange={setQuery}
          count={searching ? `${hits} of ${options.length}` : null}
        />
        <FamilyChips
          axis="designLanguage"
          label="Language families"
          options={options}
          value={family}
          onChange={setFamily}
        />
      </div>
      {family !== ALL || searching ? (
        <p className="studio-listhead">
          <span>
            {searching
              ? `Matching \u201c${query.trim()}\u201d`
              : FAMILIES.designLanguage.find(({ id }) => id === family)?.label}
          </span>
          <span>
            <b>{hits}</b> of {options.length}
          </span>
        </p>
      ) : null}
      <RadioChoices
        label={label}
        className="studio-picker studio-picker--languages"
        value={value}
        disabled={disabled}
        onChange={onChange}
        onIntent={onIntent}
        options={choices}
        render={(option, checked) => {
          const full = options.find((each) => each.id === option.id);
          return (
            <>
              <LanguageSpecimen specimen={full?.specimen ?? null} palette={palette} />
              <span className="studio-choice__label">{option.label}</span>
              {checked ? <Check row /> : null}
            </>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- recipes

/**
 * The recipes: a strip of cards, each a miniature of its composition in its
 * own scheme, mode, and display font, then Surprise me. A card applies its
 * recipe to every axis that isn't kept.
 */
export function RecipeStrip({
  id,
  recipes,
  catalog,
  onApply,
  onSurprise,
  disabled,
}: {
  /** The strip's id, which its head's previous and next scroll. */
  id: string;
  recipes: readonly Recipe[];
  catalog: AppearanceCatalog;
  onApply: (recipe: Recipe) => void;
  onSurprise: () => void;
  disabled?: boolean;
}) {
  const nameOf = (axis: CatalogAxis, id: string) =>
    optionNote(catalog, axis, id).option?.name ?? id;
  // Each recipe filed by its composition's family (the round 5b mockups), in the chips' order.
  const compositions = compositionOptions(catalog);
  const familyOfRecipe = (recipe: Recipe) =>
    compositions.find((option) => option.id === recipe.selection.variant)?.family ?? null;
  const counted: FamilyCount[] = [
    { id: ALL, label: 'All', count: recipes.length },
    ...FAMILIES.variant
      .map(({ id: family, label }) => ({
        id: family,
        label,
        count: recipes.filter((recipe) => familyOfRecipe(recipe) === family).length,
      }))
      .filter(({ count }) => count > 0),
  ];
  const [family, setFamily] = useState<string>(ALL);
  const runs = [
    ...FAMILIES.variant.map(({ id: family, label }) => ({
      id: family,
      label,
      list: recipes.filter((recipe) => familyOfRecipe(recipe) === family),
    })),
    {
      id: 'other',
      label: null,
      list: recipes.filter(
        (recipe) => !FAMILIES.variant.some(({ id: each }) => each === familyOfRecipe(recipe)),
      ),
    },
  ].filter(({ id: run, list }) => list.length > 0 && (family === ALL || run === family));
  return (
    <div className="studio-recipes">
      <div className="studio-picker__top">
        <FamilyChips
          axis="variant"
          label="Recipes by layout family"
          options={[]}
          counted={counted}
          value={family}
          onChange={setFamily}
        />
      </div>
      <div id={id} className="studio-recipes__strip">
        {runs.map(({ id: run, label, list }) => (
          <div key={run} className="studio-recipes__run">
            {label ? (
              <p className="studio-choices__head" id={`${id}-${run}`}>
                <span className="studio-group__name">
                  {label} <span className="studio-group__count">{list.length}</span>
                </span>
              </p>
            ) : null}
            <ul
              className="studio-recipes__list"
              {...(label ? { 'aria-labelledby': `${id}-${run}` } : { 'aria-label': 'Recipes' })}
            >
              {list.map((recipe) => {
                const palette = paletteOf(catalog, recipe.selection);
                const type = typeOf(catalog, recipe.selection.typography);
                const scheme = nameOf('colorScheme', recipe.selection.colorScheme);
                const typography = nameOf('typography', recipe.selection.typography);
                return (
                  <li key={recipe.id} className="studio-recipe">
                    <button
                      type="button"
                      className="studio-recipe__button"
                      disabled={disabled}
                      onClick={() => onApply(recipe)}
                    >
                      <span className="studio-recipe__art">
                        <CompositionThumbnail id={recipe.selection.variant} palette={palette} />
                        {/* Its type, in the recipe's own colours and a stack with no web font. */}
                        <span
                          className="studio-recipe__aa"
                          aria-hidden="true"
                          style={{
                            background: palette.canvas,
                            color: palette.text,
                            fontFamily: type.display,
                          }}
                        >
                          Aa
                        </span>
                      </span>
                      <span className="studio-recipe__text">
                        <span className="studio-recipe__name">{recipe.name}</span>
                        {/* What it sets beyond its name, on one line (A P2-H): its scheme and type. */}
                        <span className="studio-recipe__meta">
                          {scheme}
                          <span className="studio-recipe__type">, {typography}</span>
                        </span>
                        <span className="studio-visually-hidden">
                          , {nameOf('variant', recipe.selection.variant)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <button type="button" className="studio-surprise" disabled={disabled} onClick={onSurprise}>
        <Icon name="shuffle" />
        <span className="studio-surprise__name">Surprise me</span>
        <span className="studio-surprise__hint">a recipe, keeping pinned axes</span>
      </button>
    </div>
  );
}

/** The quiet tools in an axis's head: previous and next, Keep, and Reset. */
export function AxisTools({
  noun,
  onStep,
  kept,
  onKeep,
  onReset,
  canReset,
}: {
  /** The axis, lower case, as each tool's name says it: "composition". */
  noun: string;
  onStep?: (step: -1 | 1) => void;
  /** Whether the axis is kept from recipes and Surprise me, when it can be. */
  kept?: boolean;
  onKeep?: () => void;
  onReset?: () => void;
  /** Whether the axis is off its own value, so Reset has something to do. */
  canReset?: boolean;
}) {
  return (
    <span className="studio-axis__tools">
      {onStep ? (
        <>
          <IconButton
            icon="chevL"
            label={`Previous ${noun}`}
            className="studio-axis__step"
            onClick={() => onStep(-1)}
          />
          <IconButton
            icon="chevR"
            label={`Next ${noun}`}
            className="studio-axis__step"
            onClick={() => onStep(1)}
          />
        </>
      ) : null}
      {onKeep ? (
        <IconButton
          icon="pin"
          label={`Keep ${noun} when applying a recipe or Surprise me`}
          pressed={kept === true}
          className="studio-iconbutton--keep"
          onClick={onKeep}
        />
      ) : null}
      {onReset ? (
        <IconButton icon="reset" label={`Reset ${noun}`} disabled={!canReset} onClick={onReset} />
      ) : null}
    </span>
  );
}

/**
 * The option `step` away from `value` in `options`, wrapping, for an axis's previous and next.
 * A composition still in progress (A2) is never a step: from one, as a saved draft can hold,
 * the steps go to the ready ones.
 */
export function stepOption(
  options: readonly { id: string; status?: string }[],
  value: string,
  step: -1 | 1,
): string | null {
  const ready = options.filter((option) => option.status !== 'pending');
  if (ready.length === 0) return null;
  const at = ready.findIndex((option) => option.id === value);
  const from = at < 0 ? (step === 1 ? -1 : 0) : at;
  return ready[(from + step + ready.length) % ready.length]!.id;
}

/** Whether `option` is a composition still in progress (A2), which no one may pick. */
export const inProgress = (option: { status?: string } | null | undefined): boolean =>
  option?.status === 'pending';

/**
 * How many of `options` can be picked, for the rail's count beside an axis (S2): the ready
 * ones, by their status, so a composition counts once its lane signs it off.
 */
export const readyCount = (options: readonly { id: string; status?: string }[]): number =>
  options.filter((option) => !inProgress(option)).length;

/** `options` with the ready ones first and those in progress after, each in their own order. */
export function readyFirst<T extends { status?: string }>(options: readonly T[]): T[] {
  return [
    ...options.filter((option) => !inProgress(option)),
    ...options.filter((option) => inProgress(option)),
  ];
}

// ---------------------------------------------------------------- compositions

/**
 * A composition's thumbnail, 136 by 85 (16:10): a static drawing of its
 * structure from the dossier's part 2, in the palette's colours, with its
 * headline in the display font. No frame, no script, no network.
 */
export function CompositionThumbnail({
  id,
  palette = paletteFrom(NEUTRAL),
}: {
  id: string;
  palette?: Palette;
}) {
  const draw = STUDIO_THUMBNAILS[id] ?? genericPlate;
  return (
    <svg
      className="studio-thumb"
      data-composition={id}
      viewBox="0 0 136 85"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {draw(palette)}
    </svg>
  );
}

/** What each composition family is, in a line, for its head (the round 5b mockups). */
const FAMILY_LINES: Readonly<Record<string, string>> = Object.freeze({
  print: 'Reads like a printed page',
  technical: 'Looks like an instrument',
  stage: 'One thing at a time',
  surface: 'Everything at once, on one plane',
});

/** "1 ready, 2 in progress", or "3 ready". */
const readyLine = (ready: number, pending: number) =>
  pending > 0 ? `${ready} ready, ${pending} in progress` : `${ready} ready`;

/**
 * The composition picker (the round 5b mockups, A2): family chips that count the ready ones,
 * then the ready ones as drawings, and the ones still in progress, which can't be picked, as
 * plain rows: under All behind one In progress disclosure, by family; in a family view after
 * its drawings, one in the cell an odd drawing leaves. No grid has an empty cell: an odd one
 * takes Compare, or the family's in-progress card. The ones a build doesn't register yet are
 * listed too (picker-catalog's compositionOptions), so the program's 14 all show.
 */
/**
 * What the composition picker shows under a family chip (or All, `ALL`) with `value` checked.
 * The checked one is always in the radio group, so it stays its Tab stop and an arrow steps
 * from it: under a chip that isn't its family's, it leads the view (`away`), as the schemes'
 * `missing` does. One in progress (`held`) has its row in the group, checked and in sight,
 * never shut in the In progress disclosure (`behind`, under All); one ready leads the grid
 * (`lead`).
 */
export function compositionView(
  options: readonly CatalogOption[],
  value: string,
  family: string,
): {
  readonly shownReady: readonly CatalogOption[];
  readonly shownPending: readonly CatalogOption[];
  readonly away: CatalogOption | undefined;
  readonly held: CatalogOption | undefined;
  readonly lead: readonly CatalogOption[];
  readonly behind: readonly CatalogOption[];
} {
  const current = options.find((option) => option.id === value);
  const ready = options.filter((option) => !inProgress(option));
  const pending = options.filter((option) => inProgress(option));
  const inFamily = (list: readonly CatalogOption[]) =>
    family === ALL ? list : list.filter((option) => option.family === family);
  const away = current && family !== ALL && current.family !== family ? current : undefined;
  const held = inProgress(current) && (family === ALL || away) ? current : undefined;
  return {
    shownReady: inFamily(ready),
    shownPending: inFamily(pending),
    away,
    held,
    lead: away && !inProgress(away) ? [away] : [],
    behind: pending.filter((option) => option !== held),
  };
}

function CompositionPicker({
  label,
  value,
  disabled,
  onChange,
  extra,
  catalog,
  palette,
  onCompare,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  extra: readonly ChoiceOption[];
  catalog: AppearanceCatalog;
  palette: Palette;
  onCompare?: () => void;
}) {
  const options = compositionOptions(catalog);
  const ready = options.filter((option) => !inProgress(option));
  const pending = options.filter((option) => inProgress(option));
  const counts = compositionFamilyCounts(options);
  const current = options.find((option) => option.id === value);
  // Open on All while every ready composition fits (8 or fewer), else on the current's family.
  const [family, setFamily] = useState<string>(() =>
    ready.length <= 8 || !current?.family ? ALL : current.family,
  );
  const [later, setLater] = useState(false);
  const { shownReady, shownPending, away, held, lead, behind } = compositionView(
    options,
    value,
    family,
  );
  const choices: ChoiceOption[] = [
    ...extra,
    ...[...lead, ...shownReady, ...shownPending, ...(away && held ? [held] : [])].map((option) => ({
      id: option.id,
      label: option.name,
      ...(inProgress(option)
        ? { disabled: true, reason: option.statusLabel ?? 'In progress' }
        : {}),
    })),
  ];
  const familyName = (id: string) => FAMILIES.variant.find((each) => each.id === id)?.label ?? id;
  const head = (name: string, count: number, why: string) => (
    <div className="studio-choices__head">
      <span className="studio-group__name">
        {name} <span className="studio-group__count">{count}</span>
      </span>
      <span className="studio-group__why">{why}</span>
    </div>
  );
  const compareTile = (
    <button type="button" className="studio-compare-tile" onClick={onCompare}>
      <span className="studio-compare-tile__mosaic" aria-hidden="true">
        {shownReady.slice(0, 4).map((option) => (
          <span key={option.id}>
            <CompositionThumbnail id={option.id} palette={palette} />
          </span>
        ))}
      </span>
      <span className="studio-choice__label">Compare compositions</span>
      <span className="studio-choice__sub">
        {shownReady.length > 4
          ? `These ${shownReady.length}, three at a time beside yours`
          : `These ${shownReady.length}, side by side`}
      </span>
    </button>
  );
  // No grid leaves an empty cell: an odd count's last cell takes Compare when three or more are
  // ready, else, in a family view, the family's in-progress card; an even count has Compare as
  // a link under the grid.
  const odd = (extra.length + lead.length + shownReady.length) % 2 === 1;
  const tile = odd && shownReady.length >= 3 && Boolean(onCompare);
  const card = family !== ALL && odd && !tile && shownPending.length > 0;
  const link = !odd && shownReady.length >= 2 && Boolean(onCompare);
  const rows = Math.ceil(
    (extra.length + lead.length + shownReady.length + (tile || card ? 1 : 0)) / 2,
  );
  const rowsOf =
    rows + (family !== ALL && !card && shownPending.length > 0 ? 1 : 0) + (held ? 1 : 0);
  const compareLink = (
    <button type="button" className="studio-textbutton studio-compare-link" onClick={onCompare}>
      Compare compositions
    </button>
  );
  // Families with nothing ready have no chip: the view says where theirs are (A P1-1).
  const unready = FAMILIES.variant.filter(
    ({ id }) => pending.some((option) => option.family === id) && !counts.some((c) => c.id === id),
  );
  return (
    <div className="studio-compositions">
      <div className="studio-picker__top">
        <FamilyChips
          axis="variant"
          label="Layout families, ready ones"
          options={options}
          counted={counts}
          value={family}
          onChange={setFamily}
        />
      </div>
      {family === ALL
        ? head('Ready', shownReady.length, 'Every composition you can use today')
        : head(
            familyName(family),
            shownReady.length,
            `${FAMILY_LINES[family] ?? ''}. ${readyLine(shownReady.length, shownPending.length)}`,
          )}
      {/* The radio group holds the options alone, so its checked radio is its one Tab stop and
          Tab leaves it in one press. Compare, outside it, still takes the grid's odd cell (wide,
          the group is a subgrid of this grid), and the ones in progress under All follow it
          behind their own disclosure. */}
      <div
        className="studio-compositions__grid"
        style={{ '--rows': rowsOf, '--tile-row': rows } as CSSProperties}
      >
        <RadioChoices
          label={label}
          className="studio-picker studio-picker--compositions"
          value={value}
          disabled={disabled}
          onChange={onChange}
          options={choices}
          layout={(labels) => {
            const of = (list: readonly CatalogOption[]) => list.map(({ id }) => labels.get(id));
            return (
              <>
                <div className="studio-thumbs" data-grid="">
                  {extra.map(({ id }) => labels.get(id))}
                  {of(lead)}
                  {of(shownReady)}
                  {card ? (
                    <div className="studio-pend-card">
                      <span className="studio-pend-card__head">Also here, in progress</span>
                      {of(shownPending)}
                    </div>
                  ) : null}
                </div>
                {family !== ALL && !card && shownPending.length > 0 ? (
                  <div className="studio-pends">{of(shownPending)}</div>
                ) : null}
                {held ? <div className="studio-pends">{labels.get(held.id)}</div> : null}
              </>
            );
          }}
          after={(labels) => {
            const of = (list: readonly CatalogOption[]) => list.map(({ id }) => labels.get(id));
            const byFamily = FAMILIES.variant
              .map(({ id, label: name }) => ({
                id,
                name,
                list: behind.filter((option) => option.family === id),
              }))
              .filter(({ list }) => list.length > 0);
            const loose = behind.filter(
              (option) => !byFamily.some(({ id }) => id === option.family),
            );
            return (
              <>
                {tile ? compareTile : null}
                {link ? compareLink : null}
                {family === ALL && behind.length > 0 ? (
                  <details
                    className="studio-later"
                    open={later}
                    onToggle={(event) => setLater(event.currentTarget.open)}
                  >
                    <summary className="studio-later__summary">
                      <Icon name="chevD" className="studio-later__chevron" />
                      <span className="studio-group__name">
                        In progress <span className="studio-group__count">{behind.length}</span>
                      </span>
                      <span className="studio-group__why">Not selectable yet</span>
                    </summary>
                    {byFamily.map(({ id, name, list }) => (
                      <div key={id} className="studio-later__family">
                        <p className="studio-later__name">{name}</p>
                        <div className="studio-pends">{of(list)}</div>
                      </div>
                    ))}
                    {loose.length > 0 ? <div className="studio-pends">{of(loose)}</div> : null}
                  </details>
                ) : null}
              </>
            );
          }}
          render={(option, checked) => {
            const listed = options.find((each) => each.id === option.id);
            // One in progress has no drawing: a plain row of its name and "In progress".
            if (inProgress(listed)) {
              return (
                <span className="studio-pending" data-pending="">
                  <span className="studio-choice__label">{option.label}</span>
                  <span className="studio-choice__sub studio-choice__sub--pending">
                    {option.reason}
                  </span>
                  {checked ? <Check /> : null}
                </span>
              );
            }
            const signature = listed?.signature ?? null;
            return (
              <>
                <span className="studio-thumb__art">
                  <CompositionThumbnail id={option.id} palette={palette} />
                  {checked ? <Check /> : null}
                </span>
                <span className="studio-choice__label">{option.label}</span>
                {signature ? <span className="studio-choice__sub">{signature}</span> : null}
              </>
            );
          }}
        />
      </div>
      {family !== ALL && unready.length > 0 ? (
        <p className="studio-axis__hint">
          {unready.map(({ label: name }) => name).join(' and ')}: none ready yet, so no filter.
          They&apos;re under All, In progress.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Studio's generic plate: a composition whose package exports no `./studio-thumbnail` (one
 * still in progress, or a third party's) is drawn as a headline over three lines of text.
 */
const genericPlate: StudioThumbnail = (p) => (
  <>
    <Box x={0} y={0} w={136} h={85} fill={p.canvas} />
    <Headline x={10} y={24} size={14} fill={p.text} />
    <Box x={10} y={32} w={90} h={3} fill={p.muted} />
    <Box x={10} y={38} w={80} h={3} fill={p.muted} />
    <Box x={10} y={44} w={86} h={3} fill={p.muted} />
  </>
);

// ---------------------------------------------------------------- the current look

/** A small specimen of an axis's current value, for the rail's current-look bar. */
export function AxisMini({
  axis,
  catalog,
  selection,
}: {
  axis: CatalogAxis;
  catalog: AppearanceCatalog;
  selection: Partial<Selection>;
}) {
  const value = selection[axis] ?? '';
  const option = optionNote(catalog, axis, value).option;
  const palette = paletteOf(catalog, useShownSelection(selection));
  const font = typeOf(catalog, selection.typography);
  switch (axis) {
    case 'variant':
      return <CompositionThumbnail id={value} palette={palette} />;
    case 'colorScheme':
      return <SchemeChip specimen={option?.specimen ?? null} font={font.display} small />;
    case 'typography': {
      const type = option?.specimen?.kind === 'type' ? option.specimen : null;
      return (
        <span className="studio-look__type" style={{ fontFamily: font.display }}>
          {type?.stills ? <Still still={type.stills.aa} lazy={false} /> : 'Aa'}
        </span>
      );
    }
    case 'designLanguage':
      return <LanguageSpecimen specimen={option?.specimen ?? null} palette={palette} />;
    case 'displayMode': {
      const light = paletteOf(catalog, { ...selection, displayMode: 'light' });
      const dark = paletteOf(catalog, { ...selection, displayMode: 'dark' });
      const sides =
        value === 'light'
          ? [light]
          : value === 'dark'
            ? [dark]
            : value === 'high-contrast'
              ? [
                  paletteFrom({
                    canvas: '#ffffff',
                    text: '#000000',
                    accent: '#000000',
                    secondary: '#000000',
                  }),
                ]
              : [light, dark];
      return (
        <span className="studio-look__mode">
          {sides.map((side, at) => (
            <span key={at} style={{ background: side.canvas, color: side.text }}>
              Aa
            </span>
          ))}
        </span>
      );
    }
  }
}
