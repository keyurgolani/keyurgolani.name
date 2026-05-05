---
name: portfolio-author
description: >
  Build the portfolio.yml file for the keyurgolani.name self-hostable portfolio platform.
  Use when a user wants to author, revise, or expand their portfolio for this codebase —
  turning whatever they share (resume, LinkedIn profile or export, GitHub username, blog
  posts, project descriptions, or just a conversation) into a valid portfolio.yml with
  the right sections, ordering, tone, and quality bar. Trigger even when the user doesn't
  explicitly say "portfolio.yml" — any request to draft, fill out, polish, or restructure
  their portfolio against this platform qualifies. Do NOT trigger for unrelated portfolio
  systems (e.g. JSON Resume, generic Next.js bio sites, finance portfolios).
license: MIT
compatibility: >
  Designed for the keyurgolani/portfolio platform. Requires read access to packages/schema/
  and write access to portfolio.yml at the repo root.
metadata:
  version: "1.0.0"
---

## 1. What this platform is

The keyurgolani/portfolio platform is a self-hostable, YAML-driven portfolio site. A single `portfolio.yml` at the repo root drives everything the visitor sees. The Next.js host in `apps/web/` reads that YAML, validates it against a Zod schema, and renders it through one of many pluggable visual variants — packages under `packages/variant-*`.

Picking a variant changes the look without touching content; editing the YAML changes content without touching code. The schema is intentionally narrow: roughly two dozen section kinds, each with a fixed shape, all discriminated by a `kind` field. The variant decides how to paint each kind; you decide which kinds to include and what goes in them.

Concrete pointers:

- `packages/schema/src/` — the Zod source of truth. Every field, every section kind, every enum lives here. When the schema and any reference disagree, the schema wins.
- `portfolio.example.yml` at the repo root — the canonical, fully populated example. Treat it as the master fixture for tone, ordering, and field shape. Open it before composing.
- `portfolio.yml` at the repo root — the live file. This is what you write.
- `apps/web/` — the Next.js host that loads `portfolio.yml`, runs validation at build time, and renders the active variant.

This skill teaches you about *this* platform's schema, taxonomy, and quality bar. It does NOT teach you how to read PDFs, scrape LinkedIn, or interview a user — your harness already provides those capabilities. Reach for the references below when you need platform-specific knowledge; reach for your harness's tools for everything else.

## 2. The workflow

Three phases — Gather, Compose, Validate. Loop the last two until validate.mjs is clean. Don't skip phases.

### Gather

Work with whatever the user provides. Don't refuse a source format. Common inputs:

- A resume PDF or DOCX
- A LinkedIn export (JSON / CSV) or live profile URL
- A GitHub username (let your harness fetch repos / READMEs / pinned items)
- A prior `portfolio.yml` from this or another platform
- A blog or personal site URL
- A conversation — answer-by-answer, the user tells you who they are

You decide what to ingest and how. Use your harness's PDF reading, web fetching, or interviewing capabilities. Take notes in scratch memory; do not write a transcript file. Only `portfolio.yml` lands on disk. The output of Gather is enough material — names, dates, projects, links, prose snippets — to begin Compose. If material is thin, ask before composing; don't fabricate.

### Compose

Turn the gathered material into `portfolio.yml`. This is where this skill earns its keep.

- Pick which sections to include. Curation matters more than completeness — load `references/curation.md` when you're choosing.
- Pick the order. Hero first, voice sections late, contact last. (Section 4 has the rules.)
- Choose field shapes per section. Load `references/schema.md` when filling a section's fields. Load `references/section-kinds.md` before adding a kind you haven't used.
- Compose prose to the platform's quality bar. Load `references/quality-rules.md` before writing taglines, ledes, or item summaries.
- Stay grounded in the schema. The Zod schema in `packages/schema/src/` is authoritative; if a reference doc and the schema disagree, the schema wins.

Compose end-to-end before writing. Hold the file in scratch memory; don't sprinkle partial writes. Then write once and move to Validate.

### Validate

