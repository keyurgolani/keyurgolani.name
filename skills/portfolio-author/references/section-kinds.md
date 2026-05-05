# Section kinds — narrative reference

> Each kind, narrative form: when it shines, when to skip it, ideal data
> shape, what readers expect to see. Loaded by the agent before adding a
> section it hasn't used. Audience: both portfolio authors composing
> portfolio.yml AND variant developers designing renderers — same content
> serves both because both need to know what data lives in each section.

## When-to-use matrix

| Kind | Use when… | Skip when… |
|------|-----------|------------|
| `hero` | Always. First section. | Never. |
| `lede` | The user has a paragraph-length bio that earns the space. | Their bio fits in the hero subtagline. |
| `now` | Updated monthly with current focus (nownownow.com style). | They won't update it — staleness is worse than absence. |
| `experience` | Conventional career portfolio. | Pure-academic CV — `publications`/`awards` may be enough. |
| `education` | Recent grad, academic, or strong school signal. | Mid-career; experience already speaks. |
| `projects` | Almost always for engineers/designers/makers. | Pure researcher with no shipped work. |
| `writings` | They blog or publish essays. | One-off post. |
| `publications` | Academic, IEEE/ACM/etc. papers. | Trade-press articles — `press` fits better. |
| `talks` | Public speaking history. | Internal-only. |
| `awards` | Recognition that named external judges. | Participation trophies. |
| `episodes` | Podcast appearances or hosting. | Single appearance. |
| `patents` | Granted patents. | Filed-but-not-granted (or be explicit). |
| `gallery` | Visual work — photography, illustration, design. | List-based body of work — use `projects`. |
| `discography` | Music releases. | One-off track. |
| `testimonials` | Has 2+ strong quotes. | Only one quote — use `quote` instead. |
| `press` | Trade-press/news mentions. | Self-published links — `writings`. |
| `quote` | One signature quote that lands hard. | Multiple quotes — use `testimonials`. |
| `skills` | Engineers, designers — skill-tag listing. | Senior leaders — context speaks louder than tags. |
| `stack` | Wants to share their daily-drivers / tooling. | Reads as bragging about brands. |
| `services` | Freelance/consulting. | Salaried job hunt. |
| `contact` | Always include something contact-shaped. | The hero already has CTAs. |
| `cta` | Single strong call-to-action at end. | Already has it in hero. |
| `stats` | Quantified accomplishments worth a number. | Numbers don't add credibility. |
| `focus` | Currently-working-on bullets. | Vague aspirations rather than concrete focuses. |
| `fun-facts` | Personality-additive bullets. | Forced — feels like LinkedIn "fun fact." |
| `tenure` | "N years in" — a single anchor of seniority. | <3 years experience. |
| `external-portfolios` | Has multiple identity sites (e.g. photography lives on its own domain). | Just one site — use `links` instead. |
| `github` | Has public OSS work. | Empty/private GitHub. |

## Per-kind detail

### `hero`
- **Ideal**: `tagline` (≤80 chars), `subtagline` (≤120 chars), 1–2 `ctas`. `greeting` optional, often skipped in 2026.
- **Avoid**: marketing-speak. "Award-winning" is not a tagline.
- **Reader expects**: `identity.name` + a one-line claim that's specific.
- **Renderer expects**: title rendered large, subtagline below, CTAs as button cluster. Some variants compose all into a single typographic moment.

### `lede`
- **Ideal**: 150–400 words. Markdown allowed in `body`. Optional `title` defaults to "About".
- **Avoid**: a paragraph that re-states the tagline.
- **Reader expects**: a real bio paragraph that earns its space.
- **Renderer expects**: long-form prose, often constrained to ~38rem measure.

### `now`
- **Ideal**: 3–7 short bullets in `body` (markdown). Update monthly; set `asOf` to month of last edit.
- **Avoid**: stale "now" — older than 6 weeks reads as careless.
- **Reader expects**: present-tense, current focus.
- **Renderer expects**: short list, often with a "last updated" timestamp.

### `experience`
- **Ideal**: 3–6 most relevant roles. Each item: `role`, `organization`, `period`, plus 2–4 `highlights` naming outcomes (numbers, scope, scale).
- **Avoid**: every job since high school; bullets that describe responsibilities instead of outcomes.
- **Reader expects**: CV-shaped timeline, recent roles richer than older ones.
- **Renderer expects**: chronological list (newest first), with optional logos and skills tag rows.

