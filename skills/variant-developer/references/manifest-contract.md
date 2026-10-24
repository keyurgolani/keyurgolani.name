# The variant manifest (contract 2.0)

> Every field of `manifest.json`, with valid values and examples. Loaded in
> Phase 1, when DESIGN.md summarizes the manifest, and in Phase 2 Wave 1,
> when you write it.

## Source of truth

The schema is `ManifestSchema` in `packages/variant-contract/src/manifest-schema.ts`, and `validateManifest()` in `validate-manifest.ts` checks the rules a shape can't. This reference paraphrases them; when the two disagree, the package is right.

`package.json` names the manifest:

```json
{
  "name": "@portfolio/variant-<id>",
  "exports": {
    ".": "./src/index.tsx",
    "./manifest": "./manifest.json",
    "./styles.css": "./src/styles.css",
    "./package.json": "./package.json"
  },
  "portfolio": { "kind": "variant", "manifest": "./manifest.json" }
}
```

Registry generation requires the `.` and `./styles.css` exports, and an export for each enhancement. Every object in the manifest is strict: a key the contract doesn't define is an error, never dropped.

## The smallest manifest

The fallback composition's, `packages/fallback-composition/manifest.json`, which `pnpm new-variant` copies:

```json
{
  "id": "fallback",
  "name": "Fallback composition",
  "promise": "Every section in content order, in one readable column.",
  "description": "The host's stand-in. ...",
  "contract": "2.0",
  "schemas": { "portfolio": { "min": 3, "max": 3 }, "site": { "min": 2, "max": 2 } },
  "tokenContract": 1,
  "compositionFamily": "document",
  "motionIntent": "still",
  "performanceTier": "light",
  "budgets": { "js": 2048, "css": 2048, "image": 0, "font": 0, "animation": 0, "enhancement": 0 },
  "renderedKinds": [],
  "unsupportedKinds": [],
  "contentSlots": [],
  "routes": { "home": "shared", "work": "shared", "views": [] },
  "controls": { "version": 1, "items": [], "migrations": [] },
  "visitorControl": { "placement": "header" },
  "textDirection": ["ltr", "rtl"],
  "provenance": { "provisional": true, "sources": [] }
}
```

## Identity

- **`id`** (required): `^[a-z][a-z0-9-]{1,47}$`, the id `site.yml`'s `appearance.variant` selects. `fallback`, the five composition ids (`editorial-evidence`, `kinetic-cosmos`, `obsidian-atelier`, `spatial-bento`, `horizontal-cinema`), and `missing-variant` are reserved for `@portfolio/*`. A package under another scope starts its id with the scope: `@acme/ocean` is `acme-ocean`.
- **`name`** (required): plain text, up to 60 characters. Shown wherever the platform lists variants.
- **`promise`** (required): one sentence, up to 140 characters. The composition idea from DESIGN.md.
- **`description`** (required): up to 1000 characters.
- **`author`** (optional): up to 100 characters.
- **`homepage`** (optional): an https URL with no credentials.
- **`bestFor`** (optional): 1 to 8 tags, each up to 60 characters, such as `"long-form writing"`.

Text fields are plain text on one line: no `<` or `>`, no control characters, no padding.

## Versions

