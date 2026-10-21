# Configuration

This open-source platform is configured by two documents and the deployment's environment:

- **`portfolio.yml`** holds the content: who you are, what you've done, and the sections of the page. It's portable. Nothing in it is about one site or one deployment.
- **`site.yml`** holds the presentation and product behavior: the appearance, what visitors may change, motion, features, and which sections are hidden.
- **The environment** holds the deployment settings and every secret: the profile, the origin, where the documents are, proxy trust, and credentials. [deployment.md](deployment.md#environment-variables) lists them. Neither document may hold one.

Both documents live in one directory: `config/` in a checkout, `PORTFOLIO_SOURCE_DIR` in a deployment. Start from `portfolio.example.yml` and `site.example.yml` at the repository root. The `demo` profile renders those two examples and reads no directory.

## Files and formats

- Each document is YAML (`.yml` or `.yaml`) or JSON (`.json`), and the two may differ. The directory holds exactly one of each. A missing document is `source.missing`, one in two formats is `source.duplicate`, and one the server can't read is `source.unreadable`.
- Both declare `schemaVersion: 2`.
- A document is one plain YAML or JSON document. Anchors, aliases, merge keys, tags, directives, a second document, and a key repeated in one mapping are refused. A `.json` file must also be valid JSON.
- A document holds at most 1 MiB, nests at most 64 levels, and has at most 10,000 entries in one mapping or list.
- Every object refuses a key its schema doesn't define, and the message names the closest allowed key. The only open places are values under `extensions` and under `variantControls.<variant>.values`, which hold plain JSON nested at most 8 levels.
- Every number is finite: YAML's `.inf` and `.nan` are refused wherever a number goes.
- Key order in a mapping doesn't matter. `pnpm config:migrate` writes keys in the schema's order.
- Every `url`, `src`, and `*Url` field takes an `https`, `http`, `mailto`, or `tel` URL, a relative reference such as `/resume.pdf`, `resume.pdf`, or `../x` (but not `//host`), or a `#fragment`, with no unencoded space or control character. An image `src` may also be a `data:image` URL in png, jpeg, gif, webp, or avif.
- No string in either document may look like a GitHub token, a PEM private key, a PHC or bcrypt password hash, or an AWS access key ID (`secret.detected`). Documents never read environment values, so a secret in one was pasted there. Remove it and revoke it.

## The portfolio document

| Field           | Required | Holds                                                                                                                           |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | yes      | `2`.                                                                                                                            |
| `locale`        | yes      | The content's BCP 47 language tag, such as `en` or `pt-BR`. It sets `<html lang>` and the feed's `<language>`.                  |
| `direction`     | yes      | `ltr` or `rtl`. It sets `<html dir>`.                                                                                           |
| `identity`      | yes      | `name`, the one required field, and `tagline`, `pronouns`, `location`, `email`, and `avatar` (an image).                        |
| `links`         | no       | `{ url, label?, platform? }` each, in display order. `platform` picks an icon, such as `github` or `website`. Defaults to none. |
| `meta`          | no       | `title`, `description`, and `ogImage` for the page's metadata.                                                                  |
| `sections`      | no       | The page, in order. Defaults to none, but a portfolio with no visible section can't go live (`content.empty`).                  |

An image is `{ src, alt?, width?, height?, credit?, focalPoint? }`, where `focalPoint` is `{ x, y }` between 0 and 1. A date is `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `Month YYYY`, or `present`, and a period is `{ start, end? }` that doesn't end before it starts.

### Sections

Every section has a `kind` and an `id`, and may have a `title`, a `subtitle`, and a `lang` for a section in another language than `locale`. Its other fields depend on its kind. There are 28 core kinds:

`hero`, `lede`, `now`, `experience`, `education`, `projects`, `writings`, `publications`, `talks`, `awards`, `episodes`, `patents`, `gallery`, `discography`, `testimonials`, `press`, `quote`, `skills`, `stack`, `services`, `contact`, `cta`, `stats`, `focus`, `fun-facts`, `tenure`, `external-portfolios`, and `github`.

None of them assumes a profession. A photographer's `gallery`, a musician's `discography`, a podcaster's `episodes`, and an academic's `publications` sit beside `experience` and `projects`, and a practice the core kinds don't cover adds its own through an [extension](#extensions). [`skills/portfolio-author/references/schema.md`](../skills/portfolio-author/references/schema.md) lists each kind's fields. `packages/schema/src/kinds/` is the source of truth.

### Ordering

- `sections` is the page order in every variant. The navigation follows it, listing the sections that have a `title` apart from `hero` and `cta`. A variant may cap how many it lists.
- `links` and the items in a section keep the order you write. A variant may still lay dated items out by date, as a timeline does, and the feed lists writings, publications, and episodes newest first.
- The site document can hide a section but can't move one.

### Stable identity

A section's `id` is its identity. It's the rendered section's DOM id, the `#fragment` navigation and links point to, and the key the site document uses for it.

- It's lowercase letters and digits in hyphen-separated words, such as `get-in-touch`, at most 64 characters.
- It's unique within the portfolio (`id.duplicate`), and it can't be `main`, which every variant gives its `<main>` element.
- Keep it stable. Renaming one breaks every `#old-id` link in the portfolio (`anchor.broken`) and every site document entry under the old id (`ref.missing`), and outside links to it stop landing on the section.

A stats item can name its figure with a `metric` key, such as `years-experience`, and a `tenure` section's `years` is the metric `tenure-years`. One metric with two values is `metric.conflict`. The same value shown in two visible sections is a `metric.duplicate` warning.

### Optionality

An optional field can be left out. There's no `null`: leave the key out instead. A blank `identity.name`, section `title` or `subtitle`, or hero `name` is refused, since it would show as nothing. What renders in place of a field left out depends on the field:

- A section without a `title` gets the heading its variant gives the kind, such as Awards or Get in touch, and some kinds, such as a lede, get none. The navigation lists only sections with a `title`.
- A hero without `name` or `tagline` shows `identity.name` or `identity.tagline`.
- Without `meta.title`, the page title is `identity.name` followed by Portfolio. Without `meta.description`, the description is `identity.tagline`.
- A `github` section shows every part but the language breakdown unless you turn one off: `showContributionGraph`, `showPinnedRepos`, `showTotalStars`, and `showRecentlyActive` default to `true`, and `showLanguageBreakdown` to `false`. The contribution graph needs a token, so public pages never show it. It lists 10 recently active repositories (`recentlyActiveLimit`, 1 to 20), and features or excludes none (`featuredRepos`, `excludeRepos`).
- `links` and `sections` default to empty lists.

## The site document

| Field              | Required | Holds                                                                                                          |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`    | yes      | `2`.                                                                                                           |
| `appearance`       | yes      | The published appearance: `variant`, `designLanguage`, `colorScheme`, `typography`, and `displayMode`.         |
| `visitorControls`  | yes      | `locked` or `selectable` for each of those five fields.                                                        |
| `motionPolicy`     | yes      | `respect-os` or `reduce`.                                                                                      |
| `features`         | yes      | `feed`, which serves `/feed.xml`, and `productAttribution`, which defaults to `false` and has no renderer yet. |
| `sections`         | no       | `{ hidden }` per section id.                                                                                   |
| `appearanceInputs` | no       | Input for a generated color scheme, per scheme id: a `seedColor` (`#rrggbb`) or a `sourceAsset` id.            |
| `routes`           | no       | `{ enabled }` per route id.                                                                                    |
| `variantControls`  | no       | A `version` and the variant's own `values`, per variant id.                                                    |

### Appearance

The appearance names a composition, three appearance axes, and a display mode. The axes are #19's (appearance axes); until it ships:

- **`variant`** is the composition: which installed variant package lays out the page, by its manifest's id. This build registers only the fallback composition, which a site can't select (`variant: fallback` is `schema.invalid`). Any other id renders as the fallback composition, with a `variant.unavailable` warning at startup and in `config.status`, until a package with that id is installed. The example's `editorial-evidence` arrives with #13.
- **`designLanguage`** is the component style. Use `platform-neutral`.
- **`colorScheme`** is the palette, such as `warm`.
- **`typography`** is the type preset, such as `classic`.
- **`displayMode`** is the theme a visit starts in: `system`, `light`, `dark`, or `high-contrast`. `system` follows the visitor's `prefers-color-scheme`, and `high-contrast` starts at `system` until #19 renders it.

This build records the design language, color scheme, and typography without checking them, and lists them as not checked. #19's catalog checks them, as `appearance.unknown` with the ids it registers, and nothing will fall back to a default in an unknown one's place.

### Visitor controls

`visitorControls` says which of the five appearance fields a visitor may change for themselves: `locked` keeps the published value, and `selectable` lets them pick another. All five are required. This release checks the values but doesn't apply them yet: they take effect with #19's visitor control, which renders in each variant's slot for it. Until then visitors can't pick a variant, design language, color scheme, or typography preset, and no variant renders a theme toggle.

### Motion

`respect-os` follows each visitor's `prefers-reduced-motion` setting, and `reduce` reduces motion for every visitor. Under `reduce` nothing on the page animates: no entrance, nothing that repeats, and a navigation link jumps to its section instead of scrolling there. A visitor's own reduce setting does the same under `respect-os`, except that the page learns it only once it has loaded, so a hero can still fade in once, without moving. Neither a variant nor a component can override the site's `reduce`.

### Hidden sections

```yaml
sections:
  patents:
    hidden: true
```

A hidden section stays in the portfolio and out of everything visitors get: the page, its RSC payload, its metadata and JSON-LD, the feed, and the Open Graph image. An entry for an id the portfolio doesn't have is `ref.missing`, and a `#fragment` link to a hidden section is `anchor.broken`.

### What the site document can't hold

Deployment settings come from the environment. `deploymentProfile`, `profile`, `origin`, `canonicalOrigin`, `url`, `baseUrl`, `studio`, `previewOrigin`, `trustedProxies`, and `proxy`, at the top level or under `features`, are `site.deployment-setting`, and the remediation names the environment variable to use.

`appearanceInputs` belongs to #19's color scheme registry: this release checks its shape and lists its entries as not checked. `routes` and `variantControls` are checked against the selected variant's manifest when this build registers it, and listed as not checked when it doesn't. Another variant's control entries are kept as written, unchecked.

## Deployment settings and secrets

The environment holds everything that belongs to one deployment: `PORTFOLIO_PROFILE`, `PORTFOLIO_ORIGIN`, `PORTFOLIO_SOURCE_DIR`, proxy trust, and the secrets a profile needs. Each setting also takes `<KEY>_FILE`, the path of a file holding the value, such as a Docker secret. The canonical origin is a setting too, so every absolute URL the site builds comes from `PORTFOLIO_ORIGIN`, and the same pair can serve a staging and a production host.

## Extensions

A content extension is an npm package that adds fields and section kinds of its own. Its package name is its namespace.

Any object in either document may carry an `extensions` entry keyed by that name:

```yaml
identity:
  name: Rowan Hale
  extensions:
    '@acme/portfolio-photography':
      camera: Leica M6
```

An extension section's `kind` is `<package name>/<name>`. It has the base fields, `id`, `title`, `subtitle`, and `lang`, and its content under `data`:

```yaml
- kind: '@acme/portfolio-photography/exhibitions'
  id: exhibitions
  title: Exhibitions
  data:
    items:
      - { title: Low Tide, venue: Harbor Gallery, year: 2024 }
```

- Extension data is plain JSON. Each namespace's entry, and each section's `data`, nests at most 8 levels. One object's whole `extensions` mapping, every namespace together, holds at most 32 KiB as JSON, and so does one section's `data`.
- An extension adds keys only under its own namespace, so core fields keep their checks.
- Data from a package this build registers is checked by that package's schemas.
- Data from any other package is kept as written and checked only as plain JSON. Each use is an `extension.unregistered` warning, and none of it reaches visitors: not the page, its RSC payload, its JSON-LD, or the feed. Tools that rewrite a document, such as `applyEdits` and `serialize` in `@portfolio/schema`, keep it as it is.
- A registered package's sections render through the renderers its `./renderers` export provides, and render nothing without one. Its fields reach the variants in the public view.

### Adding a profession package

A profession package adds semantic content without changes to the schemas, the validator, or the variants:

1. Export the package's definition:

   ```ts
   import { z } from 'zod';
   import { defineContentExtension, UrlSchema } from '@portfolio/schema';

   const Exhibition = z
     .object({
       title: z.string(),
       venue: z.string(),
       year: z.number().int(),
       url: UrlSchema.optional(),
     })
     .strict();

   export const photography = defineContentExtension({
     namespace: '@acme/portfolio-photography',
     sections: { exhibitions: z.object({ items: z.array(Exhibition).min(1) }).strict() },
     fields: z.object({ camera: z.string().optional() }).strict(),
   });
   ```

   Every object schema in it must call `.strict()`, so a mistyped key is reported instead of dropped. `defineContentExtension` throws otherwise, and when the namespace isn't an npm package name.

2. Use its namespace in the documents. They validate before any build registers the package, with a warning at each use.
3. Install it as a dependency of `@portfolio/web` (`pnpm --filter @portfolio/web add <package>`), since the workspace doesn't hoist packages (`shamefully-hoist=false`). That registers it: its `package.json` declares `"portfolio": { "kind": "content-extension" }`, its `.` export default-exports the `defineContentExtension` result, whose namespace is the package's name, and an optional `./renderers` export maps each `<namespace>/<name>` kind to its renderer. The build checks all of it and refuses a package that doesn't fit, naming the package and the fix.

## Validation

One check runs in three places:

- **Startup.** Under `owner` and `read-only`, the server checks the mounted pair before it takes a request, under `pnpm dev` as in production. A blocking record stops it with exit code 1 and one `config.fatal` line per record, and warnings are logged as `config.warning`. Under `pnpm dev`, a `config/` holding neither document renders the bundled examples instead, and each edit is checked again on the next page load.
- **`pnpm config:validate [dir] [--origin <url>] [--json]`.** It checks `config/` by default. `--origin` checks links against the site's real origin, and `--json` prints the records themselves. It exits 1 when a record blocks the pair.
- **`node skills/portfolio-author/scripts/validate.mjs <dir>`** prints the same records for an authoring agent.

Startup also checks the deployment, which the pair alone doesn't show: in production under `owner` and `read-only`, it refuses the bundled sample's `identity.name`, and an origin on a reserved example domain. So a copy of the example passes validation and still won't start in production until its `identity.name` is your own. `pnpm config:validate` warns about the sample's name for that reason.

Each record has a code, a severity, the document, a JSON pointer, a line and column where the text has one, the section's id when it's inside a section, a message, and a remediation.

- **`blocks-preview`**: the pair can't render.
- **`blocks-publish`**: a draft preview (#7, #8) could render it, but it can't go live.
- **`warning`**: reported only.

Startup treats the mounted pair as live, so both blocking severities stop it, with two exceptions: live, `variant.unavailable` and `controls.*` only warn, since the fallback composition renders in place of an unregistered variant and a control falls back to its default. #3's publish still refuses them. Checks that can't run are listed as not checked: the origin checks without an origin, and the design language, color scheme, typography, and appearance inputs until #19.

| Code                      | Severity       | Meaning                                                                                                                                  |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `parse.syntax`            | blocks-preview | The text isn't one plain YAML or JSON document within the limits.                                                                        |
| `schema.invalid`          | blocks-preview | A value isn't what the schema expects, or a key isn't one it defines.                                                                    |
| `schema.version`          | blocks-preview | The document doesn't declare `schemaVersion: 2`.                                                                                         |
| `source.missing`          | blocks-preview | The directory has no portfolio or no site document.                                                                                      |
| `source.duplicate`        | blocks-preview | The directory holds one document in two formats.                                                                                         |
| `source.unreadable`       | blocks-preview | The server can't read a document, such as one without read permission, or a directory with its name.                                     |
| `legacy.document`         | blocks-preview | The portfolio is in the old one-file format, with or without a `site.yml`, or it's a `portfolio.toml`. Nothing else is reported with it. |
| `site.deployment-setting` | blocks-preview | The site document holds a deployment setting.                                                                                            |
| `appearance.unknown`      | blocks-preview | An appearance id the catalog doesn't register. This build's interim catalog checks only `displayMode`, which the schema already limits.  |
| `validator.failed`        | blocks-preview | A bug in the build, such as two extensions with one namespace, not in the documents.                                                     |
| `id.duplicate`            | blocks-publish | Two sections share an id.                                                                                                                |
| `ref.missing`             | blocks-publish | The site document names a section the portfolio doesn't have.                                                                            |
| `metric.conflict`         | blocks-publish | One metric has two values.                                                                                                               |
| `anchor.broken`           | blocks-publish | A `#fragment` link points at no visible section.                                                                                         |
| `secret.detected`         | blocks-publish | A string looks like a secret.                                                                                                            |
| `content.empty`           | blocks-publish | No section is visible.                                                                                                                   |
| `variant.unavailable`     | blocks-publish | The site selects a variant this build doesn't register. Live, it only warns, and the fallback composition renders in its place.          |
| `controls.invalid`        | blocks-publish | A control value the selected variant doesn't declare or accept. Live, it only warns, and the control renders its default.                |
| `controls.stale`          | blocks-publish | Control values stored at another version of the variant's controls. Live, it only warns, and every control renders its default.          |
| `controls.dangling-ref`   | blocks-publish | A control points at no visible section. Live, it only warns, and the control renders its default.                                        |
| `metric.duplicate`        | warning        | Two visible sections show one metric with the same value.                                                                                |
| `image.alt-missing`       | warning        | A gallery image with no alt text or caption, or a project screenshot with no alt text. `alt: ''` marks decoration.                       |
| `origin.sample`           | warning        | A link points at a sample address, such as a `.test` or `example.com` host.                                                              |
| `origin.stale`            | warning        | A link's host differs from the origin's only in its last label, like an old domain.                                                      |
| `extension.unregistered`  | warning        | Data from an extension this build doesn't register.                                                                                      |
| `route.unknown`           | warning        | A `routes` entry the selected variant doesn't have, which changes nothing.                                                               |
| `route.required`          | warning        | A `routes` entry that turns off the front page, which every site serves, so it's ignored.                                                |
| `sample.identity`         | warning        | From `pnpm config:validate` only: `identity.name` is the bundled sample's, which production refuses to start with.                       |

## Migrating from the one-file format

Earlier releases read one unversioned `portfolio.yml` that mixed content and appearance. This release is a clean break: there's no compatibility reader, and the server refuses the old file with one `legacy.document` record that names each old field and where it goes now. Convert it once:

1. Run `pnpm config:migrate config/portfolio.yml`. It's a dry run that prints each field it moves or fills in, the values it needs, the section ids it gives, the comments it can't keep, the new pair's diagnostics, a diff of the portfolio document, and the whole site document. It never changes the old file or writes over another.
2. Give each value it asks for with `--set`, such as `--set site.appearance.colorScheme=warm --set site.appearance.typography=classic`. Add `--drop-unknown` for keys the old schema ignored, and `--origin <url>` to check the links against the real origin.
3. Add `--write --out config/new`, and move the new `portfolio.yml` and `site.yml` into `config/`.
4. In the deployment's environment, unset `PORTFOLIO_PATH` and set `PORTFOLIO_SOURCE_DIR` to the directory that holds the pair, not the file. Unset `NEXT_PUBLIC_BASE_URL` and set `PORTFOLIO_ORIGIN`; the migration prints the old `meta.url` origin as a starting point. The server refuses to start while either old setting is set.
5. Run `pnpm config:validate config`, then start the server.

| Old field                   | New home                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`                   | `appearance.variant` in `site.yml`.                                                                                                                                                            |
| `theme`                     | `appearance.displayMode`. `bright` and `black` have no display mode, so the migration asks for one.                                                                                            |
| `motionPreference`          | `motionPolicy`. `full` becomes `respect-os`.                                                                                                                                                   |
| `colorScheme`, `typography` | `appearance.colorScheme` and `appearance.typography`, from `--set`. The old ids don't carry over.                                                                                              |
| `meta.url`                  | Removed. The origin is `PORTFOLIO_ORIGIN`.                                                                                                                                                     |
| `hidden: true` on a section | `sections.<id>.hidden` in `site.yml`. `hidden: false` is removed.                                                                                                                              |
| No section ids              | Each section gets an `id`: the anchors the old navigation linked to first, then the rest. `--set portfolio.sections.<n>.id=<id>` picks another.                                                |
| Not in the old format       | `locale: en` and `direction: ltr` unless the file has them, `designLanguage: platform-neutral`, visitor controls with the color scheme and display mode selectable, and `features.feed: true`. |

A `portfolio.toml` has to become YAML or JSON first. [deployment.md](deployment.md#migrating-from-the-one-file-format) covers the exit codes, a file holding something shaped like a secret, and running the migration in the image's build stage on a host without Node.
