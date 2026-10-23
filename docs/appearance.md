# Appearance

How a portfolio looks is four independent choices, plus a display mode (#19): the **variant** arranges the content, the **design language** sets materials, geometry, states, and timing, the **color scheme** sets color, and the **typography** profile sets the text. Changing one never changes the others. This page is the contract between them, for anyone building a variant or a pack, and the format a third-party pack ships in.

`@portfolio/appearance` holds it: the token contract, the pack manifests and their compiler, the resolver, the presentation boundary, and the shared primitives.

## Who owns what

| Axis            | Owns                                                                                            | Never                                          |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Variant         | Information architecture, layout, emphasis, which component goes where, and the reading flow    | Color, fonts, materials, focus, states, timing |
| Design language | Materials, geometry, borders, shadows, radii, density, focus, interaction states, icons, timing | Color values, type, layout                     |
| Color scheme    | Every semantic color, in each display mode                                                      | Anything but color                             |
| Typography      | Text roles, font files, scale, rhythm, reading measures, and script fallbacks                   | Color, layout                                  |

The display mode, `system`, `light`, `dark`, or `high-contrast`, is an environment, not a scheme: every scheme renders in it, or says which modes it lacks. Reduced motion, forced colors, and reduced transparency override every creative choice: whatever a pack or a variant sets, the accessibility layer and the visitor's operating system win.

## The selection

A site document's `appearance` names all five, and `visitorControls` says, per axis, whether a visitor may change it (`locked` or `selectable`):

```yaml
appearance:
  variant: editorial-evidence
  designLanguage: platform-neutral
  colorScheme: warm-parchment
  typography: humanist-ui
  displayMode: system
```

Those five are the platform's defaults, and the first-party fallbacks: a selection that names a pack this build doesn't register renders its axis's fallback, the boundary says so in `data-appearance-fallback`, the owner gets a diagnostic, and readiness reports degraded. Nothing claims the missing pack is active. [Configuration](configuration.md#appearance) has the fields; the demo profile makes every axis selectable in the visitor's own browser.

A visitor changes a selectable axis with the appearance control the variant places in its `VisitorControlSlot`. It's a form that works without JavaScript, and with it the page restyles in place.

## Resolution and layers

The resolver turns the published selection, the visitor's choice where an axis allows one, and the environment (the OS's color scheme and contrast preferences, and a preview frame's override) into one resolved appearance per boundary. Every layered stylesheet starts with the same statement, so the first one a page loads fixes the order and no later one can change it:

```css
@layer reset, scheme, language, typography, variant-layout, utilities, accessibility;
```

Lowest first: the platform's resets, the color scheme, the design language, the typography, the variant's layout, the utilities no pack or variant may undo, such as an outline focus ring and a control's touch target, and the accessibility overrides, which win over everything. A pack's stylesheet compiles into its own layer, and a variant's into `variant-layout`, so a variant can arrange anything but restyle nothing.

## The boundary

There's no global appearance state on `<html>`, which keeps only `lang` and `dir`. Appearance applies at a **presentation boundary**, an element the host renders with the resolved selection on it, and every token is set on that element:

```html
<div
  data-appearance-boundary="document"
  data-variant="editorial-evidence"
  data-design-language="platform-neutral"
  data-color-scheme="warm-parchment"
  data-typography="humanist-ui"
  data-display-mode="light"
  data-mode-locked="false"
  data-contrast="system"
  data-motion="full"
  data-enhancement="on"
></div>
```

- `document` is the page's one boundary, around its variant, with the skip link first and ids unprefixed.
- `plate` previews another selection inside a page, such as a catalog card: inert, contained, `data-motion="static"`, `data-enhancement="off"`, and with its own id prefix.

Boundaries nest and sit side by side without leaking style, state, ids, fonts, or events into each other, which is how Studio compares two selections on one page. `data-contrast` is `system`, or `more` when the visitor asks for more contrast. `data-motion` is `full`, `reduced` (the site's `reduce` policy, or a preview's reduced environment), or `static` (a plate, or a paused page), and the motion tokens also follow the OS setting from first paint. Stop motion of your own under `[data-variant='<id>']:is([data-motion='reduced'], [data-motion='static'])`.

## Tokens

Token contract 1 is every custom property the packs define, under three prefixes. A variant reads them with `var()`; it defines no token of its own but `--layout-*`.

- **`--color-<role>`**, from the color scheme: `canvas`; `surface-subtle`, `surface-default`, `surface-prominent`, `surface-overlay`; `text-primary`, `text-secondary`, `text-muted`, `text-inverse`; `border-subtle`, `border-default`, `border-strong`; `accent`, `accent-hover`, `accent-active`, `accent-text`, `on-accent`; `focus`, `selection`; `positive`, `warning`, `danger`, `information`, `on-status`; `data-categorical-1` to `-6`, `data-sequential-start`, `-middle`, `-end`; `signature-start`, `signature-end`, `emphasis`; `scrim`, `on-scrim`; and `shadow`.
- **`--ui-<key>`**, from the design language: the surface material and opacity; radii for controls, cards, overlays, media, and badges; borders for controls, cards, and dividers; card, overlay, raised, and inset shadows; backdrop blur; control height and control and surface spacing; the focus width, offset, and style; hover, active, selected, disabled, loading, and validation states; icon stroke and fill; the motion durations (`motion-fast`, `motion-standard`, `motion-slow`), easing, and enter, exit, and emphasis motions; texture; and the signature fill and emphasis glow. Borders and shadows reach color only through `var(--color-*)`.
- **`--type-<role>-<field>`**, from the typography profile, for each role, `display`, `headline`, `title`, `body`, `body-compact`, `label`, `caption`, `quote`, `code`, and `numeric`, and each field, `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, and `font-variation-settings`; and `--type-measure-body` and `--type-measure-compact`, the reading widths.

Set text in a role with `data-type-role="<role>"` on the element, and the platform stylesheet, which carries the primitives' rules, typesets it from those tokens. Under reduced motion the motion tokens already shorten or stop, and the state transforms read `none`, so a variant that takes its timing from them needs no motion query of its own.

## The shared primitives

Fifteen components own behavior and semantics, and the packs style them through stable `data-ui-slot` parts: Action, Surface, Navigation, Field, Select, Checkbox, Radio, Badge, Tabs, Disclosure, Dialog, Tooltip, Toast, Media, and DataDisplay, with the landmarks and `SkipLink` beside them. Import them from `@portfolio/appearance/primitives`. Each keeps its keyboard, touch, focus, and assistive technology behavior under every design language; a variant chooses which one goes where and with what emphasis (`primary`, `secondary`, or `quiet` for an action; `subtle`, `default`, `prominent`, or `overlay` for a surface; and a status, always a word too, for a badge), and never restyles one. Native elements come first: a Disclosure is a `details`, an Action a `button` or a link.

The static ones render on the server and in a plate alike: Action, Surface, Badge, Disclosure, Field, Checkbox, Radio, Media, DataDisplay, and Toast. Tabs, Dialog, Tooltip, ToastRegion, Select, and the landmarks are client components that read their boundary, and attach nothing inside a plate.

## Packs

A pack is one design language, color scheme, or typography profile. A package holds one or more of one kind, and declares which in its `package.json`:

```json
{
  "name": "@acme/appearance-tide",
  "version": "1.0.0",
  "portfolio": { "kind": "color-scheme", "packs": "./packs" }
}
```

`kind` is `design-language`, `color-scheme`, or `typography`, and `packs` is a directory with one folder per pack, each holding a `manifest.json` and any files it names. A pack package ships no CSS outside what its manifest declares, since the compiler writes every rule, and no JavaScript but a design language's declared enhancements.

### Every pack

Each manifest is strict, so a key the contract doesn't define is an error, never ignored.

| Field           | What it is                                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Lowercase letters, digits, and hyphens. A package under a scope starts its pack ids with it, as `@acme` does with `acme-tide`, and only `@portfolio/*` may take a fallback's id.                   |
| `name`          | Plain text, up to 60 characters.                                                                                                                                                                   |
| `description`   | Plain text, up to 1,000 characters.                                                                                                                                                                |
| `tokenContract` | `1`. A pack for another contract's tokens is refused rather than misread.                                                                                                                          |
| `tier`          | `stable`, `extended`, or `experimental`, which ship, or `research`, which never reaches a production registry.                                                                                     |
| `provenance`    | `source` (a `name`, and an https `url`), `license` (an SPDX expression, or `first-party`), `researchedAt` (`YYYY-MM-DD`), `maintainer`, and optionally `attribution`, `derivation`, and `caveats`. |
| `budgets`       | Optional: JS, CSS, image, font, animation, and enhancement, each at most its axis's ceiling in `runtime-budgets.json`.                                                                             |

### A color scheme

Its colors come one of three ways, and only one:

- `light` and `dark`, each a set with every color role, as six-digit lowercase hex;
- `anchors` with `derivation: "anchor-v1"`: per mode, a `canvas`, `text`, `accent`, and `secondary`, from which the compiler derives every role;
- a `generator`, for #20's generated schemes.

A scheme with one of the two base modes is single-mode, and pins it; a stable scheme has both. `high-contrast` sets derive from the base ones (`high-contrast-v1`) unless the scheme authors `highContrast.light` and `highContrast.dark`. `swatches`, up to eight colors, is what a picker shows.

### A design language

`tokens` gives every `--ui-*` key a value, each held to its key's grammar and caps, and reaching color only through `var(--color-*)`. An optional `stylesheet`, such as `./styles.css`, styles the primitives' `data-ui-slot` parts and their states, and nothing else: the reader takes a small subset of CSS, sets only the properties a language owns, takes colors only as `var(--color-*)`, keeps lengths within 64px or 4rem and radii within 999px, and refuses `@import`, `@font-face`, `:root`, `html`, `body`, `!important`, color literals, and generated content. The compiler writes the rules back out inside `@scope ([data-design-language="<id>"]) to ([data-appearance-boundary])`, from what it read, so nothing in the file can reach outside its boundary. `enhancements` takes the same declarations a variant's manifest does.

### A typography profile

`roles` gives each of the ten roles all six fields: a font stack ending in a generic family, a rem size up to 16rem, a weight, a unitless line height, a letter spacing in em, and variation settings. `measures` gives `body` and `compact` in `ch`. `scripts` lists the ISO 15924 codes every role covers. `fontAssets`, up to 32, are the `.woff2` files it ships, each with its `family`, `weight` (or a range), `style`, and the `unicodeRange` it covers, so a browser downloads it only for text that uses it. The compiler namespaces each family as `"<pack id> <family>"` and writes `font-display: swap`.

## Building, checking, and installing

Install a pack the way you install a variant: `pnpm --filter @portfolio/web add <package or tarball>`. Registry generation, which every build runs, validates each pack's manifest, compiles it into one stylesheet in its layer, writes that file by content hash to `/_portfolio/pack/` and each font to `/_portfolio/font/`, and lists them in the registry the host reads. The host links only the selected packs' stylesheets, with the platform's, on each page. A pack that doesn't validate or compile stops the build with a diagnostic naming the package, the file, the pointer, and the fix, in the same codes a variant's manifest uses.

`pnpm check:appearance` then gates what registered: the computed contrast of every design language, color scheme, typography, and display mode combination against the targets in `quality/thresholds.json`, each scheme's hierarchy (its accent states and quieter text roles stay apart), and the layer order of every layered stylesheet. CI runs it on every pull request, and a combination under its targets fails the run.

It also runs the appearance source audit over every variant package and `packages/kit/src`, so neither carries a palette, a font, or a material of its own. It refuses a color literal in a stylesheet or in a string in code (one built only from interpolated values, a color read from a boundary, is fine), a `font-family` or `font` that isn't a `var(--type-*)`, an `@font-face`, an `@import`, and a shadow, nonzero radius, blur, or transition or animation time that isn't a token. It also refuses the retired `--paper`, `--ink`, `--kc-*`, and `--vt-*` properties. Each finding names its file, line, and fix. A file that has to break a rule, such as data in a third party's own colors, or a test fixture that's wrong on purpose, gets a reviewed exception in `packages/appearance/audit-exceptions.json`: its path, the rule, why, and who reviewed it. An exception no finding needs anymore fails the run too.

## What a variant does with all this

Arrange, and read the tokens. A variant's stylesheet sets spacing, grid, flow, sizing, and order; every color is a `var(--color-*)`, every border, radius, and shadow a `var(--ui-*)`, and every piece of text takes a role through `data-type-role`. Its own custom properties are `--layout-*` alone. It renders the shared primitives where it needs a control, a surface, or a disclosure, and lets the packs style them. [Building a variant](variants.md#styling-conventions) has the rules and the audit that holds a variant to them.