### `education`
- **Ideal**: 1–3 entries; recent or signal-bearing. Include `achievements` only when they outrank generic graduation.
- **Avoid**: stuffing high school in for mid-career professionals.
- **Reader expects**: degree, institution, years — that's the floor.
- **Renderer expects**: condensed list, similar shape to experience but shorter per item.

### `projects`
- **Ideal**: 3–8 items. Each has a one-line `summary` and 2–4 `highlights` naming traction. `image`/`images` if visual.
- **Avoid**: 30 repos with no curation; "TODO app" tutorials.
- **Reader expects**: shippable things they can click into; a sense of what was built and what came of it.
- **Renderer expects**: card or grid layout; image-forward layouts when items have art.

### `writings`
- **Ideal**: 5–10 essays with `publication`, `publishedAt`, `summary`. Set `readingTimeMinutes` for long pieces.
- **Avoid**: dumping a feed; tagline-length excerpts that don't sell the click.
- **Reader expects**: a curated reading list — not a blog index.
- **Renderer expects**: title-summary stack with publication/date metadata row.

### `publications`
- **Ideal**: full citation: `authors`, `venue`, `publishedAt`, `doi` or `url`. `abstract` optional but appreciated.
- **Avoid**: blog posts (use `writings`); workshop drafts (use `talks`).
- **Reader expects**: academic-citation rigor — venue, year, DOI/PDF link.
- **Renderer expects**: dense citation-shaped block; often hangs DOI as monospace tail.

### `talks`
- **Ideal**: 3–8 most recent. `venue`, `presentedAt`, and `type` (keynote/session/etc.) help readers calibrate scale.
- **Avoid**: every internal lunch-and-learn.
- **Reader expects**: where it happened, when, and whether the recording exists.
- **Renderer expects**: list with optional video/slides icons; type chips when present.

### `awards`
- **Ideal**: 2–6 with `organization` and `receivedAt`. `description` only when the name alone doesn't carry.
- **Avoid**: company "spot bonuses"; participation-trophy framing.
- **Reader expects**: external arbiters — who gave it, when.
- **Renderer expects**: tight list; some variants compose award + organization on one line.

### `episodes`
- **Ideal**: 5–12 most recent. `showName` once at section level. Per-item: `number`, `title`, `publishedAt`, `durationMinutes`.
- **Avoid**: a single guest spot — link from `links` instead.
- **Reader expects**: episode-style listing, recognizable as podcast media.
- **Renderer expects**: numbered list with audio/video play affordances.

### `patents`
- **Ideal**: granted patents with `number`, `status: granted`, `grantedAt`, `inventors`, `assignee`.
- **Avoid**: pending applications without explicit `status: pending`.
- **Reader expects**: USPTO-style identifier with link.
- **Renderer expects**: monospace number, title-prominent, dated tail.

### `gallery`
- **Ideal**: 6–24 images with consistent aspect ratios; meaningful `alt` text. `layout` (`plates|grid|columns`) hints to renderer.
- **Avoid**: decorative noise; mixing aspect ratios randomly within a grid.
- **Reader expects**: image-first browsing, captions a courtesy not a crutch.
- **Renderer expects**: masonry/grid/lightbox-friendly layout. `focalPoint` matters when cropping.

### `discography`
- **Ideal**: each release has `releasedAt`, `cover`, `tracks`, and a `links` row pointing to streaming or Bandcamp.
- **Avoid**: SoundCloud links with no metadata; one-off tracks (link them instead).
- **Reader expects**: album-art-forward listing with playable affordance.
- **Renderer expects**: cover-image-prominent cards; tracks may render as expandable list.

### `testimonials`
- **Ideal**: 2–4 strong quotes from named, role-titled humans. `authorOrganization` adds weight.
- **Avoid**: anonymous quotes; quote stuffing — three good ones beat eight thin ones.
- **Reader expects**: short, attributable, credible — name + role + org.
- **Renderer expects**: pull-quote treatment, often with avatar; rotates or stacks per variant.

### `press`
- **Ideal**: 2–6 mentions with `publication`, `author`, `excerpt`. Excerpt is the hook — choose the line that names the user's contribution.
- **Avoid**: routine PR-wire republications; press releases the user wrote themselves.
- **Reader expects**: third-party validation — outlet name and date are the signal.
- **Renderer expects**: outlet-prominent listing; excerpt as pull-quote.

