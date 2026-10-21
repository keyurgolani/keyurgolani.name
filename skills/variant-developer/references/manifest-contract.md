# VariantManifest contract

> Every field in the VariantManifest type, with valid values, examples,
> and an editorial-vs-template comparison. Loaded by the agent during
> Phase 1 (DESIGN.md) when populating the manifest, and during Phase 2
> Wave 1 when writing the actual manifest.ts.

## Source of truth

The TypeScript type lives at `packages/kit/src/manifest.ts`. This reference
paraphrases it; if you find drift, packages/kit is authoritative.

## Field reference

### Identity fields

#### `slug` (required, string)

- Lowercase, hyphen-separated (`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`).
- Must match the package directory name (`packages/variant-<slug>`).
- Examples: `'editorial'`, `'obsidian-luxury'`, `'crt-terminal'`.

#### `name` (required, string)

- Human-readable. Shown wherever the platform lists variants, and in startup errors.
- Example: `'Editorial'`, `'Obsidian Luxury'`.

#### `tagline` (optional, string)

- One-line description. No page shows it today; Owner Studio (#8) lists variants with it.

#### `description` (optional, string)

- Longer paragraph for the variant detail view.

#### `author` (optional, string)

- Display name of the variant author.

#### `authorUrl` (optional, string)

- URL linked from the author display.

#### `version` (required, string)

- Semver string (`'1.0.0'`). Bump on substantive renderer changes.

#### `homepage` (optional, string)

- Marketing/preview URL. Used by tooling.

### Discovery / filtering fields

#### `aesthetic` (required, enum)

- One of: `editorial | spatial | kinetic | popart | terminal | bento | narrative | custom`.
- The variant's lane. Nothing filters on it today. `custom` is the escape hatch for variants that don't fit a lane.

#### `motion` (required, enum)

- One of: `still | subtle | animated | kinetic`.
- `still` = no animations beyond CSS transitions.
- `subtle` = small entrance/hover animations only.
- `animated` = scroll-tied or scripted motion across the page.
- `kinetic` = continuous rich motion (parallax, particles, etc.).

#### `density` (required, enum)

- One of: `minimal | balanced | dense`.
- Describes how much content fits per viewport.

#### `typography` (required, enum)

- One of: `serif | sans | mono | mixed`.
- The variant's _default_ typography character. A variant with multiple presets declares its default character here.

#### `performanceTier` (optional, enum, default `light`)

- One of: `light | medium | heavy`.
- `light` — flat HTML/CSS, no canvas. Safe everywhere.
- `medium` — single 2D canvas or one WebGL2 fragment shader. No R3F.
- `heavy` — R3F / three.js scene with effects. Lazy-mount strongly recommended; mobile fallbacks required.

#### `bestFor` (optional, readonly string[])

- Tags shown alongside the variant. Free-form. Examples: `['long-form','writing','academic']`.

### Coverage fields

#### `supportedKinds` (required, readonly SectionKind[])

- The kinds the variant declares it can render. Audit verifies this contains every kind in `ALL_SECTION_KINDS`.
- Use `ALL_SECTION_KINDS` for the common case.
- Or be explicit: `['hero','lede','experience',...]` — but you must keep this in sync as the schema grows. The audit checks this against the live `ALL_SECTION_KINDS`.

#### `themes` (required, readonly Exclude<ThemePreference,'system'>[])

The concrete `data-theme` values your variant renders correctly via CSS. Valid values: `'light'`, `'dark'`, `'bright'`, `'black'`. **Mandatory:** every variant must include `'light'` and `'dark'`.

`'system'` is NEVER listed in `themes` — it is a user preference / resolver, not a concrete render target. Every variant supports `'system'` automatically (it resolves to `'light'` or `'dark'` per the visitor's `prefers-color-scheme`).

`'bright'` and `'black'` are opt-in. Variants that don't declare them get fallback rendering at runtime: a visitor whose stored preference is `'bright'` falls back to `'light'`; `'black'` falls back to `'dark'`.

##### Resolution table

| User preference | Variant has it in `themes` | Resolved `data-theme`                        |
| --------------- | -------------------------- | -------------------------------------------- |
| `light`         | always (mandatory)         | `light`                                      |
| `dark`          | always (mandatory)         | `dark`                                       |
| `bright`        | yes                        | `bright`                                     |
| `bright`        | no                         | `light` (fallback)                           |
| `black`         | yes                        | `black`                                      |
| `black`         | no                         | `dark` (fallback)                            |
| `system`        | n/a                        | `light` or `dark` per `prefers-color-scheme` |

### Customization fields

#### `colorSchemes` (optional, readonly ColorScheme[])

- An array of named recolors that share the variant's layout. Each `ColorScheme` has:
  - `id` (string, required): stable id used in CSS selectors and YAML.
  - `name` (string, required): display label.
  - `description?` (string): a longer label. No page shows it today.
  - `themes` (readonly `'light'|'dark'|'bright'|'black'`[], required): which themes the scheme supports. Mandatory minimum is `['light','dark']`. Add `'bright'`/`'black'` only when you've authored CSS blocks for those values (audit warns otherwise).
  - `default?` (boolean): mark exactly one as default.
  - `swatch?` (`{ ink?, paper?, accent? }`): preview hex codes.
- Variants implement each scheme via `[data-variant='<slug>'][data-color-scheme='<id>']` CSS overrides.
- Omit when the variant only ships its single canonical palette.

#### `typographyPresets` (optional, readonly TypographyPreset[])

- Named font/size/leading combinations. Each `TypographyPreset` has:
  - `id` (string, required), `name` (string, required), `description?`.
  - `default?` (boolean): mark exactly one as default.
  - `preview?` (`{ display?, body?, ui?, mono? }`): font names. No page shows them today.
- Implement via `[data-variant='<slug>'][data-typography='<id>']` CSS overrides.

### Capabilities

#### `capabilities.print` (optional, boolean)

- The variant ships a print stylesheet (resume-style page). No host reads the flag: there's no Print button, and the stylesheet applies whenever a visitor prints.

#### `capabilities.rss` (optional, boolean)

- The variant has writings, publications, or episodes worth a feed. No host reads the flag: the site document's `features.feed` turns `/feed.xml` on or off.

#### `capabilities.multiPage` (optional, boolean)

- The variant lays content across multiple routes rather than one scroll. Reserved; most variants are single-page.

### Marketing

#### `screenshots` (optional, ReadonlyArray<{src, alt?, theme?, colorScheme?, typography?}>)

- Static previews. No page shows them today. `src` is required; `theme/colorScheme/typography` let one variant ship multiple shots that map to specific configurations.

## Helpers exported alongside the type

- `resolveColorScheme(manifest, requested)` — picks the active color scheme id with the fallback chain: the requested id when the manifest declares it → default-flagged scheme → first scheme → `null` (when none declared).
- `resolveTypographyPreset(manifest, requested)` — same chain for typography.
- `resolveTheme(preference, supported, systemMatch)` — pure function the kit's `ThemeProvider` uses to map a `ThemePreference` to a concrete `data-theme` value, applying the `bright→light` / `black→dark` fallback per the resolution table above.

Use these in your variant's render path so the site document's `colorScheme` and `typography`, which reach you as `VariantProps`, resolve the same way in every variant.

## Host integration

Declaring `'bright'` or `'black'` in `themes` is all a variant does. The host wraps every page in `<ThemeProvider>` with the selected variant's `manifest.themes` and the site's display mode as the starting preference (`apps/web/src/lib/variant-tree.tsx`), so your bright and black CSS blocks render with no wiring of your own:

```tsx
<ThemeProvider defaultPreference={displayMode} supportedThemes={mod.manifest.themes}>
  <Component
    portfolio={portfolio}
    colorScheme={selection.colorScheme}
    typography={selection.typography}
    motionPolicy={motionPolicy}
  />
</ThemeProvider>
```

At startup the host also checks the site document's `appearance` against the selected variant's manifest. A `colorScheme` or `typography` id your manifest doesn't declare is refused as `appearance.unknown`, so the ids you ship are the ones authors can pick.

## Editorial vs. template — side-by-side example

| Field             | editorial                                    | template                                     |
| ----------------- | -------------------------------------------- | -------------------------------------------- |
| slug              | `editorial`                                  | `template`                                   |
| aesthetic         | `editorial`                                  | `custom`                                     |
| motion            | `still`                                      | `still`                                      |
| density           | `balanced`                                   | `balanced`                                   |
| typography        | `mixed`                                      | `sans`                                       |
| performanceTier   | `light`                                      | `light`                                      |
| themes            | `['light','dark','bright','black']`          | `['light','dark']`                           |
| colorSchemes      | 3 (warm / noir / ink-and-paper)              | none                                         |
| typographyPresets | 2 (classic / modernist)                      | none                                         |
| supportedKinds    | every kind (see editorial's actual list)     | every kind via FallbackSection               |
| capabilities      | `{print: true, rss: true, multiPage: false}` | `{print: true, rss: true, multiPage: false}` |

The editorial declares concrete schemes/presets. The template declares none — it inherits whatever defaults the renderers handle and routes every kind through `FallbackSection`.
