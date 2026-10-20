# Schema reference for portfolio.yml and site.yml

> Every field that can appear in the two documents, with its type and a
> one-line "use this when..." per field. The agent loads this when composing a
> section and needs to know what shape it should take. The Zod source of truth
> lives at `packages/schema/src/portfolio.ts`, `packages/schema/src/site.ts`,
> and `packages/schema/src/kinds/*.ts`; if this file ever drifts, those files
> win. `docs/configuration.md` has the rules behind each field.

## `portfolio.yml` top-level shape

| Field           | Type         | Required     | Use when                                                                                             |
| --------------- | ------------ | ------------ | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `2`          | yes          | Always. The first line of the document.                                                              |
| `locale`        | string       | yes          | Always. The content's BCP 47 language tag, such as `en` or `pt-BR`.                                  |
| `direction`     | `ltr \| rtl` | yes          | Always. `rtl` for Arabic, Hebrew, Persian, and other right-to-left scripts.                          |
| `identity`      | object       | yes          | Always. Name, tagline, location, email, avatar.                                                      |
| `links`         | `Link[]`     | default `[]` | Always: at least the primary contact link.                                                           |
| `meta`          | object       | optional     | SEO: `title`, `description`, `ogImage`. Absolute URLs come from the deployment's `PORTFOLIO_ORIGIN`. |
| `sections`      | `Section[]`  | default `[]` | The body. The order is the page order; see curation.md.                                              |

Every object is strict: a key not listed here or in the kind's fields is refused. The only other key any object takes is `extensions`, below.

## `identity`

| Field      | Type   | Required | Use when                                            |
| ---------- | ------ | -------- | --------------------------------------------------- |
| `name`     | string | yes      | Always.                                             |
| `tagline`  | string | optional | Single-line elevator pitch (at most 80 characters). |
| `pronouns` | string | optional | If the user wants them visible.                     |
| `location` | string | optional | City and state or country.                          |
| `email`    | string | optional | Direct contact.                                     |
| `avatar`   | Image  | optional | Profile photo.                                      |

## Common types