- **`contract`** (required): `"2.0"`. A host reads its own major and any minor up to its own; a newer minor or another major is refused, with the upgrade or pin that fixes it.
- **`schemas`** (required): `{ "portfolio": { "min", "max" }, "site": { "min", "max" } }`, the document versions the variant reads. Each range must include the host's: portfolio version 3 and site version 2.
- **`tokenContract`** (required): the appearance token contract the variant reads: `1`, the one `@portfolio/appearance` defines (#19). It must equal the host's.

## Character

- **`compositionFamily`** (required): `monograph`, `kinetic`, `gallery`, `bento`, `sequence`, `document`, or `custom`.
- **`motionIntent`** (required): how much the composition moves. `still`, `subtle`, `kinetic`, `adaptive`, or `directed`. Under reduced motion, every one of them settles: see `quality-gates.md` Gate C.
- **`performanceTier`** (required): `light` (HTML and CSS), `medium` (one canvas or shader), or `heavy` (a three.js scene). Stay honest; heavy work belongs in an enhancement.

The five first-party compositions have pinned values: `editorial-evidence` is light and still, `kinetic-cosmos` medium and kinetic, `obsidian-atelier` light and subtle, `spatial-bento` heavy and adaptive, `horizontal-cinema` medium and directed.

## Budgets

**`budgets`** (optional): what the variant may ship, as integers in six kinds.

- `js`: gzip bytes of your package's own JavaScript a page downloads as it loads, your enhancements' chunks left out.
- `css`: gzip bytes of your compiled stylesheet, the kit's shared renderers' layout included.
- `image` and `font`: bytes of the image and font files you ship.
- `animation`: how many frame loops, recurring timers, and infinite animations an idle page runs, as `pnpm test:trace` counts them.
- `enhancement`: gzip bytes of your code in the chunks that hold one of your enhancements, each enhancement on its own.

A kind you leave out is your tier's ceiling in `runtime-budgets.json`'s `budgets` block: light, medium, and heavy each have one. `pnpm check:budgets`, which CI runs on a traced build, fails a declared budget over its ceiling, a unit over what it declares, and a stylesheet with an `@import` or `url()` to another host, each as a record naming the asset that carries the most of it. Declare what you measured, with room to grow, so a regression shows up as yours.

## Stills

**`stills`** (optional): your catalog stills, one to four, the largest first. Each is `{ "file": "./stills/1440.webp", "width": 1440, "height": 900 }`: a PNG or WebP in your package, one frame (an animated WebP or an APNG is refused), by a relative path in lowercase, at most 256 KB, between 160x100 and 2880x2880, whose pixels are exactly the width and height you declare. A catalog plate shows the still before, and instead of, a live preview of your variant, as a plain `<img>` with its width and height, so the page doesn't shift as it loads. Registry generation checks each file, copies it by content hash to `/_portfolio/still/<id>.<sha256-12>.<ext>`, and lists it in `ASSET_MANIFEST`. Stills count toward your `image` budget.

`pnpm stills` shoots them for you: after `pnpm build`, it renders each registered variant on the `complete` contract fixture at 1440x900 under reduced motion, in Chromium, and writes `stills/1440.webp` and `stills/720.webp` into its package; `--variant <id>` shoots fewer. Commit them, and list them in the manifest.

## Coverage

- **`renderedKinds`** (required): the kinds your variant renders bespoke. Each needs a renderer in the map you pass `renderSection`, and each renderer needs its kind here: a mismatch throws.
- **`unsupportedKinds`** (required): the kinds your composition deliberately doesn't show. Their sections render nothing, and the compatibility report warns the owner (`kind.unsupported`). DESIGN.md says why.

A kind in neither list renders through the kit's shared renderer, so the visitor always gets the content. The two lists can't overlap. Each entry is a core kind or an extension kind, `<package>/<name>`.

## Content slots

**`contentSlots`** (required, up to 32): the places the composition needs content, so Studio can say what's missing.

- `id`, `label`: the slot's name and its plain-text label.
- `select`: what fills it. `{ "kind": "works" }`, `{ "control": "featured" }`, or `{ "field": "/works/*/cover" }`, a JSON pointer into the published view's portfolio where `*` matches any array index.
- `level`: `required`, `recommended`, or `optional`.
- `min`, `max`: how many items.
- `whenEmpty`: `{ "mode": "omit" | "keep", "note": "..." }`, what the composition does without it.

The compatibility report counts each slot: the visible sections of its kind, the visible sections or records its control points at, or the values its field holds, an array counting each item. A required slot below `min` blocks publishing (`slot.required-empty`), an empty recommended one warns (`slot.recommended-empty`), and more than `max` warns, with the extras rendering after the slot (`slot.overflow`). An empty optional slot shows in the report alone. The note goes to the owner word for word, so write it for them.

## Routes

**`routes`** (required): `{ "home": "bespoke" | "shared", "work": "bespoke" | "shared", "views": [...] }`. The host owns every route; this says which it renders through your component. A work's own page, `/work/<slug>`, renders in yours only with `"work": "bespoke"`, where `routedWork(input)` is the work; with `"shared"`, the host renders it through the fallback composition, its case study as the page's one h1 (#10b). Views you declare under `work` render in yours either way.

Each view (up to 16) is `{ "id", "under": "home" | "work", "type": "path" | "fragment", "segment" }`. A path view's first segment can't be one the host reserves (`studio`, `api`, `_next`, `_fixtures`, `sample`, `reference`, `preview`, `preview-assets`, `work`, `admin`, `variants`, `assets`, which answers 404, `media`, where the site's image renditions serve, `robots.txt`, `sitemap.xml`, `feed.xml`, the icon and image routes, with or without the six-character suffix Next adds inside a route group, such as `opengraph-image-12o0cb`, and `manifest.webmanifest`), and two views can't claim the same address.

The host renders a path view below its parent route, from the server, with a canonical link to the parent and no sitemap entry. A placeholder takes lowercase words joined by hyphens, at most 64 characters, and the view renders for any value that fits, so render something sensible for one that names nothing. A path only another installed variant declares is a 307 to its parent route, and anything else is the 404 page. Link to any route with `routeHref(input, target)`, which keeps `/sample`'s `?variant=` and #7's preview prefix.

## Controls

**`controls`** (required): `{ "version", "items", "migrations" }`. Owner-tunable composition choices, stored in `site.yml` under `variantControls.<id>` and handed to you, defaults filled in, as `input.controls`.

Each item has a camelCase `id`, a `label`, a `description`, and a `default`, by type:

- `boolean`.
- `enum`: 2 to 24 `options`, each `{ "value", "label" }`.
- `integer`: `min`, `max`, `step`.
- `contentRef`: the id of a visible section, or of a visible record, a work, evidence, or chronology entry, which counts as the kind of section that lists it. Optionally limited to `kinds`. Default `null`.
- `contentRefList`: up to `max` such ids, at least `min`. Default `[]`.

**Controls change composition only**: layout, order, emphasis, interaction. A control that reads as choosing a palette, a color, type, a material, a shape, a display mode, or motion timing is refused (`manifest.controls-appearance`); #19 owns those.

When you change a control incompatibly, bump `version` and add a migration from each old version to the next, of `rename`, `mapValue`, `clamp`, and `drop` operations. Values stored at another version aren't read: every control renders its default, with a `controls.stale` warning, until the owner migrates or sets them again.

## Enhancements and key bindings

- **`enhancements`** (optional, up to 8): client islands the page reads without. Each is `{ "id", "export": "./enhancements/<name>", "requires": [...] }`, where `export` is a subpath in `package.json` `exports` and `requires` lists up to 4 of `webgl2`, `fine-pointer`, `motion-allowed`, and `min-width:<px>`. Render one with `<Enhancement input={input} id="<id>" />` from `@portfolio/kit/enhancements`, and reserve its space.
- **`keyBindings`** (optional, up to 16): `{ "region", "keys", "action" }`. Keys are lowercase letters, digits, arrow keys, `PageUp`, `PageDown`, `Home`, or `End`; Tab, Escape, Enter, Space, function keys, and modifier shortcuts are reserved.

## Presentation

- **`visitorControl`** (required): `{ "placement": "header" | "navigation" | "footer" }`, where your one `<VisitorControlSlot />` sits. #19 fills it.
- **`textDirection`** (required): `["ltr"]` or `["ltr", "rtl"]`. Declaring `rtl` brings the audit's logical-property rule. Without it, right-to-left content warns the owner (`direction.unsupported`).
- **`recommendedAppearance`** (optional): an appearance recipe id from #19's catalog, which Studio suggests with the variant. One the build doesn't list warns (`appearance.unknown-recipe`), once #20 lists recipes.

## Provenance

**`provenance`** (required): `{ "provisional": true | false, "sources": [...] }`. What the variant came from, and what became of each part: `{ "source", "disposition", "note" }`, where `disposition` is `preserved`, `folded-into-pack` (it moved to an appearance pack), `reused-interaction`, or `retired`. A retired source needs a note.

## What v1 fields became

A manifest that still has a v1 field is refused with where it went:

| v1 field                                                    | Now                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `slug`                                                      | `id`                                                                             |
| `tagline`                                                   | `promise`                                                                        |
| `aesthetic`                                                 | `compositionFamily`                                                              |
| `motion`                                                    | `motionIntent`                                                                   |
| `supportedKinds`                                            | `renderedKinds`, with every other kind shared                                    |
| `version`                                                   | the package's `package.json` version                                             |
| `authorUrl`                                                 | `homepage`                                                                       |
| `density`                                                   | gone: density is the composition itself                                          |
| `typography`, `themes`, `colorSchemes`, `typographyPresets` | gone: the appearance system (#19)                                                |
| `capabilities`                                              | gone: `multiPage` is `routes`, `rss` is `features.feed`, print is a fixture mode |
| `screenshots`                                               | gone: the contract fixtures render them                                          |

## Diagnostics

`pnpm check:variants` and every build report each problem with the package, its version, the manifest path, a JSON pointer, the code, what was expected and found, and the fix. The manifest codes: `manifest.invalid`, `manifest.missing`, `manifest.unknown-key`, `manifest.duplicate`, `manifest.unknown-ref`, `manifest.contract-unsupported`, `manifest.contract-newer`, `manifest.schemas-unsupported`, `manifest.token-contract-mismatch`, `manifest.id-reserved`, `manifest.id-prefix`, `manifest.first-party-pin`, `manifest.kinds-overlap`, `manifest.route-reserved-segment`, `manifest.route-conflict`, `manifest.controls-appearance`, `manifest.controls-migration-gap`, `manifest.enhancement-missing-export`, `manifest.key-binding-reserved`, `manifest.provenance-note-required`, and `manifest.recipe-unknown`, the one warning. Registry generation adds `registry.*` codes for the package around the manifest: a missing export or file, a duplicate id, and the like.
