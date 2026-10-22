# Section kinds: narrative reference

> Each kind, narrative form: when it shines, when to skip it, ideal data
> shape, what readers expect to see. Loaded by the agent before adding a
> section it hasn't used. Audience: both portfolio authors composing
> portfolio.yml AND variant developers designing renderers. The same content
> serves both because both need to know what data lives in each section.
>
> Version 3: a portfolio's content is records (works, evidence, chronology
> entries, media assets) with ids, plus one practice and one contact record.
> Sections place them in reading order; they don't hold them. A section with
> nothing public to show leaves the page and the navigation.

## When-to-use matrix

| Kind         | Use when…                                                                   | Skip when…                                             |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `hero`       | Always. First section.                                                      | Never.                                                 |
| `lede`       | The user has a paragraph-length bio that earns the space.                   | Their bio fits in the hero subtagline.                 |
| `works`      | Almost always: it's the body of work, whatever the medium.                  | Nothing made is public yet.                            |
| `evidence`   | There are checkable facts: metrics, testimonials, publications, talks.      | The facts are unverifiable or vanity numbers.          |
| `chronology` | The path itself is proof: roles, studies, milestones.                       | The work speaks for itself and dates add nothing.      |
| `practice`   | There's a thesis worth one sentence, or grouped skills, tools, or services. | A tag cloud would be the whole of it.                  |
| `now`        | Updated monthly with current focus (nownownow.com style).                   | They won't update it: staleness is worse than absence. |
| `focus`      | A few things are getting energy this quarter.                               | Vague aspirations rather than concrete focuses.        |
| `quote`      | One signature quote that lands hard.                                        | Several quotes: those are testimonial evidence.        |
| `fun-facts`  | Personality-additive bullets.                                               | Forced: reads like a LinkedIn "fun fact."              |
| `github`     | Has public OSS work.                                                        | Empty or private GitHub.                               |
| `custom`     | Content no other kind holds.                                                | Another kind fits, even loosely.                       |
| `cta`        | One strong call to action at the end.                                       | The hero already has it.                               |
| `contact`    | Always include something contact-shaped.                                    | Never: at least an email or a link.                    |

## Records, not section items

Version 2 had a section kind per item type (`projects`, `talks`, `gallery`, `experience`, and so on). Version 3 has three list kinds, and the record says what it is:

| Content                                                            | Record                                                                     | Section                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------- |
| Projects, essays, records, episodes, photo series, objects         | A work, with `medium` (`software`, `writing`, `music`, `image-series`, …)  | `works`                     |
| Metrics, testimonials, publications, talks, awards, patents, press | Evidence, with `type` (`metric`, `testimonial`, `publication`, `talk`, …)  | `evidence`                  |
| Jobs, degrees, residencies, milestones                             | A chronology entry, with `kind` (`role`, `study`, `event`, `milestone`, …) | `chronology`                |
| Skills, tools, services, a thesis                                  | One part of `practice`                                                     | `practice`, with `part`     |
| Images, audio, video, documents                                    | A media asset, which placements name                                       | Wherever a record places it |

One work can sit in several sections, and in the curation lists (`signature`, `featured`, `archive`). Its id is its anchor on the first visible section that lists it.

## Per-kind detail

### `hero`

- **Ideal**: `tagline` (≤80 chars), `subtagline` (≤120 chars), 1–2 `ctas`, each with its `label`. `greeting` optional, often skipped.
- **Avoid**: marketing-speak. "Award-winning" is not a tagline.
- **Reader expects**: `identity.name` + a one-line claim that's specific.
- **Renderer expects**: title rendered large, subtagline below, CTAs as a button cluster. Some variants compose all into a single typographic moment. Nothing it didn't get is made up.

### `lede`

- **Ideal**: 150–400 words. Markdown allowed in `body`. A `title` if the page should name it; there's no default heading.
- **Avoid**: a paragraph that re-states the tagline.
- **Reader expects**: a real bio paragraph that earns its space.
- **Renderer expects**: long-form prose, often constrained to ~38rem measure.

### `works`

- **Ideal**: 3–8 works in reading order, the signature or the strongest first. Each work has a one-line `summary`, a `cover` when it's visual, and 2–4 `highlights` or cited `evidence` naming traction. The signature work, and any worth a page of its own, gets a `caseStudy` and a `slug`.
- **Avoid**: 30 repos with no curation; tutorials; a work with no summary.
- **Reader expects**: things they can click into; what was made and what came of it.
- **Renderer expects**: a card, list, or gallery layout chosen by the works' `medium`: image-forward for `photography` and `image-series`, title-and-date for `writing`, playable for `music` and `audio-video`. A work with a case study links to `/work/<slug>`.

### `evidence`