- **`Link`**: `{ url, label?, platform? }`. `url` is required: an `https`, `http`, `mailto`, or `tel` URL, a rooted path, or a `#fragment` naming a visible section's id. `platform` is free-form (`github`, `linkedin`, `mastodon`, `bluesky`, `website`, `resume`, `email`, and so on); variants use it to pick an icon.
- **`Image`**: `{ src, alt?, width?, height?, credit?, focalPoint? }`. `src` takes what `url` does, plus `data:image` URLs in png, jpeg, gif, webp, or avif. Set `alt` when meaningful. `focalPoint` is `{ x, y }`, each from 0 to 1, for off-centre subjects that may be cropped.
- **`LooseDate`**: a string: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `"Month YYYY"`, or `present`/`now`/`current`. Use the coarsest form, and quote a bare year (`'2023'`): unquoted, YAML reads it as a number.
- **`Period`**: `{ start: LooseDate, end?: LooseDate }`. Omit `end` for ongoing. Validation rejects an `end` before `start`.
- **`SectionBase`** (every section has): `kind` and `id`, both required, and `title?`, `subtitle?`, and `lang?` (the section's language when it differs from `locale`). The `id` is lowercase letters and digits in hyphen-separated words, at most 64 characters, unique in the portfolio, and never `main`. It's the section's anchor and its key in `site.yml`, so pick the word a visitor would expect in a link and keep it stable.
- **`extensions`**: any object may carry `extensions: { '<npm package name>': { ... } }` for data the schema has no field for. A section whose `kind` is `<npm package name>/<name>` holds its content under `data`. Data from a package this build doesn't register is kept, warned about, and never shown.

## `site.yml`

| Field                                           | Type                   | Required | Use when                                                                                                         |
| ----------------------------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                 | `2`                    | yes      | Always.                                                                                                          |
| `appearance`                                    | object                 | yes      | Always. `variant`, `designLanguage`, `colorScheme`, `typography`, and `displayMode`; see below.                  |
| `visitorControls`                               | object                 | yes      | Always. `locked` or `selectable` for each of the five appearance fields. Copy `site.example.yml`'s unless asked. |
| `motionPolicy`                                  | `respect-os \| reduce` | yes      | `respect-os` by default; `reduce` when the user wants motion off for everyone.                                   |
| `features`                                      | object                 | yes      | `feed: true` serves `/feed.xml`; `productAttribution` defaults to `false`.                                       |
| `sections`                                      | object                 | optional | `{ <section id>: { hidden: true } }` to keep a section in the portfolio and off the page.                        |
| `appearanceInputs`, `routes`, `variantControls` | object                 | optional | Leave out. Later releases use them.                                                                              |

`appearance` ids must be ones this build registers. `variant` is `editorial` or `kinetic-cosmos`. `colorScheme` and `typography` are ids the selected variant declares in its manifest: Editorial has `warm`, `noir`, and `ink-and-paper`, and `classic` and `modernist`; Kinetic Cosmos has `nebula`, `aurora`, and `solar`, and `geometric` and `humanist`. `designLanguage` is `platform-neutral`. `displayMode` is `system`, `light`, or `dark`. Neither document may hold a deployment setting (the origin, the profile) or anything shaped like a secret.

## Section kinds

Each kind: required → optional → minimal example.

### `kind: hero`

Top-of-page introduction. Use once, first. Optional: `greeting`, `name`,
`tagline`, `subtagline`, `ctas: Link[]`.

```yaml
- kind: hero
  id: top
  greeting: Hello, I'm
  tagline: I build calm software at scale.
  ctas: [{ url: '#contact', label: Get in touch }]
```

### `kind: lede`

Long-form bio. Required: `body` (markdown allowed).

```yaml
- { kind: lede, id: about, title: About, body: I work where systems meet team design. }
```

### `kind: now`

What the author is doing right now. Required: `body`. Optional: `asOf`.

```yaml
- { kind: now, id: now, asOf: 2025-04, body: Leading reliability for payments. }
```

### `kind: experience`

Work history. Item required: `role`, `organization`, `period`. Optional:
`organizationUrl`, `location`, `description`, `highlights[]`, `skills[]`, `logo`.

```yaml
- kind: experience
  id: experience
  items:
    - {
        role: Staff Engineer,
        organization: Acme,
        period: { start: 2022-03, end: present },
        highlights: [Cut p99 40%],
      }
```

### `kind: education`

Schools and degrees. Item required: `degree`, `institution`, `period`.
Optional: `field`, `institutionUrl`, `location`, `description`, `achievements[]`, `logo`.

```yaml
- kind: education
  id: education
  items:
    - { degree: B.Tech, institution: IIT Madras, period: { start: '2014', end: '2018' } }
```

### `kind: projects`

Portfolio of work. Item required: `name`. Optional: `summary`, `description`,
`period`, `role`, `organization`, `technologies[]`, `image`, `images[]`,
`links[]`, `highlights[]`.

```yaml
- kind: projects
  id: projects
  items:
    - {
        name: Quietly,
        summary: A focus timer that stops nagging.,
        technologies: [TypeScript, Tauri],
      }
```

### `kind: writings`

Essays / blog posts. Item required: `title`. Optional: `summary`, `excerpt`,
`publication`, `publishedAt`, `url`, `readingTimeMinutes`, `tags[]`.

```yaml
- kind: writings
  id: writings
  items:
    - {
        title: On legible systems,
        publication: Increment,
        publishedAt: 2024-09,
        url: https://example.com/legible,
      }
```

### `kind: publications`

Academic publications. Item required: `title`. Optional: `authors[]`, `venue`,
`publishedAt`, `abstract`, `citation`, `doi`, `url`, `pdfUrl`, `awards[]`.

```yaml
- kind: publications
  id: publications
  items:
    - {
        title: A taxonomy of partial failures,
        venue: SIGOPS,
        publishedAt: '2023',
        doi: 10.1145/0.0,
      }
```

### `kind: talks`

Conference / podcast talks. Item required: `title`. Optional: `venue`,
`location`, `presentedAt`, `type` (`keynote|workshop|panel|lightning|session|interview`),
`description`, `abstract`, `slidesUrl`, `videoUrl`, `links[]`.

```yaml
- kind: talks
  id: talks
  items:
    - { title: Calm at scale, venue: SREcon, presentedAt: 2024-03, type: keynote }
```

### `kind: awards`

Recognition. Item required: `name`. Optional: `organization`, `receivedAt`, `description`, `url`.

```yaml
- kind: awards
  id: awards
  items: [{ name: Engineer of the Year, organization: Acme, receivedAt: '2023' }]
```

### `kind: episodes`

Podcast / video series episodes. Section: `showName?`, `showDescription?`.
Item required: `title`. Optional: `number`, `publishedAt`, `durationMinutes`,
`description`, `showNotes`, `guests[]`, `audioUrl`, `videoUrl`, `links[]`.

```yaml
- kind: episodes
  id: episodes
  showName: Quiet Systems
  items:
    - { number: 12, title: On backpressure, publishedAt: 2024-11 }
```

### `kind: patents`

Patents. Item required: `title`. Optional: `number`,
`status` (`granted|pending|expired`), `filedAt`, `grantedAt`, `inventors[]`,
`assignee`, `description`, `url`.

```yaml
- kind: patents
  id: patents
  items:
    - { title: Adaptive load shedding, number: US-12345, status: granted, grantedAt: '2022' }
```

### `kind: gallery`

Image-first section. Optional `layout` (`plates|grid|columns`). Item required: `image`. Optional: `caption`, `takenAt`, `location`, `tags[]`.

```yaml
- kind: gallery
  id: gallery
  layout: grid
  items: [{ image: { src: /img/01.jpg, alt: Pier at dawn }, takenAt: 2024-08 }]
```

### `kind: discography`

Released music. Item required: `title`. Optional: `artist`, `role`,
`releasedAt`, `label`, `cover`, `description`,
`tracks[]` (`{ title, durationSeconds?, url? }`), `links[]`.

```yaml
- kind: discography
  id: discography
  items:
    - { title: Slow Hours, releasedAt: 2023-05, tracks: [{ title: Prelude, durationSeconds: 142 }] }
```

### `kind: testimonials`

Quotes about the author. Item required: `quote`, `author`. Optional:
`authorRole`, `authorOrganization`, `authorAvatar`, `authorUrl`, `sourceUrl`.

```yaml
- kind: testimonials
  id: testimonials
  items:
    - { quote: She makes the hard parts look obvious., author: A. Director, authorRole: VP Eng }
```

### `kind: press`

Mentions in third-party media. Item required: `title`, `publication`. Optional: `publishedAt`, `excerpt`, `url`, `author`.

```yaml
- kind: press
  id: press
  items: [{ title: The quiet architect, publication: Wired, publishedAt: 2024-02 }]
```

### `kind: quote`

A single displayed quote. Required: `text`. Optional: `attribution`,
`source`, `sourceUrl`.

```yaml
- { kind: quote, id: quote, text: Make the hard parts obvious., attribution: A. Director }
```

### `kind: skills`

Skill tags. Provide `groups` (named buckets) or flat `items`, at least one. Group: `{ name, description?, items: string[] }`.

```yaml
- kind: skills
  id: skills
  groups: [{ name: Languages, items: [TypeScript, Go, Rust] }]
```

### `kind: stack`

Tools / dependencies with optional version + link. Required: `groups[]`, each `{ name, items: { name, url?, version? }[] }`.

```yaml
- kind: stack
  id: stack
  groups: [{ name: Frontend, items: [{ name: Next.js, version: '16' }] }]
```

### `kind: services`

Offerings for hire. Item required: `name`. Optional: `description`,
`pricing`, `url`, `highlights[]`.

```yaml
- kind: services
  id: services
  items:
    - { name: Reliability audit, pricing: From $5k, highlights: [2-week engagement] }
```

### `kind: contact`

Contact block. Optional: `message`, `links[]`, `showAvailability` (bool).

```yaml
- kind: contact
  id: contact
  message: Best reached on LinkedIn.
  links: [{ url: https://linkedin.com/in/x, label: LinkedIn }]
```

### `kind: cta`

Call-to-action band. Optional: `description`, `primaryAction` (Link),
`secondaryAction` (Link).

```yaml
- { kind: cta, id: cta, title: Hire me, primaryAction: { url: '#contact', label: Get in touch } }
```

### `kind: stats`

Big-number callouts. Required: `items[]`, each
`{ value (string|number), label, description?, metric? }`. `metric` is a key
naming the figure, such as `years-experience`, so the same figure stated in two
places is checked: two values are a `metric.conflict`, and the same value in
two visible sections a `metric.duplicate` warning. A `tenure` section's `years`
is the metric `tenure-years`.

```yaml
- kind: stats
  id: by-the-numbers
  items:
    - { value: 12, label: Years experience, metric: years-experience }
    - { value: 10B, label: Requests/day handled }
```

### `kind: focus`

Short labels for what the author is putting energy into now. Required:
`items[]` (≥1). Distinct from `now` (prose) and `skills` (comprehensive).

```yaml
- { kind: focus, id: focus, items: [Reliability tooling, Mentoring, Essays] }
```

### `kind: fun-facts`

Playful personal details. Required: `items[]` (≥1 string).

```yaml
- { kind: fun-facts, id: fun-facts, items: [I bake sourdough, I cycled Karnataka] }
```

### `kind: tenure`

Single accent figure for career length. Optional: `years` (≥0), `summary`.

```yaml
- { kind: tenure, id: tenure, years: 12, summary: 'Across payments, infra, dev tools.' }
```

### `kind: external-portfolios`

Cards linking to separate sites the author maintains (photography blog, music site, etc.). Required: `items[]` (≥1). Item required: `url`, `brandName`. Optional: `description`, `locationLabel`, `categories[]`, `highlights[]` (`{ label, sub }`), `urlLabel`, `buttonText`, `iconName` (`camera|music|book|palette|code|pen|globe|film|mic|headphones|gallery`).

```yaml
- kind: external-portfolios
  id: external-portfolios
  items: [{ url: https://x.photography, brandName: x.photography, iconName: camera }]
```

### `kind: github`

Declarative GitHub config; data fetched server-side. Required: `username`.
Booleans default to: `showContributionGraph: true`, `showPinnedRepos: true`,
`showTotalStars: true`, `showLanguageBreakdown: false`,
`showRecentlyActive: true`. Optional:
`featuredRepos[]`, `excludeRepos[]`. Public pages fetch through unauthenticated
REST, so the contribution graph (GraphQL, token) doesn't render and pinned repos
are the top-starred ones.

- **`showRecentlyActive`**: boolean, default `true`. Shows a list of repositories the user has most recently pushed to. Use when you want to surface live activity below the pinned highlights.
- **`recentlyActiveLimit`**: integer from 1 to 20, default `10`. How many repositories to include in the recently-active list. Use when the default 10 is too long for your variant's layout.

```yaml
- kind: github
  id: github
  username: anamika
  showLanguageBreakdown: true
  showRecentlyActive: true
  recentlyActiveLimit: 5
  featuredRepos: [quietly, sre-notes]
```
