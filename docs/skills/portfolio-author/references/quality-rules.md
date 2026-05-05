# Quality rules

> Concrete rules with a why and a bad/good pair each. The agent loads
> this before composing prose, and again before validation. Length rules
> are recommendations (not schema-enforced); validate.mjs will warn but
> not fail.

## Length rules

- `identity.tagline`: ≤80 chars.
  - Why: longer truncates in OG image previews; readers scan it in <2 seconds.
  - Bad: "Software engineer with 12+ years of experience building scalable distributed systems for ad-tech."
  - Good: "Distributed systems engineer turning ad rendering into research."

- `hero.subtagline` (and `identity` subtagline if used): ≤120 chars.
  - Why: it's a second beat after the tagline, not a paragraph. Past 120 chars it competes with the lede.
  - Bad: "Currently leading the rewrite of our pricing service while also mentoring three juniors and writing a book on distributed consensus."
  - Good: "11 years across pricing, search, and ad rendering. Currently exploring new roles."

- `lede.body`: 150–400 words.
  - Why: under 150 it's a tagline in disguise; over 400 it stops being scanned.
  - Bad: a 700-word potted autobiography starting at university.
  - Good: three short paragraphs — what you work on, what you've shipped, what you're chasing next.

- `hero.greeting`: ≤30 chars.
  - Why: it's a stage-setter, not a sentence. "Hello, I'm" is the canonical shape.
  - Bad: "Welcome to my personal website where I share my work and writing."
  - Good: "Hello, I'm" — or omit entirely.

- `experience.items[].description`: ≤160 chars.
  - Why: this is the line under the role, not the bullet list. Long descriptions push highlights out of the viewport.
  - Bad: "I joined the team in 2019 and have since worked on a wide variety of projects spanning rendering, pricing, and serving."
  - Good: "Owned the ad rendering path: 1.1T impressions/year across web and mobile."

- `experience.items[].highlights[]`: each ≤140 chars; aim for 3–5 per role.
  - Why: highlights are scanned, not read. One verb, one number, one outcome.
  - Bad: "Was responsible for various improvements to the system over multiple quarters."
  - Good: "Cut P99 latency 9x (380ms → 42ms) by rewriting hot path in Rust."

- `projects.items[].description`: ≤200 chars.
  - Why: project cards live in grids; long descriptions break alignment.
  - Bad: a paragraph explaining the project's history, motivation, and roadmap.
  - Good: "Sub-millisecond key-value store with predictable tail latency. Used in three production services."

- `projects.items[].summary`: ≤100 chars.
  - Why: the summary is the sub-headline below the project name. Anything longer belongs in `description`.
  - Bad: "An ambitious rewrite of our internal pricing engine to support millisecond-scale price discovery."
  - Good: "Sub-millisecond pricing engine."

- `talks.items[].description`: ≤180 chars.
  - Why: talk cards display a venue + date + one-liner. Abstracts go in `abstract`, not `description`.
  - Bad: a 4-sentence abstract teaser.
  - Good: "Why backpressure beats retries when the downstream is the bottleneck."

- `services.items[].description`: ≤220 chars.
  - Why: services pages convert. A buyer scans the headline, the price, and one sentence — not three.
  - Bad: a marketing paragraph with three clauses.
  - Good: "Two-week reliability audit: traffic patterns, failure modes, capacity headroom. Written report + readout."

- `now.body`: 30–120 words.
  - Why: a `now` page is a snapshot, not a memoir. If it grows past 120 words, promote chunks into `focus` or `experience`.
  - Bad: a list of every project with status updates.
  - Good: "Leading reliability for payments. Writing about partial failures. Off-hours: a slow rewrite of an old C++ project in Rust."

- `contact.message`: ≤180 chars.
  - Why: the contact block is a doorway, not a destination. Long messages dilute the call to action.
  - Bad: "Please feel free to reach out to me at any time, I am always open to interesting conversations and would love to hear from you about anything related to my work or potential collaborations."
  - Good: "Best reached on LinkedIn. Open to senior-IC and tech-lead roles."

## Tone rules

- **Specific over grandiose.** Concrete numbers, named systems, dates. Avoid superlatives without evidence.
  - Bad: "World-class engineer who delivers exceptional results."
  - Good: "Engineer at Amazon Ads — owns the rendering path serving 1.1T impressions/year."

- **Active voice over passive.** "Built" not "was responsible for the building of." Passive voice hides the subject; on a portfolio, the subject is you.
  - Bad: "The pricing service was rewritten and a 9x improvement in P99 was achieved."
  - Good: "Rewrote the pricing service. P99 dropped 9x."

- **Show, don't tell.** Don't say "skilled communicator" — let `talks` and `writings` show it. Don't say "leader" — let `experience` describe what you led.
  - Bad: "Strong communicator and natural leader."
  - Good: a `talks` entry at a conference + an `experience` highlight that says "Led a team of 6 through a quarter-long rewrite."

- **Outcomes over responsibilities.** Hiring managers buy outcomes; recruiters skim for them too.
  - Bad: "Responsible for owning and driving the reliability initiative."
  - Good: "Took the reliability budget from 99.5% to 99.95% in two quarters."

- **Plain words over jargon.** "Made it faster" beats "delivered performance optimizations." Jargon signals insecurity, not seniority.
  - Bad: "Leveraged synergies across cross-functional stakeholders to drive impact."
  - Good: "Convinced three teams to adopt a shared rate-limiter. Outage count dropped from weekly to zero."

## Voice rules

- **First person is fine.** Don't avoid "I" at the cost of clarity. The portfolio is the user's first-person artifact — third-person reads as a corporate bio.
  - Bad: "Anamika is a distributed systems engineer who has worked at multiple companies."
  - Good: "I'm a distributed systems engineer. The last 11 years: pricing, search, and ad rendering."

- **Cut hedges.** "I think we managed to" → "we shipped". Hedges read as either false modesty or actual uncertainty; neither helps you.
  - Bad: "I think I helped contribute to maybe a 20–30% improvement."
  - Good: "Shipped a 28% improvement, measured on production traffic."

- **No marketing voice.** Portfolios are read by people who can smell brochure copy. Trust the work to speak.
  - Bad: "Passionate, driven, results-oriented engineer empowering teams to unlock their potential."
  - Good: "Engineer. Most days: distributed systems. Best days: removing code."

- **Variety in sentence length.** A page of identical-length sentences reads like a CV in disguise. Mix short with long.
  - Bad: "I worked at Amazon. I worked on pricing. I left in 2024. I joined Stripe."
  - Good: "Five years at Amazon — pricing, then search. Left in 2024 to work on payment-rails infra at Stripe."

## Section-specific rules

- `hero.subtagline` should differ from `identity.tagline` — they appear back-to-back. If they say the same thing twice, drop one.
- `experience.items[].highlights` should be outcome-bullets (built X, shipped Y, reduced Z by N%), not responsibility-bullets ("responsible for", "managed", "owned the process of"). If a highlight has no verb-result-number triple, it's probably filler.
- `projects.items[].description` should answer "what is it?" before "why it's interesting." Don't make the reader infer the artifact from the prose.
- `testimonials.items[].quote` should be ≤220 chars. Long quotes get truncated by variant renderers; pick the one tight sentence the quote leans on.
- `stats.items[].value` should be a single token (a number, optionally with a suffix). "8B+", "$1.2B", "42ms" — not "approximately 8 billion."
- `focus.items[]` should be 1–3 word phrases, not full sentences. If you find yourself writing a sentence, you want `now`, not `focus`.
