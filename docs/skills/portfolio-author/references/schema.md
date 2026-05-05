# Schema reference for portfolio.yml

> Every field that can appear in portfolio.yml, with its type and a one-line
> "use this when..." per field. The agent loads this when composing a section
> and needs to know what shape it should take. The Zod source of truth lives
> at `packages/schema/src/portfolio.ts` and `packages/schema/src/kinds/*.ts`;
> if this file ever drifts, those files win.

## Top-level shape

| Field | Type | Required | Use when |
|---|---|---|---|
| `identity` | object | yes | Always. Name, tagline, location, email, avatar. |
| `variant` | string | default `editorial` | Always. Slug of the active variant. |
| `theme` | `light \| dark \| bright \| black \| system` | default `system` | Override default theme. Rare. `'system'` follows the OS. `'bright'` and `'black'` are opt-in deliberate modes — they fall back to `'light'`/`'dark'` on variants that don't support them. |
| `motionPreference` | `respect-os \| reduce \| full` | default `respect-os` | `reduce` if photosensitive; `full` overrides OS pref. |
| `colorScheme` | string | optional | Pin a color scheme id from the active variant. |
| `typography` | string | optional | Pin a typography preset id. |
| `links` | `Link[]` | default `[]` | Always — at least the primary contact link. |
| `sections` | `Section[]` | default `[]` | The body. Order matters; see curation.md. |
| `meta` | object | optional | SEO: `title`, `description`, `url`, `ogImage`. |

## `identity`

| Field | Type | Required | Use when |
|---|---|---|---|
| `name` | string | yes | Always. |
| `tagline` | string | optional | Single-line elevator pitch (≤80 chars). |
| `pronouns` | string | optional | If the user wants them visible. |
| `location` | string | optional | City + state/country. |
| `email` | string | optional | Direct contact. |
| `avatar` | Image | optional | Profile photo. |

## Common types

- **`Link`** — `{ url, label?, platform? }`. `url` required (absolute or rooted path). `platform` is free-form (`github`, `linkedin`, `mastodon`, `bluesky`, `website`, `resume`, `email`, …); variants use it to pick an icon.
- **`Image`** — `{ src, alt?, width?, height?, credit?, focalPoint? }`. Set `alt` when meaningful. `focalPoint` is `{ x: 0–1, y: 0–1 }` for off-centre subjects that may be cropped.
- **`LooseDate`** — string: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `"Month YYYY"`, or `present`/`now`/`current`. Use the coarsest form.
- **`Period`** — `{ start: LooseDate, end?: LooseDate }`. Omit `end` for ongoing. Validation rejects `end` before `start`.
- **`SectionBase`** (every section may set) — `id?` (anchor), `title?`, `subtitle?`, `hidden?` (suppress without deleting).

## Section kinds

Each kind: required → optional → minimal example.

### `kind: hero`
Top-of-page introduction. Use once, first. Optional: `greeting`, `name`,
`tagline`, `subtagline`, `ctas: Link[]`.
```yaml
- kind: hero
  greeting: Hello, I'm
  tagline: I build calm software at scale.
  ctas: [{ url: '#contact', label: Get in touch }]
```

### `kind: lede`
Long-form bio. Required: `body` (markdown allowed).
```yaml
- { kind: lede, title: About, body: I work where systems meet team design. }
```

### `kind: now`
What the author is doing right now. Required: `body`. Optional: `asOf`.
```yaml
- { kind: now, asOf: 2025-04, body: Leading reliability for payments. }
```

### `kind: experience`
Work history. Item required: `role`, `organization`, `period`. Optional:
`organizationUrl`, `location`, `description`, `highlights[]`, `skills[]`, `logo`.
```yaml
- kind: experience
  items:
    - { role: Staff Engineer, organization: Acme,
        period: { start: 2022-03, end: present }, highlights: [Cut p99 40%] }
```

