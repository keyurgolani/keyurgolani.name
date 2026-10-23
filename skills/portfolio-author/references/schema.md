# Schema reference for portfolio.yml and site.yml

> Every field that can appear in the two documents, with its type and a
> one-line "use this when..." per field. The agent loads this when composing a
> record or a section and needs to know what shape it should take. The Zod
> source of truth lives at `packages/schema/src/portfolio.ts`,
> `packages/schema/src/site.ts`, and `packages/schema/src/kinds/*.ts`; if this
> file ever drifts, those files win. `docs/configuration.md` has the rules
> behind each field.

## `portfolio.yml` top-level shape

A portfolio is a body of work: records with ids, a few lists that curate them, and sections that place them in reading order.

| Field           | Type                | Required | Use when                                                                                             |
| --------------- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `3`                 | yes      | Always. The first line of the document.                                                              |
| `locale`        | string              | yes      | Always. The content's BCP 47 language tag, such as `en` or `pt-BR`.                                  |
| `direction`     | `ltr \| rtl`        | yes      | Always. `rtl` for Arabic, Hebrew, Persian, and other right-to-left scripts.                          |
| `identity`      | object              | yes      | Always. Name, tagline, location, email, avatar.                                                      |
| `links`         | `Link[]`            | optional | At least the primary contact link, usually.                                                          |
| `meta`          | object              | optional | SEO: `title`, `description`, `ogImage`. Absolute URLs come from the deployment's `PORTFOLIO_ORIGIN`. |
| `works`         | `Work[]`            | optional | Everything the person made that's worth showing.                                                     |
| `evidence`      | `Evidence[]`        | optional | Checkable facts: metrics, testimonials, publications, talks, awards, press.                          |
| `chronology`    | `ChronologyEntry[]` | optional | Roles, studies, and milestones, each with a period.                                                  |
| `media`         | `MediaAsset[]`      | optional | Every image, audio, video, or document a placement shows.                                            |
| `practice`      | object              | optional | A thesis, and groups of skills, tools, and services.                                                 |
| `contact`       | object              | optional | A `message` and `links` the contact section places.                                                  |
| `signature`     | work id             | optional | The one work to lead with.                                                                           |
| `featured`      | work ids            | optional | Two to four flagships, in order.                                                                     |
| `proof`         | evidence ids        | optional | The facts a composition shows up front.                                                              |
| `archive`       | work ids            | optional | Older work still worth finding.                                                                      |
| `sections`      | `Section[]`         | optional | The reading order; see curation.md.                                                                  |

Every object is strict: a key not listed here or in the kind's fields is refused. The only other key any object takes is `extensions`, below.

Leave out what isn't written. An empty string and an empty list are errors, not blanks: there's no `links: []` and no `title: ''`.

## `identity`

| Field      | Type      | Required | Use when                                            |
| ---------- | --------- | -------- | --------------------------------------------------- |
| `name`     | string    | yes      | Always.                                             |
| `tagline`  | string    | optional | Single-line elevator pitch (at most 80 characters). |
| `pronouns` | string    | optional | If the user wants them visible.                     |
| `location` | string    | optional | City and state or country.                          |
| `email`    | string    | optional | Direct contact.                                     |
| `avatar`   | Placement | optional | Profile photo: an image asset's id.                 |

## Common types