### `quote`
- **Ideal**: a single line that says something true about the work. `attribution`, optional `source`/`sourceUrl`.
- **Avoid**: motivational-poster quotes.
- **Reader expects**: an epigraph — typographic, brief, deliberately placed.
- **Renderer expects**: oversized, centred, low density. Often a section break of its own.

### `skills`
- **Ideal**: 3–5 named `groups` with 4–8 items each. Group names matter: "Languages" beats "Tech I know."
- **Avoid**: flat 50-item list; trendy-tool name-dropping.
- **Reader expects**: scannable buckets, not a buzzword cloud.
- **Renderer expects**: grouped tag clusters; group descriptions as tooltips/subheaders.

### `stack`
- **Ideal**: tools currently in active use, grouped (Runtimes, Infra, Authoring). `version` and `url` nice but optional.
- **Avoid**: aspirational stack; everything they once installed.
- **Reader expects**: a "uses" page in miniature.
- **Renderer expects**: grouped logo/text rows; version chips small.

### `services`
- **Ideal**: 1–4 productized offerings with `name`, `description`, `pricing` shape (even "Contact for rate"), `highlights`.
- **Avoid**: vague "happy to chat" entries; pricing left as a mystery on hire-shaped sites.
- **Reader expects**: a pricing page in miniature; a clear "what I do for money" answer.
- **Renderer expects**: card layout with action button per service.

### `contact`
- **Ideal**: a short `message` setting tone + 1–3 contact `links`. Set `id: contact` so the hero CTA can anchor here.
- **Avoid**: a kitchen-sink form; six redundant social links.
- **Reader expects**: one obvious way to reach the human.
- **Renderer expects**: low-friction block, optional `showAvailability` badge.

### `cta`
- **Ideal**: one strong line + `primaryAction`. Use as a closing band, not mid-page.
- **Avoid**: more than one CTA section per portfolio; competing with hero CTAs.
- **Reader expects**: a direct ask after seeing the work.
- **Renderer expects**: full-width band, button-prominent, near the end of the page.

### `stats`
- **Ideal**: 3–4 numeric `items`. Round numbers, units in `label`. `description` adds context only when the number is ambiguous.
- **Avoid**: vanity metrics; numbers that need a paragraph to defend.
- **Reader expects**: a quick scan — "12 years," "10B requests/day."
- **Renderer expects**: large-number-with-label tiles in a row.

### `focus`
- **Ideal**: 3–5 short labels (≤6 words each). Distinct from `now` (prose) and `skills` (comprehensive).
- **Avoid**: aspirations ("learn Rust someday"); skills restated.
- **Reader expects**: chips that name what's getting energy this quarter.
- **Renderer expects**: tag/chip cluster, often as a hero-adjacent strip.

### `fun-facts`
- **Ideal**: 3–5 specific, weird, true sentences. Each one a tiny story.
- **Avoid**: "I love coffee" — the LinkedIn-fun-fact reflex. If you'd say it on a dating app, skip it.
- **Reader expects**: personality without performance.
- **Renderer expects**: bullet list, often near the end; some variants treat as tickertape.

### `tenure`
- **Ideal**: one figure (`years`) plus a single-sentence `summary` framing what those years cover.
- **Avoid**: stretching the number; using when career is too short to matter.
- **Reader expects**: a single seniority anchor — "12 years."
- **Renderer expects**: oversized number, summary as caption.

### `external-portfolios`
- **Ideal**: 1–4 cards with `brandName`, `url`, `description`, `iconName`, and 2–3 `highlights` per card.
- **Avoid**: duplicating links already in `identity.links`; using as a generic "elsewhere" dump.
- **Reader expects**: clearly-distinct identity sites, each with its own brand.
- **Renderer expects**: card grid; icon as visual anchor; highlights as small stats row.

### `github`
- **Ideal**: `username` plus 1–6 `featuredRepos` to surface specific work. Set `showLanguageBreakdown: true` only if multilingual is part of the story.
- **Avoid**: enabling all panels when the account is sparse — empty contribution graphs read worse than a missing section.
- **Reader expects**: contribution graph, pinned repos, total stars.
- **Renderer expects**: server-fetched data via GraphQL (with token) or REST fallback; component handles loading/error states.