### `kind: education`
Schools and degrees. Item required: `degree`, `institution`, `period`.
Optional: `field`, `institutionUrl`, `location`, `description`, `achievements[]`, `logo`.
```yaml
- kind: education
  items:
    - { degree: B.Tech, institution: IIT Madras,
        period: { start: 2014, end: 2018 } }
```

### `kind: projects`
Portfolio of work. Item required: `name`. Optional: `summary`, `description`,
`period`, `role`, `organization`, `technologies[]`, `image`, `images[]`,
`links[]`, `highlights[]`.
```yaml
- kind: projects
  items:
    - { name: Quietly, summary: A focus timer that stops nagging.,
        technologies: [TypeScript, Tauri] }
```

### `kind: writings`
Essays / blog posts. Item required: `title`. Optional: `summary`, `excerpt`,
`publication`, `publishedAt`, `url`, `readingTimeMinutes`, `tags[]`.
```yaml
- kind: writings
  items:
    - { title: On legible systems, publication: Increment,
        publishedAt: 2024-09, url: https://example.com/legible }
```

### `kind: publications`
Academic publications. Item required: `title`. Optional: `authors[]`, `venue`,
`publishedAt`, `abstract`, `citation`, `doi`, `url`, `pdfUrl`, `awards[]`.
```yaml
- kind: publications
  items:
    - { title: A taxonomy of partial failures,
        venue: SIGOPS, publishedAt: 2023, doi: 10.1145/0.0 }
```

### `kind: talks`
Conference / podcast talks. Item required: `title`. Optional: `venue`,
`location`, `presentedAt`, `type` (`keynote|workshop|panel|lightning|session|interview`),
`description`, `abstract`, `slidesUrl`, `videoUrl`, `links[]`.
```yaml
- kind: talks
  items:
    - { title: Calm at scale, venue: SREcon,
        presentedAt: 2024-03, type: keynote }
```

### `kind: awards`
Recognition. Item required: `name`. Optional: `organization`, `receivedAt`, `description`, `url`.
```yaml
- kind: awards
  items: [{ name: Engineer of the Year, organization: Acme, receivedAt: 2023 }]
```

### `kind: episodes`
Podcast / video series episodes. Section: `showName?`, `showDescription?`.
Item required: `title`. Optional: `number`, `publishedAt`, `durationMinutes`,
`description`, `showNotes`, `guests[]`, `audioUrl`, `videoUrl`, `links[]`.
```yaml
- kind: episodes
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
  items:
    - { title: Adaptive load shedding, number: US-12345,
        status: granted, grantedAt: 2022 }
```

### `kind: gallery`
Image-first section. Optional `layout` (`plates|grid|columns`). Item required: `image`. Optional: `caption`, `takenAt`, `location`, `tags[]`.
```yaml
- kind: gallery
  layout: grid
  items: [{ image: { src: /img/01.jpg, alt: Pier at dawn }, takenAt: 2024-08 }]
```

### `kind: discography`
Released music. Item required: `title`. Optional: `artist`, `role`,
`releasedAt`, `label`, `cover`, `description`,
`tracks[]` (`{ title, durationSeconds?, url? }`), `links[]`.
```yaml
- kind: discography
  items:
    - { title: Slow Hours, releasedAt: 2023-05,
        tracks: [{ title: Prelude, durationSeconds: 142 }] }
```

### `kind: testimonials`
Quotes about the author. Item required: `quote`, `author`. Optional:
`authorRole`, `authorOrganization`, `authorAvatar`, `authorUrl`, `sourceUrl`.
```yaml
- kind: testimonials
  items:
    - { quote: She makes the hard parts look obvious.,
        author: A. Director, authorRole: VP Eng }
```

### `kind: press`
Mentions in third-party media. Item required: `title`, `publication`. Optional: `publishedAt`, `excerpt`, `url`, `author`.
```yaml
- kind: press
  items: [{ title: The quiet architect, publication: Wired, publishedAt: 2024-02 }]
```