- **`Id`**: lowercase letters and digits in hyphen-separated words, at most 64 characters, never `main`. Every section, work, evidence entry, chronology entry, and media asset has one, and all of them share one set: no two entries in the document may have the same id. A section's id is its anchor and its key in `site.yml`; a record's is its anchor, feed GUID, and JSON-LD `@id`. Pick the word a visitor would expect in a link and keep it stable. `pnpm config:ids-fix` mints any that are missing.
- **`Link`**: `{ url, label?, platform? }`. `url` is required: an `https`, `http`, `mailto`, or `tel` URL, a relative reference such as `/resume.pdf`, `resume.pdf`, or `../x` (not `//host`), or a `#fragment` naming a visible section's or record's id, with no unencoded space. `platform` is free-form (`github`, `linkedin`, `mastodon`, `bluesky`, `website`, `resume`, `email`, and so on); variants use it to pick an icon.
- **`Action`**: a call to action, `{ url, label, platform? }`. The `label` is required: no renderer makes one up.
- **`Placement`**: where a media asset shows. `{ asset, caption?, alt?, decorative?, focalPoint?, takenAt?, location?, tags? }`. `asset` is the media asset's id; `alt`, `decorative`, and `focalPoint` override the asset's own for this use.
- **`LooseDate`**: a string: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `"Month YYYY"`, or `present`/`now`/`current`. Use the coarsest form, and quote a bare year (`'2023'`): unquoted, YAML reads it as a number.
- **`Period`**: `{ start: LooseDate, end?: LooseDate }`. Omit `end` for ongoing. Validation rejects an `end` before `start`.
- **`Visibility`**: `public` or `private` on any record. A private one never reaches a visitor; leave it out for public.
- **`SectionBase`** (every section has): `kind` and `id`, both required, and `title?`, `subtitle?`, and `lang?` (the section's language when it differs from `locale`).
- **`extensions`**: any object may carry `extensions: { '<npm package name>': { ... } }` for data the schema has no field for. A section whose `kind` is `<npm package name>/<name>` holds its content under `data`, and a work's `medium` may be `<npm package name>/<name>`. Data from a package this build doesn't register is kept, warned about, and never shown.

## Records

### `Work`

Something made. Required: `id`, `title`, `medium` (`interface`, `system`, `software`, `photography`, `image-series`, `writing`, `research`, `music`, `audio-video`, `object`). Optional: `slug`, `visibility`, `lang`, `summary`, `description`, `period`, `role`, `organization`, `tools[]`, `cover` (Placement), `media[]` (Placements), `evidence[]` (evidence ids it cites), `links[]`, `highlights[]`, `url`, `caseStudy`. Writing adds `excerpt`, `publication`, `publishedAt`, `readingTimeMinutes`, `tags[]`; music `artist`, `releasedAt`, `label`, `tracks[]` (`{ title, durationSeconds?, url? }`); audio and video `series`, `number`, `durationMinutes`, `showNotes`, `guests[]`, `audioUrl`, `videoUrl`.

A `caseStudy` gives the work its own page at `/work/<slug>`, so it needs `slug`. Its fields are all optional Markdown: `challenge`, `context`, `role`, `constraints`, `decisions[]` (`{ decision, rationale?, alternatives? }`), `evidence`, `outcomes`, `reflection`. Write the ones the work has, at least one.

```yaml
works:
  - id: shipyard
    slug: shipyard
    title: Shipyard
    medium: software
    summary: A deploy orchestrator that rolls back before you notice.
    period: { start: 2021-03 }
    role: Author
    tools: [Go, Kubernetes]
    cover: { asset: shipyard-cover }
    evidence: [deploys-per-week]
    caseStudy:
      challenge: Deploys failed silently and rollbacks took an hour.
  - id: quiet-alerts
    title: Quiet Alerts
    medium: software
    summary: Alert routing that pages one person, not twelve.
```

### `Evidence`

An attributable fact. Required: `id`, `type` (`metric`, `testimonial`, `publication`, `talk`, `award`, `patent`, `press`, `exhibition`, `client`, `recording`, `repository`, `external-work`). Optional: `visibility`, `lang`, `title`, `statement` (Markdown, the claim itself), `description`, `asOf`, `source` (`{ name, url?, role?, organization?, avatar? }`), `metric` (`{ key?, value?, unit? }`), `url`, `links[]`. By type: publication `authors[]`, `venue`, `publishedAt`, `abstract`, `citation`, `doi`, `pdfUrl`, `awards[]`; talk `location`, `presentedAt`, `format` (`keynote`, `workshop`, `panel`, `lightning`, `session`, `interview`), `slidesUrl`, `videoUrl`; award `organization`, `receivedAt`; patent `number`, `status` (`granted`, `pending`, `expired`), `filedAt`, `grantedAt`, `inventors[]`, `assignee`; press `publication`, `excerpt`, `author`; external work `locationLabel`, `categories[]`, `highlights[]` (`{ label, sub }`), `urlLabel`, `buttonText`, `iconName`.

Something has to show: with no `title` and no `metric`, it needs a `statement`. A testimonial needs both the `statement` and the `source`. A metric's `value` is a number; its `key` names the figure, so two claims of it are checked against each other.

```yaml
evidence:
  - id: deploys-per-week
    type: metric
    statement: Deploys a week through Shipyard
    metric: { key: deploys-per-week, value: 4000 }
  - id: quote-from-ana
    type: testimonial
    statement: The calmest incident commander I've worked with.
    source: { name: Ana Ruiz, role: VP Engineering, organization: Harbor }
```

### `ChronologyEntry`

A role, study, project, event, or milestone. Required: `id`, `kind` (`role`, `study`, `project`, `event`, `milestone`), `title`, `period`. Optional: `visibility`, `lang`, `organization`, `organizationUrl`, `location`, `field`, `description`, `highlights[]`, `achievements[]`, `skills[]`, `logo` (Placement), `thread` (a lane such as `work`, `study`, or `creative`), `branchesFrom` and `mergesInto` (another entry's id), `works[]` (work ids it produced).

```yaml
chronology:
  - id: staff-engineer-acme
    kind: role
    title: Staff Engineer
    organization: Acme
    period: { start: 2022-03, end: present }
    highlights: [Cut p99 latency 40%]
  - id: btech-iit-madras
    kind: study
    title: B.Tech
    organization: IIT Madras
    period: { start: '2014', end: '2018' }
```

### `MediaAsset`

An image, audio, video, or document by id. Required: `id`, `kind` (`image`, `audio`, `video`, `document`), `source`. Optional: `visibility`, `alt`, `credit`, `rights` (`{ holder?, license?, attributionRequired? }`, at least one), `focalPoint` (`{ x, y }`, each 0 to 1), `decorative`.

`source` is a path under the media root, such as `shipyard/cover.png` (no leading `/`, no `.` or `..` segments, no `\`, `?`, `#`, or `:`), or an `https` URL. Give every image visitors see alt text that says what it shows, or `decorative: true` (never both). A caption isn't alt text.

```yaml
media:
  - id: shipyard-cover
    kind: image
    source: shipyard/cover.png
    alt: The Shipyard dashboard, a rollback in progress.
```

### `practice`

One object: `thesis` (Markdown), and ordered groups of `skills` (`{ name?, description?, items: [text] }`), `tools` (`items: [{ name, url?, version? }]`), and `services` (`items: [{ name, description?, pricing?, url?, highlights? }]`). At least one part.

```yaml
practice:
  thesis: I make failure legible.
  skills:
    - { name: Platforms, items: [Kubernetes, Terraform] }
  tools:
    - { name: Daily, items: [{ name: Go, version: '1.23' }, { name: Neovim }] }
```

### `contact`

`{ message?, links? }`, at least one of them.

```yaml
contact:
  message: Email is best. I answer within a week.
```

## Curation

`signature` (one work id), `featured` (work ids), `archive` (work ids), and `proof` (evidence ids). A work sits in at most one of `signature`, `featured`, and `archive`, and a list names an id once.

```yaml
signature: shipyard
featured: [quiet-alerts]
proof: [deploys-per-week, quote-from-ana]
```

## `site.yml`

| Field                                           | Type                   | Required | Use when                                                                                                         |
| ----------------------------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                 | `2`                    | yes      | Always.                                                                                                          |
| `appearance`                                    | object                 | yes      | Always. `variant`, `designLanguage`, `colorScheme`, `typography`, and `displayMode`; see below.                  |
| `visitorControls`                               | object                 | yes      | Always. `locked` or `selectable` for each of the five appearance fields. Copy `site.example.yml`'s unless asked. |
| `motionPolicy`                                  | `respect-os \| reduce` | yes      | `respect-os` by default; `reduce` when the user wants motion off for everyone.                                   |
| `features`                                      | object                 | yes      | `feed: true` serves `/feed.xml`; `productAttribution` defaults to `false`.                                       |
| `sections`                                      | object                 | optional | `{ <section id>: { hidden: true } }` to keep a section in the portfolio and off the page.                        |
| `appearanceInputs`, `routes`, `variantControls` | object                 | optional | Leave out. #19 uses `appearanceInputs`; `routes` and `variantControls` follow the variant's manifest.            |

`appearance.variant` names an installed variant by its manifest id. One this build doesn't register renders as the fallback composition, with a `variant.unavailable` warning, and `fallback` itself can't be selected. Use the owner's choice, or `site.example.yml`'s `editorial-evidence`. `designLanguage` is `platform-neutral`. `colorScheme` and `typography` are the appearance system's ids (#19), such as `warm` and `classic`, which this build records without checking. `displayMode` is `system`, `light`, `dark`, or `high-contrast`. Neither document may hold a deployment setting (the origin, the profile) or anything shaped like a secret.

A hidden section takes every record only it lists off the page too.

## Section kinds

Each kind: what it places, then a minimal example. A section with nothing public to show leaves the page.

### `kind: hero`

Top-of-page introduction. Use once, first. Optional: `greeting`, `name`, `tagline`, `subtagline`, `ctas: Action[]`.

```yaml
- kind: hero
  id: top
  greeting: Hello, I'm
  tagline: I build calm software at scale.
  ctas: [{ url: '#contact', label: Get in touch }]
```

### `kind: lede`

Long-form bio. Required: `body` (Markdown).

```yaml
- { kind: lede, id: about, title: About, body: I work where systems meet team design. }
```

### `kind: works`

Works, by id. Required: `items` (work ids, at least one), in reading order.

```yaml
- { kind: works, id: work, title: Work, items: [shipyard, quiet-alerts] }
```

### `kind: evidence`

Evidence, by id. Required: `items` (evidence ids, at least one).

```yaml
- { kind: evidence, id: at-a-glance, title: At a glance, items: [deploys-per-week] }
```

### `kind: chronology`

Chronology entries, by id. Optional: `items`; without it, every public entry, newest first.

```yaml
- { kind: chronology, id: experience, title: Experience, items: [staff-engineer-acme] }
```

### `kind: practice`

One part of `practice`. Required: `part` (`thesis`, `skills`, `tools`, or `services`). A second practice section shows another part.

```yaml
- { kind: practice, id: skills, title: Skills, part: skills }
```

### `kind: contact`

Places the contact record, beside `identity.email` and `links`. No fields of its own.

```yaml
- { kind: contact, id: contact, title: Contact }
```

### `kind: custom`

Content no other kind holds. Required: `title`. Optional: `body` (Markdown), `items[]` (`{ title, summary?, media?, evidence?, links? }`). Use sparingly: it always renders in the shared fallback.

```yaml
- kind: custom
  id: workshop
  title: Monthly workshop
  body: Open to anyone running on-call.
  items: [{ title: Next session, summary: The first Saturday of the month. }]
```

### `kind: now`

What the author is doing right now. Required: `body`. Optional: `asOf`.

```yaml
- { kind: now, id: now, asOf: 2025-04, body: Leading reliability for payments. }
```

### `kind: quote`

A single standout quote. Required: `text`. Optional: `attribution`, `source`, `sourceUrl`.

```yaml
- { kind: quote, id: quote, text: 'Make it work, then make it right.', attribution: Kent Beck }
```

### `kind: focus`

What the author is putting energy into. Required: `items` (text).

```yaml
- { kind: focus, id: focus, items: [Incident tooling, Teaching on-call] }
```

### `kind: fun-facts`

Playful personal details. Required: `items` (text).

```yaml
- { kind: fun-facts, id: off-the-page, items: [Bakes sourdough on release days] }
```

### `kind: cta`

One call to action. Optional: `description`, `primaryAction`, `secondaryAction` (each an Action, label required).

```yaml
- kind: cta
  id: hire
  description: Open to staff roles in reliability.
  primaryAction: { url: 'mailto:rowan@rowan.test', label: Write to me }
```

### `kind: github`

A GitHub profile. Required: `username`. Optional: `showContributionGraph`, `showPinnedRepos`, `showTotalStars`, `showRecentlyActive` (each default `true`), `showLanguageBreakdown` (default `false`), `recentlyActiveLimit` (1 to 20, default 10), `featuredRepos[]`, `excludeRepos[]`. What it shows comes from the snapshot at `snapshots/github.json`, never a fetch; without one, the profile link alone.

```yaml
- { kind: github, id: on-github, title: On GitHub, username: rowan }
```
