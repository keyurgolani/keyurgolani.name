# Configuration

This open-source platform is configured by two documents and the deployment's environment:

- **`portfolio.yml`** holds the content: who you are, the body of work, and the sections that place it. It's portable. Nothing in it is about one site or one deployment.
- **`site.yml`** holds the presentation and product behavior: the appearance, what visitors may change, motion, features, and which sections are hidden.
- **The environment** holds the deployment settings and every secret: the profile, the origin, where the documents are, proxy trust, and credentials. [deployment.md](deployment.md#environment-variables) lists them. Neither document may hold one.

Both documents live in one directory: `config/` in a checkout, `PORTFOLIO_SOURCE_DIR` in a deployment. Start from `portfolio.example.yml` and `site.example.yml` at the repository root. The `demo` profile renders those two examples and reads no directory.

## Files and formats

- Each document is YAML (`.yml` or `.yaml`) or JSON (`.json`), and the two may differ. The directory holds exactly one of each. A missing document is `source.missing`, one in two formats is `source.duplicate`, and one the server can't read is `source.unreadable`.
- The portfolio document declares `schemaVersion: 3`, and the site document `schemaVersion: 2`. A version 2 portfolio is `schema.outdated`: `pnpm config:migrate` converts it ([below](#migrating-a-version-2-portfolio)).
- A document is one plain YAML or JSON document. Anchors, aliases, merge keys, tags, directives, a second document, and a key repeated in one mapping are refused. A `.json` file must also be valid JSON.
- A document holds at most 1 MiB, nests at most 64 levels, and has at most 10,000 entries in one mapping or list.
- Every object refuses a key its schema doesn't define, and the message names the closest allowed key. The only open places are values under `extensions` and under `variantControls.<variant>.values`, which hold plain JSON nested at most 8 levels.
- Leaving a field out means it isn't authored. An empty string, or one of only spaces, and an empty list are refused where a value goes: leave the key out instead. There's no `null`.
- Every number is finite: YAML's `.inf` and `.nan` are refused wherever a number goes.
- Key order in a mapping doesn't matter. `pnpm config:migrate` writes keys in the schema's order, and `pnpm config:ids-fix` keeps yours.
- Every `url` and `*Url` field takes an `https`, `http`, `mailto`, or `tel` URL, a relative reference such as `/resume.pdf`, `resume.pdf`, or `../x` (but not `//host`), or a `#fragment`, with no unencoded space or control character. A media asset's `source` is the one exception: [Media](#media).
- No string in either document may look like a GitHub token, a PEM private key, a PHC or bcrypt password hash, or an AWS access key ID (`secret.detected`). Documents never read environment values, so a secret in one was pasted there. Remove it and revoke it.

## The portfolio document

A portfolio is a body of work. Its records, the works, evidence, chronology entries, and media assets, each carry an id. A few lists curate them, and the sections place them in the order a visitor reads them.

| Field           | Required | Holds                                                                                                                                 |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | yes      | `3`.                                                                                                                                  |
| `locale`        | yes      | The content's BCP 47 language tag, such as `en` or `pt-BR`. It sets `<html lang>` and the feed's `<language>`.                        |
| `direction`     | yes      | `ltr` or `rtl`. It sets `<html dir>`.                                                                                                 |
| `identity`      | yes      | `name`, the one required field, and `tagline`, `pronouns`, `location`, `email`, and `avatar`, a [placement](#media) of an image.      |
| `links`         | no       | `{ url, label?, platform? }` each, in display order. `platform` picks an icon, such as `github` or `website`.                         |
| `meta`          | no       | `title`, `description`, and `ogImage`, a placement of an image, for the page's metadata.                                              |
| `works`         | no       | [Works](#works): what you made.                                                                                                       |
| `evidence`      | no       | [Evidence](#evidence): attributable facts about the work.                                                                             |
| `chronology`    | no       | [Chronology entries](#chronology): roles, studies, projects, events, and milestones, each with a period.                              |
| `media`         | no       | [Media assets](#media): images, audio, video, and documents, by id.                                                                   |
| `practice`      | no       | [The practice](#practice): a thesis, and groups of skills, tools, and services.                                                       |
| `contact`       | no       | [The contact record](#contact): a `message` and `links`.                                                                              |
| `signature`     | no       | The one work the portfolio leads with, by id. [Curation](#curation).                                                                  |
| `featured`      | no       | Flagship works, by id, in order.                                                                                                      |
| `proof`         | no       | The proof strip: evidence ids, in order.                                                                                              |
| `archive`       | no       | Older works, by id, in order.                                                                                                         |
| `sections`      | no       | The reading order: [sections](#sections) that place the records. A portfolio with no visible section can't go live (`content.empty`). |

A date is `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `Month YYYY`, or `present`, and a period is `{ start, end? }` that doesn't end before it starts. Text fields such as a summary, a statement, or a case study's parts are Markdown.

A Markdown field holds at most 8,192 characters, runs a list item at most 128 lines between blank lines, and holds tables of at most 4,096 cells in all, each table's columns times its rows with the header row (`markdown.too-long`). It nests block quotes at most 4 deep, lists at most 8 deep, and the two at most 12 deep together, where a line that continues a quote without its `>`, after a line that opened a list or another quote inside it, nests what follows a level deeper (`markdown.too-deep`). Its marks `*`, `_`, `~`, `!`, and backtick number at most eight times the square root of its length, and 64 in any field: 128 in 256 characters, 256 in 1,024, and 724 at the length limit. A mark escaped with a backslash doesn't count, and neither does one other than a backtick with spaces on both sides. It also holds at most 32 link reference definitions, 128 `<` characters, 32 parentheses inside link destinations, and 64 punctuation marks in one bare web address (`markdown.too-dense`). Code in a fence or an indented block counts toward the length alone, since none of it renders as Markdown. Past these limits the renderer's time grows faster than the text, so a field over one is refused before anything renders it, and a renderer handed one anyway shows it as plain text. A variant that renders a field as one inline phrase reads a fence as text, so there the code's marks count too: a field that validates because its marks sit in a fence can pass a limit read that way, and then shows as plain text where the variant renders it inline.

### Works

A work is something made: an interface, a system, a photograph series, an essay, a record, an object. It has an `id`, a `title`, and a `medium`, one of `interface`, `system`, `software`, `photography`, `image-series`, `writing`, `research`, `music`, `audio-video`, and `object`, or an extension's `<package name>/<name>`. Nothing assumes a profession: the medium says what it is.

Every other field is optional: `summary`, `description`, `period`, `role`, `organization`, `tools`, `cover` (a placement), `media` (placements, in order), `evidence` (evidence ids the work cites), `links`, `highlights`, and `url`; for writing, `excerpt`, `publication`, `publishedAt`, `readingTimeMinutes`, and `tags`; for music, `artist`, `releasedAt`, `label`, and `tracks`; for audio and video, `series`, `number`, `durationMinutes`, `showNotes`, `guests`, `audioUrl`, and `videoUrl`.

A work with a `caseStudy` gets its own page at `/work/<slug>`, so it needs a `slug`. A case study's parts are `challenge`, `context`, `role`, `constraints`, `decisions` (each `{ decision, rationale?, alternatives? }`), `evidence`, `outcomes`, and `reflection`, every one optional, so each practice writes the ones it has, but one with none written is refused. Two public works with case studies can't share a slug (`slug.duplicate`). A slug may change: publishing redirects the old route to the new one (308).

### Evidence

Evidence is an attributable fact: a `metric`, `testimonial`, `publication`, `talk`, `award`, `patent`, `press` mention, `exhibition`, `client`, `recording`, `repository`, or `external-work`, which is its `type`. It has an `id`, and `title`, `statement`, `description`, `asOf` (when it was true), `source` (`{ name, url?, role?, organization?, avatar? }`), `url`, and `links`, plus the fields its type uses: `authors`, `venue`, `publishedAt`, `abstract`, `citation`, `doi`, `pdfUrl`, and `awards` for a publication; `location`, `presentedAt`, `format`, `slidesUrl`, and `videoUrl` for a talk; `organization` and `receivedAt` for an award; `number`, `status`, `filedAt`, `grantedAt`, `inventors`, and `assignee` for a patent; `publication`, `excerpt`, and `author` for press; and `locationLabel`, `categories`, `highlights`, `urlLabel`, `buttonText`, and `iconName` for external work.

Something has to show: evidence without a `title` or a `metric` needs a `statement`, and a testimonial needs both the `statement`, what was said, and the `source`, who said it.

A `metric` is `{ key?, value?, unit? }` with a key or a value. The `key`, such as `years-experience`, names the figure, so every claim of it can be checked: two values for one key is `metric.conflict`, and the same value shown twice is a `metric.duplicate` warning. A value that isn't a number belongs in the `statement`.

### Chronology

A chronology entry is a `role`, `study`, `project`, `event`, or `milestone` (its `kind`), with an `id`, a `title`, and a `period`. It may have `organization`, `organizationUrl`, `location`, `field`, `description`, `highlights`, `achievements`, `skills`, and `logo` (a placement). `thread` names the lane it runs in, such as `work`, `study`, or `creative`, and is never inferred; `branchesFrom` and `mergesInto` name another entry, and `works` the works it produced.

### Media

A media asset is an `image`, `audio`, `video`, or `document` (its `kind`) with an `id` and a `source`: a path under the media root, such as `atlas/cover.jpg`, with no leading `/`, no `.` or `..` segment, and no `\`, `?`, `#`, or `:`, or an `https` URL. It may have `alt`, `credit`, `rights` (`holder`, `license`, and `attributionRequired`, at least one of them), `focalPoint` (`{ x, y }` between 0 and 1), and `decorative: true`, which marks decoration that takes no alt text.

A placement uses an asset where it shows: `{ asset: <id> }`, plus what this use changes, `alt`, `decorative`, and `focalPoint`, and what belongs to it, `caption`, `takenAt`, `location`, and `tags`. An avatar, a cover, a logo, and an Open Graph image show an image asset (`ref.type`). An image placement visitors see with no alt text, on the asset or the placement, and no `decorative: true` is an `image.alt-missing` warning: a caption isn't alt text.

What a renderer shows of an asset is derived: its dimensions, aspect ratio, dominant color, and resized renditions come from the unit's media document, one record per asset revision (the source's SHA-256), which media ingestion writes. Under `owner`, saving a Studio draft, `portfolio-store import`, and the first-start import ingest each image asset: a path resolves under `PORTFOLIO_MEDIA_ROOT` and nowhere else, and an `https` URL is fetched with the checks in [docs/deployment.md](deployment.md#media). Only JPEG, PNG, WebP, and AVIF images are ingested, by what their bytes are, up to 20 MiB and 100 megapixels (40 for a progressive JPEG or an interlaced PNG, 16 for an AVIF), and renditions carry none of the source's EXIF, XMP, IPTC, or GPS data. A renamed file with the same bytes keeps its revision; new bytes become the draft's revision only once they derive; a source that goes missing or can't be reached leaves the last revision in place, marked unavailable; and a published revision never changes when its source does. `read-only` and `demo` derive once at startup into a media cache of their own. Renditions serve from `/media`, and an image whose renditions haven't derived, or whose source is gone, renders as unavailable, keeping its box, caption, and credit, and a decorative one renders nothing. The original file is never served, and `/media` never serves a private asset or a draft's media.

### Practice

`practice` is the one practice: a `thesis`, and ordered groups of `skills` (`{ name?, description?, items }` of text), `tools` (items `{ name, url?, version? }`), and `services` (items `{ name, description?, pricing?, url?, highlights? }`). A `practice` section shows one part.

### Contact

`contact` is `{ message?, links? }`, with at least one of them. A `contact` section places it, beside `identity.email` and `links`. A contact section with neither a contact record, an email, nor a link has nothing to show (`section.empty`).

### Curation

`signature`, `featured`, and `archive` name works, and `proof` names evidence, each by id. A composition leads with them: the signature first, the featured works as flagships, the proof as a strip of facts, and the archive as older work. Each work sits in one of the three at most, and a list names an id once (`curation.overlap`). An id with no record is `ref.unresolved`, and one of the wrong type, such as a section id in `proof`, is `ref.type`.

### Visibility

A work, evidence entry, chronology entry, or media asset with `visibility: private` stays in the document and never reaches a visitor. A visible section or a curation list that names one is a `ref.private` warning, and the record drops out there.

Hidden means gone: a record reaches visitors only when something visible reaches it. The roots are the visible sections, the curation lists, `identity`, and `meta`, and a kept work reaches its evidence and media. A record only hidden sections list, and an asset only hidden or private records use, stay out of the page, its RSC payload, its metadata and JSON-LD, the feed, and the Open Graph image.

### Sections

Every section has a `kind` and an `id`, and may have a `title`, a `subtitle`, and a `lang` for a section in another language than `locale`. There are 14 core kinds:

| Kind         | Places                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `works`      | Works, by id in `items`, in reading order.                                                                         |
| `evidence`   | Evidence, by id in `items`.                                                                                        |
| `chronology` | Chronology entries, by id in `items`. Without `items`, every public entry, newest first.                           |
| `practice`   | One `part` of the practice: `thesis`, `skills`, `tools`, or `services`.                                            |
| `contact`    | The contact record, the email, and the links.                                                                      |
| `custom`     | Content no other kind holds: a `title`, a `body`, and `items` of `{ title, summary?, media?, evidence?, links? }`. |
| `hero`       | `greeting`, `name`, `tagline`, `subtagline`, and `ctas`.                                                           |
| `lede`       | A `body`.                                                                                                          |
| `now`        | A `body`, and `asOf`.                                                                                              |
| `quote`      | `text`, `attribution`, `source`, and `sourceUrl`.                                                                  |
| `focus`      | `items` of text.                                                                                                   |
| `fun-facts`  | `items` of text.                                                                                                   |
| `cta`        | `description`, `primaryAction`, and `secondaryAction`.                                                             |
| `github`     | A `username`, and what to show of its snapshot.                                                                    |

A call to action, a hero's `ctas` and a `cta`'s actions, is `{ url, label, platform? }`: its label is required, since no renderer makes one up. A section with nothing visitors may see, such as a `works` section whose works are all private, leaves the page and the navigation (`section.empty`). A practice the core kinds don't cover adds its own through an [extension](#extensions). [`skills/portfolio-author/references/schema.md`](../skills/portfolio-author/references/schema.md) lists each kind's fields, and `packages/schema/src/kinds/` is the source of truth.

A `github` section renders the snapshot frozen beside the pair at `snapshots/github.json`, never a fetch at render time. Its settings say what to show: `showContributionGraph`, `showPinnedRepos`, `showTotalStars`, and `showRecentlyActive` default to `true`, `showLanguageBreakdown` to `false`, `recentlyActiveLimit` to 10 (1 to 20), and `featuredRepos` and `excludeRepos` to none. What a section doesn't show never reaches the page: the published view leaves out its excluded repositories, the `excludeRepos` list included, and each part its settings turn off. Until a snapshot holds its section, it renders a link to the profile.

### Ordering

- `sections` is the page order in every variant. The navigation follows it, listing the sections that have a `title` apart from `hero` and `cta`. A variant may cap how many it lists.
- `links`, the records a section lists, and the curation lists keep the order you write. A `chronology` section without `items` lists newest first, and the feed lists writing and audio and video works and publications newest first.
- A field left out renders as nothing: no renderer makes up a heading, a link label, or alt text.
- The site document can hide a section but can't move one.

### Stable identity

Every section, record, and media asset has an `id`, written in the document and never derived when it loads.

- It's lowercase letters and digits in hyphen-separated words, such as `get-in-touch`, at most 64 characters, and it can't be `main`, which every variant gives its `<main>` element. One that isn't is `id.invalid`, and a missing one `id.missing`.
- It's unique in the whole document: sections, works, evidence, chronology entries, and media assets share one set of ids (`id.duplicate`).
- A section's id is its DOM id, the `#fragment` links point to, and its key in the site document. A record's id is its anchor on the first visible section that lists it, its feed entry's GUID, and its JSON-LD `@id`, and an asset's id is in its media URLs. A `#fragment` link has to name a visible section or a record visitors see (`anchor.broken`).
- Keep it stable. Renaming one breaks every `#old-id` link (`anchor.broken`), every site document entry under the old id (`ref.missing`), and outside links to it. Publishing a revision that gives a live id to something of another type is `id.reused`.

`pnpm config:ids-fix [dir | portfolio-file]` gives every entry without a well-formed id one, minted from its title, and a repeated id's later entry the next free one. It edits the text in place, so a YAML document keeps its comments and both formats their key order, and a malformed id's references follow it. It prints the ids it would give and changes nothing until you add `--write`.

### Published URLs

A revision serves its home page, `/work/<slug>` for each public work with a case study, and its variant's view paths. Publishing (#3) freezes the table of old URLs into `snapshots/urls.json`: a changed slug redirects to the new one by itself (308), each redirect one hop. Any other live URL a revision drops blocks publishing (`urls.vanished`) until it's acknowledged as gone (410) or redirected to a URL the revision serves. A slug whose work turned private is never gone: it answers 404, so nothing confirms it existed. These checks compare a draft with the live revision, so they run at publish and import, not in `pnpm config:validate`.

## Snapshots and the media document

Derived data sits beside the pair, never in it:

- **`snapshots/<kind>.json`**: data a source froze, by kind. `github.json` holds one record per `github` section (`{ adapter, sectionId, data, fetchedAt }`), and `urls.json` the published URL table. A kind is lowercase letters, digits, and hyphens; a file with any other name is a `snapshot.ignored` warning. A kind this build doesn't know is kept as plain JSON.
- **`media/media.json`**: the media document, one record per asset with its renditions.

Each is one plain JSON document of at most 1 MiB. One that doesn't parse is `snapshot.syntax` or `media.syntax`, and a known kind's or the media document's data that doesn't check is `snapshot.invalid` or `media.invalid`. Startup and `pnpm config:validate` refuse either, and a renderer shows its values as unavailable rather than read them.

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

The appearance names a composition, three appearance axes, and a display mode. The axes are #19's (appearance axes): each names a pack this build registers, and every page renders in the packs the site selects.

- **`variant`** is the composition: which installed variant package lays out the page, by its manifest's id. This build registers `kinetic-cosmos` (#14) and the fallback composition, which a site can't select (`variant: fallback` is `schema.invalid`). Any other id renders as the fallback composition, with a `variant.unavailable` warning at startup and in `config.status`, until a package with that id is installed. The example's `editorial-evidence` arrives with #13.
- **`designLanguage`** is the component style. Use `platform-neutral`.
- **`colorScheme`** is the palette. Use `warm-parchment`, the platform's.
- **`typography`** is the type profile. Use `humanist-ui`, the platform's.
- **`displayMode`** is the mode a visit starts in: `system`, `light`, `dark`, or `high-contrast`. `system` follows the visitor's `prefers-color-scheme` in CSS, so the first paint is already right, and a scheme with one mode renders it whatever this says.

This build registers the platform's three packs, `platform-neutral`, `warm-parchment`, and `humanist-ui`, and checks every id against them. A pack id it doesn't register is `appearance.unavailable`: at startup and in preview a warning, and the page renders the platform's pack on that axis in its place; an import or a publish refuses it. An old document's `legacy.document` names the ids to use.

### Visitor controls

`visitorControls` says which of the five appearance fields a visitor may change for themselves: `locked` keeps the published value, and `selectable` lets them pick another. All five are required. Each `selectable` field but `variant` gets a control in the Appearance disclosure, which renders in every variant's slot for it; the composition stays the site's for now. A visitor's choice is a cookie, `portfolio_appearance`, which holds the ids alone and lasts 180 days, and the page renders in it from the first paint. Without JavaScript the control is a form that posts and comes back to the page. Under `demo` there's no control, and the appearance is the query's. No variant renders a theme toggle.

### Motion

`respect-os` follows each visitor's `prefers-reduced-motion` setting, and `reduce` reduces motion for every visitor. Under `reduce` nothing on the page animates: no entrance, nothing that repeats, and a navigation link jumps to its section instead of scrolling there. A visitor's own reduce setting does the same under `respect-os`, except that the page learns it only once it has loaded, so a hero can still fade in once, without moving. Neither a variant nor a component can override the site's `reduce`.

### Hidden sections

```yaml
sections:
  patents:
    hidden: true
```

A hidden section stays in the portfolio and out of everything visitors get: the page, its RSC payload, its metadata and JSON-LD, the feed, and the Open Graph image, along with every record only it reaches. Not even its id reaches a renderer. An entry for an id the portfolio doesn't have is `ref.missing`, and a `#fragment` link to a hidden section is `anchor.broken`.

### What the site document can't hold

Deployment settings come from the environment. `deploymentProfile`, `profile`, `origin`, `canonicalOrigin`, `url`, `baseUrl`, `studio`, `previewOrigin`, `trustedProxies`, and `proxy`, at the top level or under `features`, are `site.deployment-setting`, and the remediation names the environment variable to use.

`appearanceInputs` is checked against #19's color scheme registry: an entry for a registered scheme has to be for a generated one and give the input its generator takes, an entry keyed by another axis's pack is invalid, and one for a scheme this build doesn't register is listed as not checked. `routes` and `variantControls` are checked against the selected variant's manifest when this build registers it, and listed as not checked when it doesn't. Another variant's control entries are kept as written, unchecked. When a variant raises its controls version, `pnpm variants:migrate-controls --site config/site.yml` migrates the stored values: it prints the changes and a diff, and writes only with `--write`.

## Deployment settings and secrets

The environment holds everything that belongs to one deployment: `PORTFOLIO_PROFILE`, `PORTFOLIO_ORIGIN`, `PORTFOLIO_SOURCE_DIR`, proxy trust, and the secrets a profile needs. Each setting also takes `<KEY>_FILE`, the path of a file holding the value, such as a Docker secret. The canonical origin is a setting too, so every absolute URL the site builds comes from `PORTFOLIO_ORIGIN`, and the same pair can serve a staging and a production host.

## Extensions

A content extension is an npm package that adds fields, section kinds, and work media of its own. Its package name is its namespace.

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

A work's `medium` may be `<package name>/<name>` too, such as `'@acme/portfolio-photography/darkroom'`. A work whose medium names a package this build doesn't register is that package's data, like its sections: an `extension.unregistered` warning, and the work never reaches visitors.

- Extension data is plain JSON. Each namespace's entry, and each section's `data`, nests at most 8 levels. One object's whole `extensions` mapping, every namespace together, holds at most 32 KiB as JSON, and so does one section's `data`.
- An extension adds keys only under its own namespace, so core fields keep their checks.
- Data from a package this build registers is checked by that package's schemas.
- Data from any other package is kept as written and checked only as plain JSON. Each use is an `extension.unregistered` warning, and none of it reaches visitors: not the page, its RSC payload, its JSON-LD, or the feed. Tools that rewrite a document, such as `applyEdits` and `serialize` in `@portfolio/schema`, keep it as it is.
- A registered package's sections render through the renderers its `./renderers` export provides, and render nothing without one. Its fields reach the variants in the published view.

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
3. Install it as a dependency of `@portfolio/web` (`pnpm --filter @portfolio/web add <package>`), since the workspace doesn't hoist packages (`shamefully-hoist=false`). That registers it: its `package.json` declares `"portfolio": { "kind": "content-extension" }`, its `.` export default-exports the `defineContentExtension` result, whose namespace is the package's name, and an optional `./renderers` export maps each `<namespace>/<name>` kind to its renderer. The host registers those renderers in the browser too, on every page, so `./renderers` must be client-safe: a server-only import there, such as `node:fs` or the `server-only` package, breaks `next build`. The build checks all of it and refuses a package that doesn't fit, naming the package and the fix.

## Validation

One check runs in three places:

- **Startup.** Under `owner` and `read-only`, the server checks the mounted pair, and the snapshots and media document beside it, before it takes a request, under `pnpm dev` as in production. A blocking record stops it with exit code 1 and one `config.fatal` line per record, and warnings are logged as `config.warning`. Under `pnpm dev`, a `config/` holding neither document renders the bundled examples instead, and each edit is checked again on the next page load.
- **`pnpm config:validate [dir] [--origin <url>] [--json]`.** It checks `config/` by default, the pair and once it loads the files beside it. `--origin` checks links against the site's real origin, and `--json` prints the records themselves. It exits 1 when a record blocks the pair.
- **`node skills/portfolio-author/scripts/validate.mjs <dir>`** prints the pair's records for an authoring agent.

Publish and import (#3) run the same check with the live revision beside it, which adds `urls.vanished` and `id.reused`.

Startup also checks the deployment, which the pair alone doesn't show: in production under `owner` and `read-only`, it refuses the bundled sample's `identity.name`, and an origin on a reserved example domain. So a copy of the example passes validation and still won't start in production until its `identity.name` is your own. `pnpm config:validate` warns about the sample's name for that reason.

Each record has a code, a severity, the document, a JSON pointer, a line and column where the text has one, the section's id when it's inside a section, a message, and a remediation. A snapshot's or the media document's record also names its file.

- **`blocks-preview`**: the pair can't render.
- **`blocks-publish`**: a draft preview (#7, #8) could render it, but it can't go live.
- **`warning`**: reported only.

Startup treats the mounted pair as live, so both blocking severities stop it, except for the variant's compatibility findings: live, `variant.unavailable`, `controls.*`, `slot.required-empty`, and `kind.no-renderer` only warn, since something renders in place of each: the fallback composition for an unregistered variant, a control's default, a slot's `whenEmpty`, or the rest of the page. #3's publish still refuses them. [variants.md](variants.md#compatibility) has the whole report. Checks that can't run are listed as not checked: the origin checks without an origin, the publication checks without the live revision, and an `appearanceInputs` entry for a color scheme this build doesn't register.

| Code                           | Severity       | Meaning                                                                                                                                                        |
| ------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse.syntax`                 | blocks-preview | The text isn't one plain YAML or JSON document within the limits.                                                                                              |
| `schema.invalid`               | blocks-preview | A value isn't what the schema expects, or a key isn't one it defines.                                                                                          |
| `schema.version`               | blocks-preview | A document declares a version this release doesn't read: the portfolio reads `schemaVersion: 3`, and the site `schemaVersion: 2`.                              |
| `schema.outdated`              | blocks-preview | The portfolio is a version 2 document, which `pnpm config:migrate` converts. Nothing else is reported with it.                                                 |
| `id.missing`                   | blocks-preview | A section, record, or media asset has no `id`. `pnpm config:ids-fix` gives it one.                                                                             |
| `id.invalid`                   | blocks-preview | An `id` that isn't lowercase words joined by hyphens, at most 64 characters, not `main`.                                                                       |
| `snapshot.syntax`              | blocks-preview | A file in `snapshots/` isn't one plain JSON document of at most 1 MiB.                                                                                         |
| `snapshot.invalid`             | blocks-preview | A known snapshot kind's data doesn't check, or the file can't be read.                                                                                         |
| `media.syntax`                 | blocks-preview | `media/media.json` isn't one plain JSON document of at most 1 MiB.                                                                                             |
| `media.invalid`                | blocks-preview | The media document's data doesn't check, or the file can't be read.                                                                                            |
| `source.missing`               | blocks-preview | The directory has no portfolio or no site document.                                                                                                            |
| `source.duplicate`             | blocks-preview | The directory holds one document in two formats.                                                                                                               |
| `source.unreadable`            | blocks-preview | The server can't read a document, such as one without read permission, or a directory with its name.                                                           |
| `legacy.document`              | blocks-preview | The portfolio is in the old one-file format, with or without a `site.yml`, or it's a `portfolio.toml`. Nothing else is reported with it.                       |
| `site.deployment-setting`      | blocks-preview | The site document holds a deployment setting.                                                                                                                  |
| `appearance.unknown`           | blocks-preview | An appearance id a catalog doesn't register, where a tool checks one without #19's registry. The host checks with it, and reports `appearance.unavailable`.    |
| `appearance.unavailable`       | blocks-publish | A pack id this build doesn't register. Startup and preview warn, and the platform's pack renders on that axis; import and publish refuse it.                   |
| `appearance.not-publishable`   | blocks-publish | A Research pack. Preview renders it; publish refuses it.                                                                                                       |
| `appearance.mode-incompatible` | blocks-publish | A `light` or `dark` display mode the color scheme lacks. Preview renders the scheme's own mode.                                                                |
| `appearance.input-missing`     | blocks-publish | A generated color scheme with no `appearanceInputs` entry, or nothing generated to render.                                                                     |
| `appearance.script-coverage`   | warning        | The portfolio's locale, or a section's `lang`, is in a script the typography profile doesn't cover, so browsers use a font of their own for it.                |
| `markdown.too-long`            | blocks-preview | A Markdown field past 8,192 characters, with a list item past 128 lines between blank lines, or with tables past 4,096 cells.                                  |
| `markdown.too-deep`            | blocks-preview | A Markdown field that nests block quotes past 4 deep, lists past 8 deep, or the two past 12 deep together, counting the levels lazy lines add.                 |
| `markdown.too-dense`           | blocks-preview | A Markdown field past the limits on inline marks for its length, link reference definitions, `<` characters, link parentheses, or web address punctuation.     |
| `validator.failed`             | blocks-preview | A bug in the build, such as two extensions with one namespace, not in the documents.                                                                           |
| `id.duplicate`                 | blocks-publish | Two entries share an id: sections, records, and media assets share one set.                                                                                    |
| `id.reused`                    | blocks-publish | At publish: the draft gives an id the live revision uses to something of another type.                                                                         |
| `ref.missing`                  | blocks-publish | The site document names a section the portfolio doesn't have.                                                                                                  |
| `ref.unresolved`               | blocks-publish | A reference names no record in the portfolio.                                                                                                                  |
| `ref.type`                     | blocks-publish | A reference names a record of the wrong type, such as a section id in `proof`, or an audio asset as a cover.                                                   |
| `curation.overlap`             | blocks-publish | A work in two of `signature`, `featured`, and `archive`, or an id twice in one list.                                                                           |
| `slug.duplicate`               | blocks-publish | Two public works with case studies share a slug.                                                                                                               |
| `urls.vanished`                | blocks-publish | At publish: a live URL the revision drops, with no redirect and no acknowledgement.                                                                            |
| `metric.conflict`              | blocks-publish | One metric key has two values.                                                                                                                                 |
| `anchor.broken`                | blocks-publish | A `#fragment` link points at no visible section or record.                                                                                                     |
| `secret.detected`              | blocks-publish | A string looks like a secret.                                                                                                                                  |
| `content.empty`                | blocks-publish | No section is visible.                                                                                                                                         |
| `variant.unavailable`          | blocks-publish | The site selects a variant this build doesn't register. Live, it only warns, and the fallback composition renders in its place.                                |
| `controls.invalid`             | blocks-publish | A control value the selected variant doesn't declare or accept. Live, it only warns, and the control renders its default.                                      |
| `controls.stale`               | blocks-publish | Control values stored at another version of the variant's controls. Live, it only warns, and every control renders its default.                                |
| `controls.dangling-ref`        | blocks-publish | A control points at no visible section. Live, it only warns, and the control renders its default.                                                              |
| `slot.required-empty`          | blocks-publish | A content slot the selected variant requires holds fewer items than its `min`. Live, it only warns, and the composition does what the slot's `whenEmpty` says. |
| `kind.no-renderer`             | blocks-publish | A visible extension section no registered renderer handles. Live, it only warns, and the rest of the page renders without it.                                  |
| `ref.private`                  | warning        | A visible section or a curation list names a private record, which drops out there.                                                                            |
| `section.empty`                | warning        | A visible section with nothing visitors may see, which leaves the page and the navigation.                                                                     |
| `snapshot.ignored`             | warning        | A file in `snapshots/` whose name isn't `<kind>.json`.                                                                                                         |
| `metric.duplicate`             | warning        | One metric with the same value shown twice.                                                                                                                    |
| `image.alt-missing`            | warning        | An image placement visitors see with no alt text and no `decorative: true`.                                                                                    |
| `origin.sample`                | warning        | A link points at a sample address, such as a `.test` or `example.com` host.                                                                                    |
| `origin.stale`                 | warning        | A link's host differs from the origin's only in its last label, like an old domain.                                                                            |
| `extension.unregistered`       | warning        | Data from an extension this build doesn't register.                                                                                                            |
| `slot.recommended-empty`       | warning        | A content slot the selected variant recommends is empty, or holds fewer than its `min`.                                                                        |
| `slot.overflow`                | warning        | A content slot holds more items than its `max`. The extras render after it.                                                                                    |
| `kind.unsupported`             | warning        | A visible section of a kind the selected variant doesn't show.                                                                                                 |
| `direction.unsupported`        | warning        | A right-to-left portfolio, or a section in a right-to-left language, in a variant that declares only `ltr`.                                                    |
| `appearance.unknown-recipe`    | warning        | The selected variant recommends an appearance recipe this build doesn't list. Not checked until #20 lists recipes.                                             |
| `route.unknown`                | warning        | A `routes` entry the selected variant doesn't have, which changes nothing.                                                                                     |
| `route.required`               | warning        | A `routes` entry that turns off the front page, which every site serves, so it's ignored.                                                                      |
| `sample.identity`              | warning        | From `pnpm config:validate` only: `identity.name` is the bundled sample's, which production refuses to start with.                                             |

## Migrating a version 2 portfolio

The version 2 portfolio was a list of sections that held their items. Version 3 makes the items records with ids, which sections list. The server refuses a version 2 portfolio with one `schema.outdated` record. Convert it once:

1. Run `pnpm config:migrate config/portfolio.yml`. It's a dry run: it reads the `site.yml` beside it, if there is one, for which sections are hidden, and prints each field it moves or maps, the record and media ids it mints, what to look at, the comments it can't keep, the new document's diagnostics, and a diff. It never changes the old file or writes over another. The site document doesn't change, unless it names a list section that lists nothing: that section goes, so the migration writes the site document without its entry, and keeps every other byte.
2. Give each value it asks for with `--set`, such as `--set portfolio.sections.4.primaryAction.label=Write`: a call to action's label, or a title for a gallery's work, which no renderer makes up.
3. Add `--write --out config/new`, and move the new `portfolio.yml` into `config/`, and the new `site.yml` too when it writes one.
4. Run `pnpm config:validate config`, then start the server. Running the migration on its own output changes nothing.

Each section keeps its place, its id, its title, and its subtitle. Its items become records with ids minted once from their titles, in document order, so the same file always gets the same ids:

| Version 2                                                                                    | Version 3                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`, `writings`, `discography`, `episodes`                                            | A `works` section; each item a work of medium `software`, `writing`, `music`, or `audio-video`. A project's `technologies` are its `tools`.                           |
| `gallery`                                                                                    | One `image-series` work, its items placements in order, listed by a `works` section.                                                                                  |
| `publications`, `talks`, `awards`, `patents`, `press`, `testimonials`, `external-portfolios` | An `evidence` section; each item evidence of that type.                                                                                                               |
| `stats`, `tenure`                                                                            | An `evidence` section of `metric` evidence. A stat's `metric` is its key; `tenure` is the key `tenure-years`.                                                         |
| `experience`, `education`                                                                    | A `chronology` section of `role` and `study` entries.                                                                                                                 |
| `skills`, `stack`, `services`                                                                | `practice.skills`, `practice.tools`, and `practice.services`, and a `practice` section for each. A hidden section's groups don't join a part a visible section shows. |
| `contact`                                                                                    | A `contact` section, with the first visible one's `message` and `links` as the contact record. `showAvailability` is removed.                                         |
| An image (`{ src, alt, ... }`)                                                               | A media asset, made at its source's first use, and a placement. A `/` path becomes a path under the media root.                                                       |
| A blank string or an empty list                                                              | Left out. A list section that lists nothing goes, and its site entry with it.                                                                                         |

### Migrating from the one-file format

Earlier releases read one unversioned `portfolio.yml` that mixed content and appearance. The server refuses it with one `legacy.document` record that names each old field and where it goes now. `pnpm config:migrate` converts it to version 3 in one run, both documents at once:

1. Run `pnpm config:migrate config/portfolio.yml`. It's a dry run that prints each field it moves or fills in, the values it needs, the section ids it gives, the record and media ids it mints, the comments it can't keep, the new pair's diagnostics, a diff of the portfolio document, and the whole site document.
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
| The sections' items         | Records, as for a version 2 portfolio above.                                                                                                                                                   |
| Not in the old format       | `locale: en` and `direction: ltr` unless the file has them, `designLanguage: platform-neutral`, visitor controls with the color scheme and display mode selectable, and `features.feed: true`. |

A `portfolio.toml` has to become YAML or JSON first. [deployment.md](deployment.md#migrating-from-the-one-file-format) covers the exit codes, a file holding something shaped like a secret, and running the migration in the image's build stage on a host without Node.