### `kind: quote`
A single displayed quote. Required: `text`. Optional: `attribution`,
`source`, `sourceUrl`.
```yaml
- { kind: quote, text: Make the hard parts obvious., attribution: A. Director }
```

### `kind: skills`
Skill tags. Provide `groups` (named buckets) or flat `items` — at least one. Group: `{ name, description?, items: string[] }`.
```yaml
- kind: skills
  groups: [{ name: Languages, items: [TypeScript, Go, Rust] }]
```

### `kind: stack`
Tools / dependencies with optional version + link. Required: `groups[]`, each `{ name, items: { name, url?, version? }[] }`.
```yaml
- kind: stack
  groups: [{ name: Frontend, items: [{ name: Next.js, version: '16' }] }]
```

### `kind: services`
Offerings for hire. Item required: `name`. Optional: `description`,
`pricing`, `url`, `highlights[]`.
```yaml
- kind: services
  items:
    - { name: Reliability audit, pricing: From $5k,
        highlights: [2-week engagement] }
```

### `kind: contact`
Contact block. Optional: `message`, `links[]`, `showAvailability` (bool).
```yaml
- kind: contact
  message: Best reached on LinkedIn.
  links: [{ url: https://linkedin.com/in/x, label: LinkedIn }]
```

### `kind: cta`
Call-to-action band. Optional: `description`, `primaryAction` (Link),
`secondaryAction` (Link).
```yaml
- { kind: cta, title: Hire me,
    primaryAction: { url: '#contact', label: Get in touch } }
```

### `kind: stats`
Big-number callouts. Required: `items[]`, each
`{ value (string|number), label, description? }`.
```yaml
- kind: stats
  items:
    - { value: 12, label: Years experience }
    - { value: 10B, label: Requests/day handled }
```

### `kind: focus`
Short labels for what the author is putting energy into now. Required:
`items[]` (≥1). Distinct from `now` (prose) and `skills` (comprehensive).
```yaml
- { kind: focus, items: [Reliability tooling, Mentoring, Essays] }
```

### `kind: fun-facts`
Playful personal details. Required: `items[]` (≥1 string).
```yaml
- { kind: fun-facts, items: [I bake sourdough, I cycled Karnataka] }
```

### `kind: tenure`
Single accent figure for career length. Optional: `years` (≥0), `summary`.
```yaml
- { kind: tenure, years: 12, summary: 'Across payments, infra, dev tools.' }
```

### `kind: external-portfolios`
Cards linking to separate sites the author maintains (photography blog, music site, etc.). Required: `items[]` (≥1). Item required: `url`, `brandName`. Optional: `description`, `locationLabel`, `categories[]`, `highlights[]` (`{ label, sub }`), `urlLabel`, `buttonText`, `iconName` (`camera|music|book|palette|code|pen|globe|film|mic|headphones|gallery`).
```yaml
- kind: external-portfolios
  items: [{ url: https://x.photography, brandName: x.photography, iconName: camera }]
```

### `kind: github`
Declarative GitHub config; data fetched server-side. Required: `username`.
Booleans default to: `showContributionGraph: true`, `showPinnedRepos: true`,
`showTotalStars: true`, `showLanguageBreakdown: false`,
`showRecentlyActive: true`. Optional:
`featuredRepos[]`, `excludeRepos[]`. Contribution graph needs `GITHUB_TOKEN`
(GraphQL); REST fallback otherwise.

- **`showRecentlyActive`** — boolean, default `true`. Shows a list of repositories the user has most recently pushed to. Use when you want to surface live activity below the pinned highlights.
- **`recentlyActiveLimit`** — integer 1–20, default `10`. How many repositories to include in the recently-active list. Use when the default 10 is too long for your variant's layout.
```yaml
- kind: github
  username: anamika
  showLanguageBreakdown: true
  showRecentlyActive: true
  recentlyActiveLimit: 5
  featuredRepos: [quietly, sre-notes]
```