After every write, run `node skills/portfolio-author/scripts/validate.mjs portfolio.yml`. Read every error, fix the field at the location it points to, re-run. Iterate until clean. Don't ship a portfolio that doesn't validate. Section 7 has the full loop.

## 3. Working with the user's sources

You will not find playbooks for parsing LinkedIn, resume PDFs, GitHub READMEs, or any other source format here. That's not what this skill teaches. Source-handling is a harness capability, and the right tool varies — Claude Code has different reach than Cursor or Codex. The skill stays neutral so it works the same in every harness.

Use whatever capability your harness has:

- **Read PDFs / DOCX**: if your harness can read attached files, ingest them directly. The user can attach `resume.pdf` and you parse the text out.
- **Browse URLs**: if your harness can fetch web pages, fetch the LinkedIn profile, the GitHub profile, or the existing site. Pull what you need; don't archive.
- **Ask the user to paste**: if file or URL access isn't available, ask the user to paste the relevant text into the chat. A pasted resume is fine source material.
- **Interview**: when the user has nothing prepared, drive an interview turn-by-turn. Start with hero (name, role, one-line tagline), then experience, then projects, then everything else. Ask one thing at a time.
- **Mix sources**: a resume for chronology, a LinkedIn export for skills/endorsements, a GitHub username for live project data — combine them. Cross-reference; flag contradictions to the user.

Do not refuse a source format the user gives you. If you cannot read it directly, ask them to extract or paste. If they want to dictate, take dictation. The skill is source-agnostic on purpose.

## 4. Picking sections (curation principles)

The schema defines roughly two dozen section kinds. Almost no portfolio uses all of them. Curation — choosing which sections fit *this* user, *this* career stage, *this* audience, and *this* intent — is the work. A maximalist YAML that claims everything renders worse than a tight one with five well-chosen sections.

Load `references/curation.md` for the career-stage × intent × audience matrices. The matrices answer concrete questions: "should an early-career engineer include `tenure`?", "does an indie maker need `experience` at all?", "does a writer benefit from a `stats` block?" — questions with specific, opinionated answers in this platform.

Ordering rules apply regardless of which sections you pick:

1. **Hero first.** Always. The hero section sets identity in one screen — name, role, one-line tagline, an avatar if available.
2. **Lede second** (or merge into hero). The one-paragraph "what I do and why you should care" lives directly under the hero.
3. **Signal-dense before list-dense.** A `tenure` summary or `stats` block goes above an `experience` chronology. The visitor gets the gist without scrolling. Lists are for people who already care.
4. **Voice sections (testimonials, press, quote) go LATE.** They're social proof, not lead. Place them after substantive work sections.
5. **Contact / CTA last.** The page ends by telling the visitor what to do next. Don't bury the CTA mid-page.

When in doubt, mirror `portfolio.example.yml`'s ordering — it encodes these rules. Diverge only when the user's intent (e.g. a press kit, a portfolio aimed at a specific recruiter) demands it, and document the reason in your scratch notes.

## 5. Schema reference dispatch

Five reference files live alongside this SKILL.md. Load each at the moment its content is needed; do not preload.

- **`references/schema.md`** — every Zod field, with one-line "use when" guidance. Load when you've decided to include a section and need to know what fields go inside, or when validate.mjs surfaces a path you don't recognize.
- **`references/section-kinds.md`** — the shared section-kind catalog with narrative framing for each kind. Load BEFORE adding a section kind you haven't used recently or aren't sure about. (This file is duplicated in `variant-developer/`; CI keeps them in sync.)
- **`references/quality-rules.md`** — concrete length numbers, tone guidance, do/don't pairs for user-facing copy. Load before composing prose for any section. Load again before validation, as a final pass over taglines and ledes.
- **`references/curation.md`** — career-stage × intent × audience matrices. Load when picking which sections to include or how to order them, especially if the user's profile is unusual (career changer, multi-discipline, very early career).
- **`references/examples.md`** — three abridged real-world drafts (engineer, photographer, writer) showing this platform's tone. Load if the user hasn't seen platform output before, or if you need a tone anchor while drafting.

Loading the wrong reference at the wrong time wastes context. Loading none and guessing the schema produces invalid YAML. Be deliberate.

