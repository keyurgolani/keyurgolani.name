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

Set text in a role with `data-type-role="<role>"` on the element, and the platform stylesheet, which carries the primitives' rules, typesets it from those tokens. Under reduced motion the state transforms read `none`, entrances and exits fade, and the emphasis motion is `none`; the durations stay as they are, and only `static`, a plate or a paused page, zeroes them. So a variant that takes its timing and movement from the tokens needs no motion query of its own, and a keyframe animation of its own stops under `[data-variant='<id>']:is([data-motion='reduced'], [data-motion='static'])`.

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

`kind` is `design-language`, `color-scheme`, or `typography`, and `packs` is a directory with one folder per pack, each holding a `manifest.json` and any files it names. A pack package ships no CSS outside what its manifest declares, since the compiler writes every rule, and no JavaScript at all: a package that exports a script, or a pack directory holding a `.js`, `.mjs`, `.ts`, `.wasm`, `.html`, or `.svg` file, stops the build.

A Research record, a reviewed candidate that doesn't ship, is `research/<id>.json` beside `packs/`: its `id`, `name`, `kind`, `tier: "research"`, `source` (a `name`, and a `url` or `null`), what's known of its `license` (`unverified` until someone checks), `researchedAt`, the `reason` it doesn't ship, and optionally a palette's `anchors`. Registry generation never reads `research/`, so a record is never registered, selectable, published, exported, or bundled, and selecting its id is `appearance.unavailable`. The build job's `pnpm check:catalog-build` fails when a Research id reaches the generated modules, `ASSET_MANIFEST`, any `.next/static` chunk, or the build output the image ships. Promoting one is its own owner-approved pull request that turns it into a pack.

### Every pack

Each manifest is strict, so a key the contract doesn't define is an error, never ignored, and each error names the pack, its axis, and the field.

| Field           | What it is                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Lowercase letters, digits, and hyphens, unique across every variant and pack. A package under a scope starts its pack ids with it, as `@acme` does with `acme-tide`, and only `@portfolio/*` may take a fallback's id.                                                                                                                                                                         |
| `name`          | Plain text, up to 60 characters. No two packs on one axis share one.                                                                                                                                                                                                                                                                                                                           |
| `description`   | Plain text, up to 1,000 characters.                                                                                                                                                                                                                                                                                                                                                            |
| `version`       | The pack's own semver, `major.minor.patch`. The catalog lock pins it beside the pack's content digest.                                                                                                                                                                                                                                                                                         |
| `tokenContract` | `1`. A pack for another contract's tokens is refused rather than misread.                                                                                                                                                                                                                                                                                                                      |
| `tier`          | `stable`, `extended`, or `experimental`, each meeting the same contract. Only `@portfolio/*` packs can claim `stable`, and `research` is a record's, never a pack's.                                                                                                                                                                                                                           |
| `provenance`    | `source` (a `name`, and an https `url`), `license`, `attribution`, `researchedAt` (`YYYY-MM-DD`), `maintainer`, `copyright`, the upstream copyright line, which a pack under an upstream license gives as its license file does, and optionally `derivation`, how it was made, and `derivedFrom`, the work a derived counterpart comes from, which takes a distinct `name` and a `derivation`. |
| `modes`         | The base modes it covers: `["light", "dark"]` for a language or a profile, and a scheme's own.                                                                                                                                                                                                                                                                                                 |
| `lockedMode`    | A single-mode scheme's native mode, which every display mode locks to. Only a single-mode scheme has one, and only Extended and Experimental take a single-mode scheme.                                                                                                                                                                                                                        |
| `accessibility` | `checks`, exactly the gates its axis is held to (a language `contrast`, `focus-ring`, and `stylesheet-lint`; a scheme `contrast` and `hierarchy`; a profile `contrast` and `text-size`), and optionally `notes` from a review by hand.                                                                                                                                                         |
| `cost`          | The `assets` it ships and their `assetBytes`, which the pack gates check against what compiles.                                                                                                                                                                                                                                                                                                |
| `budgets`       | JS, CSS, image, font, animation, and enhancement, each at most its axis's ceiling in `runtime-budgets.json`. `js` and `enhancement` are `0`.                                                                                                                                                                                                                                                   |
| `fallbacks`     | What renders where something the pack uses is unavailable, one to eight lines.                                                                                                                                                                                                                                                                                                                 |
| `caveats`       | Known cost or usability caveats, as text, up to sixteen. An accessibility shortfall is never a caveat.                                                                                                                                                                                                                                                                                         |