- **Ideal**: 3–6 entries of one register: a strip of metrics (each with `metric.key` and a numeric `value`), a few testimonials (statement plus `source` with name and role), a citation list (publications with `authors`, `venue`, `publishedAt`, `doi`), talks (`venue`, `presentedAt`, `format`), awards (`organization`, `receivedAt`), patents (`number`, `status`), or press (`publication`, `excerpt`).
- **Avoid**: vanity metrics; anonymous quotes; mixing a metric strip and a citation list in one section (make two).
- **Reader expects**: third-party, checkable signal: who said it, where it ran, what the number counts.
- **Renderer expects**: large-number tiles for metrics, pull quotes for testimonials, citation blocks for publications, dated lists for talks and awards, rendered by each entry's `type`. A number shows as written, with no decoration around it.

### `chronology`

- **Ideal**: the 3–6 roles or studies that explain the work, each with `title`, `organization`, `period`, and 2–4 `highlights` naming outcomes. List them in `items`, or leave `items` out for every public entry, newest first. `thread`, `branchesFrom`, and `mergesInto` draw lanes when the path branched.
- **Avoid**: every job since high school; highlights that describe responsibilities instead of outcomes.
- **Reader expects**: a timeline with recent entries richer than older ones.
- **Renderer expects**: a dated list or a lane diagram, with optional logos and skills.

### `practice`

- **Ideal**: one part per section. `thesis` is a sentence or two on what the practice is. `skills` is 3–5 named groups of 4–8 items; `tools` the ones in active use, with `version` and `url` when they help; `services` 1–4 productized offerings with `pricing` (even "Contact for rate") and `highlights`.
- **Avoid**: a flat 50-item skill list; an aspirational stack; vague "happy to chat" services.
- **Reader expects**: scannable buckets, a "uses" page in miniature, or a pricing page in miniature.
- **Renderer expects**: grouped tag clusters, tool rows, or service cards, by `part`.

### `contact`

- **Ideal**: a short `contact.message` setting tone, and 1–3 contact `links`. Give the section `id: contact` so the hero's CTA can anchor to it.
- **Avoid**: six redundant social links; a message that promises a reply time nobody keeps.
- **Reader expects**: one obvious way to reach the human.
- **Renderer expects**: the contact record, `identity.email`, and `links`, as a low-friction block. Nothing it shows is made up: no availability badge.

### `now`

- **Ideal**: 3–7 short bullets in `body` (Markdown). Update monthly; set `asOf` to the month of the last edit.
- **Avoid**: a stale "now": older than 6 weeks reads as careless.
- **Reader expects**: present-tense, current focus.
- **Renderer expects**: a short list, with its `asOf` date when there is one.

### `focus`

- **Ideal**: 3–5 short labels (≤6 words each). Distinct from `now` (prose) and practice skills (comprehensive).
- **Avoid**: aspirations ("learn Rust someday"); skills restated.
- **Reader expects**: chips that name what's getting energy this quarter.
- **Renderer expects**: a tag or chip cluster, often as a hero-adjacent strip.

### `quote`

- **Ideal**: a single line that says something true about the work. `attribution`, optional `source` and `sourceUrl`.
- **Avoid**: motivational-poster quotes.
- **Reader expects**: an epigraph: typographic, brief, deliberately placed.
- **Renderer expects**: oversized, centred, low density. Often a section break of its own.

### `fun-facts`

- **Ideal**: 3–5 specific, weird, true sentences. Each one a tiny story.
- **Avoid**: "I love coffee," the LinkedIn-fun-fact reflex. If you'd say it on a dating app, skip it.
- **Reader expects**: personality without performance.
- **Renderer expects**: a bullet list, often near the end.

### `github`

- **Ideal**: `username` plus 1–6 `featuredRepos` to surface specific work. Set `showLanguageBreakdown: true` only if multilingual is part of the story.
- **Avoid**: enabling every panel when the account is sparse: empty contribution graphs read worse than a missing section.
- **Reader expects**: contribution graph, pinned repos, total stars.
- **Renderer expects**: the snapshot frozen at `snapshots/github.json` with the date it was taken, never a fetch at render time. Without one, the profile link alone.

### `custom`

- **Ideal**: a `title`, a `body`, and a few `items` (`title`, `summary`, placements in `media`, cited `evidence`, `links`) for content no other kind holds, such as a workshop series.
- **Avoid**: using it for works or evidence, which then miss their own renderers, the feed, and JSON-LD.
- **Reader expects**: a plain section that reads like the rest of the page.
- **Renderer expects**: always the shared fallback renderer: heading, body, item list.

### `cta`

- **Ideal**: one strong line in `description` + `primaryAction` with its `label`. Use as a closing band, not mid-page.
- **Avoid**: more than one CTA section per portfolio; competing with the hero's CTAs.
- **Reader expects**: a direct ask after seeing the work.
- **Renderer expects**: a full-width band, button-prominent, near the end of the page.