## 6. Output policy

Where the file lands and how:

- **Write to `portfolio.yml` at the repo root.** Not in `apps/web/`, not in a subfolder. The host loads it from the root via `loadPortfolio()`.
- **Backup before overwrite.** If `portfolio.yml` already exists, FIRST copy it to `portfolio.yml.bak.<unix-timestamp>` (e.g. `portfolio.yml.bak.1714752000`). THEN write the new file. Never silently overwrite. The user's previous draft must always be recoverable.
- **Preserve the top-of-file comment block from `portfolio.example.yml`.** That header documents the format for humans who open the file. Keep it intact at the top of every `portfolio.yml` you write. If you've changed format conventions, update the header; don't drop it.
- **No interview transcript persisted.** The conversation that produced the file is not archived. Only the final `portfolio.yml` lands on disk. The user's words belong to the user.
- **One file, one write per cycle.** Don't sprinkle partial writes; compose in scratch, then write once, then validate.
- **After writing, run validate.mjs.** See Section 7.

The output is the artifact. Everything else — the gathered notes, the curation reasoning, the rejected drafts — stays in scratch.

## 7. Validation loop

The loop is non-negotiable. Run after every write.

1. After every write to `portfolio.yml`, run `node skills/portfolio-author/scripts/validate.mjs portfolio.yml`.
2. **Exit 0** — done with validation. Hand off (Section 9).
3. **Exit 1** — read the errors. Each error has format `<file>:<line>:<col>  <zod-path>  <message>`. The line/col points to the YAML position; the zod-path tells you which schema field failed; the message tells you why. Fix the field at that location.
4. Re-run validate.mjs.
5. Repeat until clean.

Don't ship a portfolio that doesn't validate. The validator is fast; running it ten times in a row is fine. Skipping it once produces a broken site at build time.

Length-rule warnings from `quality-rules.md` are soft (validate still exits 0). Do not ignore them — they signal copy that's about to look bad in the variant. Address every warning before declaring done, or document why it's acceptable in your final report to the user.

## 8. Gotchas

Environment-specific facts that bite agents who skip the references:

- The schema's `kind` field is a Zod **discriminant** — misspelling it (`expereince`, `Project`) silently drops the section from rendering. Always validate. Spelling matters.
- `period.start` and `period.end` accept loose strings (`"Jan 2024"`, `"2024-01"`, `"present"`). Prefer human-readable (`"Jan 2024"`) over ISO when source is ambiguous — readers see this output, not parsers.
- Avatar paths are relative to `apps/web/public/`. `avatar: { src: '/me.jpg' }` ⇒ a real file at `apps/web/public/me.jpg`. Resume PDFs follow the same rule (`/resume.pdf` ⇒ `apps/web/public/resume.pdf`). The platform doesn't fetch arbitrary URLs.
- `links[].platform` is an enum with rendering implications (icon, label, ordering). Use values listed in `references/schema.md`; for unknown platforms, omit `platform` and use `label` only — the variant will fall back to a generic link presentation.
- The `tagline` and `subtagline` fields each have a recommended max — see `references/quality-rules.md`. Hero variants truncate gracefully but the editorial variant doesn't. Stay under the cap.
- Section ordering matters for SEO — the first three sections appear in the OG image preview. Hero + lede + (one signal-dense section like `tenure` or `stats`) is the canonical opening.
- This platform's photographers, makers, and writers all use the same schema. Don't assume a default audience — read what the user gives you. A wedding photographer's portfolio looks very different from a backend engineer's, and both are valid uses of the same YAML.

## 9. Hand-off

When the file validates and the user is happy with the draft:

- Tell them to run `pnpm dev` from the repo root and visit `http://localhost:3000` to see it rendered.
- Mention `/variants` — they can preview their content in every available variant and pick a different look without touching the YAML.
- **Don't run `pnpm dev` for them unless they ask.** Their dev environment is theirs to control. Suggest, don't auto-launch.
- Point them at `portfolio.yml.bak.<timestamp>` if you wrote a backup, so they know how to roll back.

That's the skill. Validate, hand off, stop.
