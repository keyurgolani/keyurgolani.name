# Authoring portfolio.yml

A practical guide to writing a portfolio that reads well and renders cleanly.

For an AI-assisted authoring flow, point an agent at [docs/skills/portfolio-author/SKILL.md](skills/portfolio-author/SKILL.md).

## Top-level shape

```yaml
identity:
  name: Anamika Devi
  tagline: Distributed systems engineer.
  pronouns: she/her
  location: Bangalore, India
  email: anamika@example.com
  avatar: { src: '/me.jpg', alt: 'Author headshot' }

variant: editorial          # which packages/variant-* renders the page
theme: system               # light | dark | bright | black | system
motionPreference: respect-os # respect-os | reduce | full
colorScheme: warm           # variant-defined ids
typography: classic         # variant-defined ids

links:
  - { url: 'https://github.com/anamika', platform: github }
  - { url: 'https://linkedin.com/in/anamika', platform: linkedin }
  - { url: '/resume.pdf', platform: resume }

sections:
  - kind: hero
    tagline: Building systems that matter at scale.
  - kind: lede
    body: |
      Multi-line prose about who you are and what you do. Markdown is honored.
  # … more sections
```

Every field on `identity`, every section `kind`, every enum is defined in `packages/schema/src/`. That's the source of truth. The fast-reference catalog is at [`docs/skills/portfolio-author/references/schema.md`](skills/portfolio-author/references/schema.md).

## Picking sections

The schema offers ~28 section kinds. Strong portfolios use 6–10. More than that and the page becomes a list-of-lists.

### By career stage

| Stage | Lead with | Often skip |
|---|---|---|
| Early (0–3 yrs) | hero, lede, projects, skills, education, contact | tenure, stats, awards, press |
| Mid (3–8 yrs) | + experience, tenure, github, external-portfolios | discography, patents |
| Senior (8+ yrs) | + stats, awards, talks/publications, focus | education (drop unless prestigious) |
| Career-changer | hero, lede, projects (new domain), skills | tenure, experience tail |

### By intent

| Intent | Lean into | Drop |
|---|---|---|
| Job hunt | experience, projects, skills, contact, cta | press, testimonials |
| Personal brand | hero, lede, writings/talks, github, external-portfolios | services |
| Freelance | services, testimonials, press, cta | skills |
| Academic | publications, talks, awards, patents, education | projects (unless research code) |
| Open-source / maker | github, projects, focus, fun-facts | services, testimonials |
| Photographer / artist | gallery, external-portfolios | skills, stack |

The full matrix lives at [`docs/skills/portfolio-author/references/curation.md`](skills/portfolio-author/references/curation.md).

## Section ordering

Rules of thumb, roughly in order of importance:

1. **`hero` first.** Always.
2. **`lede` second.** Or merge into hero if it fits in one paragraph.
3. **Signal-dense before list-dense.** `tenure`/`stats`/`focus` give visitors context before they scroll into `experience`/`projects`.
4. **Body of work — pick a lead:**
   - **Showcase-first** (default): `projects` → `skills` → `experience` → `education` → `publications` → `writings` → `talks` → `awards`. Lead with strongest work; experience is supporting context.
   - **Resume-first** (recruiter audience): `experience` → `education` → `projects` → `skills` → ... Recruiters skim experience first.
5. **Voice sections (`testimonials`, `press`, `quote`) go LATE.** They're proof points, not opening arguments.
6. **`external-portfolios` and `github` cluster near `contact`.** They're "where else to find me."
7. **`contact`/`cta` are always last.**

The first three sections appear in OG image previews, so treat them like the front cover.

## Section kind quick reference

| Kind | Purpose | Use when |
|---|---|---|
| `hero` | Identity + tagline at the top of the page | Always |
| `lede` | One-paragraph "what I do and why you should care" | Almost always |
| `now` | Current focus — what you're working on this week | High-leverage when fresh, costly when stale |
| `experience` | Chronological work history with role highlights | When jobs matter as proof |
| `education` | Schools, degrees, dates | When recent or prestigious |
| `projects` | Curated body of work, often the resume itself for makers | When projects are stronger than employers |
| `writings` | Blog posts, essays | When you write publicly |
| `publications` | Academic / formal publications | Academia, research |
| `talks` | Conference / podcast appearances | When you speak publicly |
| `awards` | Recognitions | Sparingly |
| `episodes` | Podcast appearances as a guest | When you guest-podcast often |
| `patents` | Filed or granted patents | Industrial / hardware |
| `gallery` | Image grid | Photographers, artists |
| `discography` | Tracks / releases | Musicians |
| `testimonials` | Quoted endorsements | Freelancers, consultants |
| `press` | Articles written about you | Public-facing folks |
| `quote` | Single quote about your work | Like testimonials but tighter |
| `skills` | Grouped skills lists | Engineers (with restraint) |
| `stack` | Curated tools you use | Makers, indies |
| `services` | What you offer for hire | Freelancers |
| `contact` | Email + form / message | Always |
| `cta` | Call-to-action banner before contact | Job hunt, open-to-work |
| `stats` | "By the numbers" headline figures | When numbers tell a story |
| `focus` | What you're optimizing for | Senior IC / leadership |
| `fun-facts` | Off-the-page personal | Personal brand |
| `tenure` | "X years in" headline | Senior, with strong narrative |
| `external-portfolios` | Links to other sites where work lives | Cross-discipline |
| `github` | Live GitHub data | Engineers |

Full per-kind schema with field-by-field docs: [`docs/skills/portfolio-author/references/section-kinds.md`](skills/portfolio-author/references/section-kinds.md).

## Quality rules

Concrete length numbers and tone guidance for user-facing copy live at [`docs/skills/portfolio-author/references/quality-rules.md`](skills/portfolio-author/references/quality-rules.md). The short version:

- **Hero `tagline`:** 4–10 words. One claim, no commas-as-conjunctions.
- **`subtagline`:** 1 sentence, ≤ 120 chars. Adds context to the tagline.
- **`lede.body`:** 60–180 words. One paragraph. Concrete detail, no buzzwords.
- **`experience.items[].highlights[]`:** ≤ 25 words each. Lead with the verb.
- **`projects.items[].description`:** 1–2 sentences. What it does, not how.
- **No emojis** anywhere. Use plain prose.
- **No "passionate about" anything.** It reads as filler.

## Validation

```sh
node docs/skills/portfolio-author/scripts/validate.mjs portfolio.yml
```

Exit 0 = valid. Exit 1 = errors with `<file>:<line>:<col>  <zod-path>  <message>` per error.

`portfolio.example.yml` is the canonical reference — if your file diverges from its shape and the schema rejects it, look at the example for the right shape.

## When you're stuck

If you're not sure which sections fit your situation, hand the [`docs/skills/portfolio-author/`](skills/portfolio-author/) skill to an AI agent (Claude Code, Copilot CLI, Cursor) along with your raw materials (resume, LinkedIn export, GitHub username). The skill is designed to interview you and produce a valid `portfolio.yml`.