A pack's `license` is one of the license states, `first-party` (this repository's MIT, for `@portfolio/*` packs only), `independent-inspired-interpretation` (an `-inspired` id and an Inspired name, adapting a system's principles without implying endorsement or conformance), `provided-by-operating-system` (a typography profile that ships no font file), or `generated` (a generator scheme), or an upstream `OFL-1.1`, `Apache-2.0`, or `MIT`. Any other license keeps a valid pack out of the build: registry generation leaves it out, serves none of its files, warns with the license it found, and selecting it renders its axis's fallback with that reason.

### A color scheme

Its colors come one of three ways, and only one:

- `light` and `dark`, each a set with every color role, as six-digit lowercase hex;
- `anchors` with `derivation: "anchor-v1"`: per mode, a `canvas`, `text`, `accent`, and `secondary`, from which the compiler derives every role;
- a `generator`, for #20's generated schemes.

A scheme with one of the two base modes is single-mode, and pins it; a stable scheme has both. `high-contrast` sets derive from the base ones (`high-contrast-v1`) unless the scheme authors `highContrast.light` and `highContrast.dark`. `swatches`, up to eight colors, is what a picker shows.

### A design language

`tokens` gives every `--ui-*` key a value, each held to its key's grammar and caps, and reaching color only through `var(--color-*)`. An optional `stylesheet`, such as `./styles.css`, styles the primitives' `data-ui-slot` parts and their states, and nothing else: the reader takes a small subset of CSS, sets only the properties a language owns, takes colors only as `var(--color-*)`, keeps lengths within 64px or 4rem and radii within 999px, and refuses `@import`, `@font-face`, `:root`, `html`, `body`, `!important`, color literals, and generated content. The compiler writes the rules back out inside `@scope ([data-design-language="<id>"]) to ([data-appearance-boundary])`, from what it read, so nothing in the file can reach outside its boundary.

The stylesheet is untrusted input, so the reader parses it, and the pack CSS lint names the rule each refusal breaks: `url` (no `url()`, `src()`, `image-set()`, `image()`, `cross-fade()`, or `element()`, since a language declares no asset), `import`, `layer-scope` (no `@layer` or `@scope` of its own), `universal` (no `*`), `prefixed-names` (`@keyframes`, `@counter-style`, and `view-transition-name` start with the pack's id, though the reader refuses all three anyway), `focus-outline` (nothing removes an outline, and a focus rule draws no `box-shadow` ring), and `javascript` (no `expression()`, `javascript:` URL, `behavior`, or `-moz-binding`). A rule holds in any case, behind a comment, and behind a `\` escape: the reader refuses every escape, then reads the stylesheet as a browser decodes it and names any rule the escape hid. Each rule has a known-bad input, `packages/appearance/test/fixtures/lint-<rule>/`, that `pnpm check:appearance` requires to fail for that rule.

### A typography profile

`roles` gives each of the ten roles all six fields: a font stack ending in a generic family, a rem size up to 16rem, a weight, a unitless line height, a letter spacing in em, and variation settings. `measures` gives `body` and `compact` in `ch`. `scripts` lists the ISO 15924 codes every role covers. `fontAssets`, up to 32, are the `.woff2` files it ships, each with its `family`, `weight` (or a range), `style`, and the `unicodeRange` it covers, so a browser downloads it only for text that uses it. The compiler namespaces each family as `"<pack id> <family>"` and writes `font-display: swap`.

## Building, checking, and installing

Install a pack the way you install a variant: `pnpm --filter @portfolio/web add <package or tarball>`. Registry generation, which every build runs, validates each pack's manifest, compiles it into one stylesheet in its layer, writes that file by content hash to `/_portfolio/pack/` and each font to `/_portfolio/font/`, and lists them in the registry the host reads. The host links only the selected packs' stylesheets, with the platform's, on each page. A pack that doesn't validate or compile stops the build with a diagnostic naming the package, the file, the pointer, and the fix, in the same codes a variant's manifest uses.

`pnpm check:appearance` then gates what registered: the computed contrast of every design language, color scheme, typography, and display mode combination against the targets in `quality/thresholds.json`, each scheme's hierarchy (its accent states and quieter text roles stay apart), and the layer order of every layered stylesheet. CI runs it on every pull request, and a combination under its targets fails the run. A failure excludes one pack, never a pair: a focus ring's width and a translucent surface's backdrop are the design language's, and every other pair the color scheme's.

It also runs the per-axis pack gates over every compiled pack: token coverage (every block that sets an axis's tokens sets all of the contract's roles), bundle size (the stylesheet within the pack's `css` budget in gzip bytes, the fonts within `font`, and `cost` what ships), and boundary isolation (one layer, the axis's; every rule on the pack's own boundary attribute; a language's own rules in its one `@scope`; and every `url()` one of its own fonts). It checks the catalog lock, `packages/appearance/appearance-catalog.lock.json`, which pins each first-party pack's version, tier, license, and content digest: a pack whose files changed without a version bump fails, and so does a lock that is stale or out of its canonical form. In CI, `CATALOG_LOCK_BASE=HEAD^1` holds it to the lock at the change's base too, so a pack changed with its lock edited to match, at the version the base pins, still fails, and so does a version below the base's. `pnpm catalog:lock` writes it, with `apps/web/public/third-party-notices.txt`, which has to be current too: a notice for every pack a production registry registers under an upstream license, an installed third party's too, with its source, attribution, and copyright line, the MIT permission notice under an MIT pack's, and the full Apache-2.0 or OFL-1.1 text once after the notices. The lock pins first-party packs alone, since `pnpm-lock.yaml` pins an installed one. And it checks every Research record's shape and that its id is no pack's or variant's. Last, the branded-name audit (`apps/web/scripts/catalog-audit.ts`) reads every shipping pack and Research record for the brands, systems, palettes, and typefaces it names: a pack names one in its id or name only as an `-inspired` interpretation or under that brand's own upstream license, credits any it names in its description, never shares two anchor colors in a mode with a Research record, or with an upstream palette it doesn't credit under that palette's license and copyright line (`apps/web/scripts/upstream-palettes.json`, Tailwind CSS v3.4.17's scales today), and, for a typography profile, is never named for a typeface its stacks reference. In CI each finding is a failure record naming its pack and axis, and its token role, display mode, and tuple where it has them.

`pnpm catalog` reads the same registry and prints the catalog: `pnpm catalog search 'q=sage&axis=scheme&tier=stable'` lists what a query matches, by axis and tier, with filters `q`, `axis` (`language`, `scheme`, or `type`), `tier`, `status` (`shipping`, `excluded`, `held`, or `research`), `license`, and `mode`; `pnpm catalog show <id>` gives one entry's tier, provenance, and whether this build can select it, or why not; `pnpm catalog recipe [<id>]` applies a recipe from `packages/appearance/appearance-recipes.json` as the five ordinary axis ids it stands for, with their query and a diagnostic for each id this build doesn't register; and `pnpm catalog audit` prints the branded-name audit. The shipping packs, the Research records, and the recipes were seeded once from the reviewed prototype's catalog, copied byte for byte to `scripts/catalog/seed/`, by `pnpm catalog:seed`, which never writes over a file. The manifests are canonical now.

A pack that fails its gate with no fix in scope is held: its manifest stays as seeded in its package's `held/<id>/manifest.json`, which registry generation never reads, beside a `gate.json` that `pnpm catalog:held` writes from the gate, with the failing checks, every failing role pair at its worst with its target and scheme, and, for a translucent language, the least surface opacity that passes. `pnpm check:appearance` prints each held pack with its reason, and fails when one is registered, when its record is stale, or when it passes now, so it can be promoted. The production build check holds a held id to what it holds a Research id to, and `pnpm catalog search 'status=held'` lists them.

Pull requests run each changed pack's gates against every registered variant, and each changed variant against every stable design language, as #11's change-directed quality cells; a generator scheme, which renders only from a site's input, is held to its pack gates instead. Every night, the scheduled workflow's `catalog-full` job runs the whole registered cross-product, every variant, design language, color scheme, typography profile, and display mode, in four shards, in two parts. The static smoke (`pnpm test:catalog-static`) checks every tuple in Node, with no browser: it resolves, its packs' compiled files are the ones registry generation hashed, each pack passes its pack gates, and the contrast table passes for its language, scheme, and profile in its mode. The browser smoke (`pnpm test:catalog`) loads a wider sample under the demo profile, each tuple with a screenshot: every shipping pack at least once per variant and per display mode, and a seeded draw (`CATALOG_SEED`) from each shard's own tuples up to its budget. Both take `CATALOG_SHARD=<n>/<m>`. Each part has a budget of tuples per shard in `tests/catalog/plan.ts`, sized from measured rates, and the job's timeout is its fixed part and both parts at budget, twice over; a plan over budget fails before anything runs, with "catalog-full plan exceeds N tuples per shard". The full browser cross-product, with its stored artifacts, is #20 PR 3's one-time sharded rehearsal.

It also runs the appearance source audit over every variant package and `packages/kit/src`, so neither carries a palette, a font, or a material of its own. It refuses a color literal, any of CSS's named or system colors where a color goes or among a gradient's stops, in a stylesheet or in a string in code (one built only from interpolated values, a color read from a boundary, is fine), a `font-family` or `font` that isn't a `var(--type-*)`, an `@font-face`, an `@import`, and a shadow, nonzero radius, blur, or transition or animation time that isn't a `var(--ui-*)`. A `var()` passes only for the right token, or a `--layout-*` property whose every value in the file passes and which the package's code doesn't set, and its fallback is held to the same rule. In a variant's stylesheet, and as a style key or a `setProperty()` in its code, it refuses any custom property of the variant's own but a `--layout-*` one, and everywhere the retired `--paper`, `--ink`, `--kc-*`, and `--vt-*` properties. A declaration counts across every line it's written on, with or without a `-webkit-` or `-moz-` prefix, and in code a string under a style key such as `boxShadow` or `transition` or set with `setProperty()`, a style attribute's text, and a stylesheet in a string all meet the same rules. Each finding names its file, line, and fix. A file that has to break a rule, such as data in a third party's own colors, or a test fixture that's wrong on purpose, gets a reviewed exception in `packages/appearance/audit-exceptions.json`: its path, the rule, why, and who reviewed it. An exception no finding needs anymore fails the run too.

## What a variant does with all this

Arrange, and read the tokens. A variant's stylesheet sets spacing, grid, flow, sizing, and order; every color is a `var(--color-*)`, every border, radius, and shadow a `var(--ui-*)`, and every piece of text takes a role through `data-type-role`. Its own custom properties are `--layout-*` alone. It renders the shared primitives where it needs a control, a surface, or a disclosure, and lets the packs style them. [Building a variant](variants.md#styling-conventions) has the rules and the audit that holds a variant to them.
