---
name: portfolio-author
description: >
  Build the portfolio.yml and site.yml documents for the keyurgolani.name self-hostable
  portfolio platform. Use when a user wants to author, revise, or expand their portfolio
  for this codebase, turning whatever they share (resume, LinkedIn profile or export,
  GitHub username, blog posts, project descriptions, or just a conversation) into a valid
  pair with the right sections, ordering, tone, and quality bar. Trigger even when the
  user doesn't explicitly say "portfolio.yml": any request to draft, fill out, polish, or
  restructure their portfolio against this platform qualifies. Do NOT trigger for
  unrelated portfolio systems (e.g. JSON Resume, generic Next.js bio sites, finance
  portfolios).
license: MIT
compatibility: >
  Designed for the keyurgolani/portfolio platform. Requires read access to packages/schema/
  and write access to config/portfolio.yml and config/site.yml.
metadata:
  version: '3.0.0'
---

## 1. What this platform is

The keyurgolani/portfolio platform is an open-source, self-hostable portfolio site configured by two documents. `config/portfolio.yml` holds the content: identity, links, the body of work as records, and the sections that place them. `config/site.yml` holds the presentation: the variant, color scheme, typography, display mode, motion policy, features, and which sections are hidden. Deployment settings and secrets come from the environment and never go in either document. The Next.js host in `apps/web/` validates the pair at startup and renders the portfolio through the site's variant, one of the packages under `packages/variant-*`.

Changing `site.yml` changes the look without touching content; editing `portfolio.yml` changes content without touching code. The portfolio document is version 3: a body of work. Works (what the person made), evidence (checkable facts about it), chronology entries (roles, studies, milestones), and media assets are records, each with an id; one `practice` and one `contact` record sit beside them; `signature`, `featured`, `proof`, and `archive` curate them; and 14 section kinds place them in reading order. None of it assumes a profession: a work's `medium` and an evidence entry's `type` say what it is. The variant decides how to paint each kind; you decide what to write and how to place it.

Concrete pointers:

- `packages/schema/src/`: the Zod source of truth. Every field, every section kind, every enum lives here. When the schema and any reference disagree, the schema wins.
- `docs/configuration.md`: both documents, field by field, with every diagnostic code.
- `portfolio.example.yml` and `site.example.yml` at the repo root: the canonical, fully populated examples. Treat them as the master fixtures for tone, ordering, and field shape. Open them before composing.
- `config/portfolio.yml` and `config/site.yml`: the live documents (gitignored). This is what you write.
- `apps/web/`: the Next.js host that loads the pair from `config/`, validates it at startup, and renders the site's variant.

This skill teaches you about _this_ platform's schema, taxonomy, and quality bar. It does NOT teach you how to read PDFs, scrape LinkedIn, or interview a user; your harness already provides those capabilities. Reach for the references below when you need platform-specific knowledge, and for your harness's tools for everything else.

## 2. The workflow

Three phases: Gather, Compose, Validate. Loop the last two until validate.mjs is clean. Don't skip phases.

### Gather

Work with whatever the user provides. Don't refuse a source format. Common inputs:

- A resume PDF or DOCX
- A LinkedIn export (JSON / CSV) or live profile URL
- A GitHub username (let your harness fetch repos / READMEs / pinned items)
- A prior `portfolio.yml` from this or another platform. One from this platform's earlier releases, a `schemaVersion: 2` document or the unversioned one-file format, is converted with `pnpm config:migrate`, not by hand.
- A blog or personal site URL
- A conversation: answer by answer, the user tells you who they are

You decide what to ingest and how. Use your harness's PDF reading, web fetching, or interviewing capabilities. Take notes in scratch memory; do not write a transcript file. Only the two documents land on disk. The output of Gather is enough material (names, dates, projects, links, prose snippets) to begin Compose. If material is thin, ask before composing; don't fabricate.

### Compose

Turn the gathered material into the pair. This is where this skill earns its keep.

- Write the records first: a work for each thing made, evidence for each checkable fact, a chronology entry for each role or study, and a media asset for each image. Then curate: one `signature`, two to four `featured`, the `proof` facts, and an `archive`. Curation matters more than completeness; load `references/curation.md` when you're choosing.
- Pick the sections and their order. Hero first, the work early, voice sections late, contact last. (Section 4 has the rules.)
- Give every section, record, and media asset an `id`: lowercase words joined by hyphens, unique in the whole document, never `main`. It's the anchor, so use the word a visitor would expect in a link, such as `work` or `get-in-touch`. `pnpm config:ids-fix` mints any you leave out, keeping the file's comments.
- Choose field shapes. Load `references/schema.md` when filling a record's or a section's fields. Load `references/section-kinds.md` before adding a kind you haven't used.
- Leave out what you haven't got. An empty string or an empty list is an error, not a blank, and nothing renders in place of a missing field.
- Compose prose to the platform's quality bar. Load `references/quality-rules.md` before writing taglines, ledes, or item summaries.
- Write `site.yml` from `site.example.yml`: keep its `appearance`, `visitorControls`, `motionPolicy`, and `features` unless the user asks for something else, and hide a section there (`sections.<id>.hidden: true`) instead of deleting it when the user wants it off the page for now. A record that isn't ready gets `visibility: private`.
- Stay grounded in the schema. The Zod schema in `packages/schema/src/` is authoritative; if a reference doc and the schema disagree, the schema wins.

Compose end to end before writing. Hold both documents in scratch memory; don't sprinkle partial writes. Then write once and move to Validate.

### Validate

After every write, run `node skills/portfolio-author/scripts/validate.mjs config`. It checks `config/portfolio.yml` and `config/site.yml` together. Read every error, fix the field at the location it points to, re-run. Iterate until clean. Don't ship a portfolio that doesn't validate. Section 7 has the full loop.

## 3. Working with the user's sources

You will not find playbooks for parsing LinkedIn, resume PDFs, GitHub READMEs, or any other source format here. That's not what this skill teaches. Source handling is a harness capability, and the right tool varies: Claude Code has different reach than Cursor or Codex. The skill stays neutral so it works the same in every harness.

Use whatever capability your harness has:

- **Read PDFs / DOCX**: if your harness can read attached files, ingest them directly. The user can attach `resume.pdf` and you parse the text out.
- **Browse URLs**: if your harness can fetch web pages, fetch the LinkedIn profile, the GitHub profile, or the existing site. Pull what you need; don't archive.
- **Ask the user to paste**: if file or URL access isn't available, ask the user to paste the relevant text into the chat. A pasted resume is fine source material.
- **Interview**: when the user has nothing prepared, drive an interview turn by turn. Start with the hero (name, role, one-line tagline), then the work and what backs it up, then roles and studies, then everything else. Ask one thing at a time.
- **Mix sources**: a resume for chronology, a LinkedIn export for skills and endorsements, a GitHub username for live project data. Combine them, cross-reference, and flag contradictions to the user.

Do not refuse a source format the user gives you. If you cannot read it directly, ask them to extract or paste. If they want to dictate, take dictation. The skill is source-agnostic on purpose.

## 4. Picking sections (curation principles)

The schema has 14 section kinds, and most of the choosing is about records, not kinds: which works to show, which one leads, which facts back them up. Curation, choosing what fits _this_ user, _this_ career stage, _this_ audience, and _this_ intent, is the work. A maximalist portfolio that claims everything renders worse than a tight one with five well-chosen sections.

Load `references/curation.md` for the career-stage × intent × audience matrices. The matrices answer concrete questions, such as "should an early-career engineer lead with a tenure metric?", "does an indie maker need a chronology at all?", and "does a writer benefit from metric evidence?", with specific, opinionated answers for this platform.

Ordering rules apply regardless of which sections you pick. The order of `sections` is the page order:

1. **Hero first.** Always. The hero section sets identity in one screen: name, role, one-line tagline, and an avatar if available.
2. **The work early.** The `works` section with the signature and the featured works comes right after the hero, or after a short `lede`.
3. **Proof before context.** An `evidence` section of metrics goes above the `chronology`. The visitor gets the gist without scrolling. Lists are for people who already care.
4. **Voice goes LATE.** Testimonial and press evidence and a `quote` are social proof, not the lead. Place them after the substantive work sections.
5. **Contact / CTA last.** The page ends by telling the visitor what to do next. Don't bury the CTA mid-page.

When in doubt, mirror `portfolio.example.yml`'s ordering, which encodes these rules. Diverge only when the user's intent (a press kit, a portfolio aimed at a specific recruiter) demands it, and note the reason in your scratch notes.

## 5. Schema reference dispatch

Five reference files live alongside this SKILL.md. Load each at the moment its content is needed; do not preload.

- **`references/schema.md`**: every field in both documents, records and sections, with one-line "use when" guidance. Load when you're writing a record or a section and need to know what fields go inside, or when validate.mjs surfaces a path you don't recognize.
- **`references/section-kinds.md`**: the shared section-kind catalog with narrative framing for each kind. Load BEFORE adding a section kind you haven't used recently or aren't sure about. (This file is duplicated in `variant-developer/`; CI keeps them in sync.)
- **`references/quality-rules.md`**: concrete length numbers, tone guidance, and do/don't pairs for visitor-facing copy. Load before composing prose for any section. Load again before validation, as a final pass over taglines and ledes.
- **`references/curation.md`**: career-stage × intent × audience matrices. Load when picking which sections to include or how to order them, especially if the user's profile is unusual (career changer, multi-discipline, very early career).
- **`references/examples.md`**: three abridged real-world drafts (an engineer, a designer-engineer, a maker-photographer) showing this platform's tone and the version 3 shape. Load if the user hasn't seen platform output before, or if you need a tone anchor while drafting.

Loading the wrong reference at the wrong time wastes context. Loading none and guessing the schema produces invalid documents. Be deliberate.

## 6. Output policy

Where the documents land and how:

- **Write to `config/portfolio.yml` and `config/site.yml`.** Not in `apps/web/`, not at the repo root. `pnpm dev` and the Docker Compose example read them from `config/`, which must hold exactly one portfolio document and one site document (`.yml`, `.yaml`, or `.json`; a `.bak.<timestamp>` copy doesn't count).
- **Under `owner`, writing isn't publishing.** With the owner profile (`deploy/compose.owner.yml`), the server's first start imports the files in `config/`, and from then on they're import input: what you write goes live only through `portfolio-store import` or a Studio publish. After validation, tell the user it isn't live until they import it or publish it in Studio.
- **Backup before overwrite.** If a document already exists, FIRST copy it to `config/<name>.bak.<unix-timestamp>` (e.g. `config/portfolio.yml.bak.1714752000`). THEN write the new file. Never silently overwrite. The user's previous draft must always be recoverable.
- **Preserve the top-of-file comment blocks from the examples.** Each header documents its format for humans who open the file. Keep it intact at the top of each document you write. If you've changed format conventions, update the header; don't drop it.
- **No interview transcript persisted.** The conversation that produced the documents is not archived. Only the two documents land on disk. The user's words belong to the user.
- **No secrets and no deployment settings.** A token, a key, a password hash, or the site's origin never goes in either document. Startup refuses a secret-shaped string, and the origin is the deployment's `PORTFOLIO_ORIGIN`.
- **One write per document per cycle.** Don't sprinkle partial writes; compose in scratch, write once, then validate.
- **After writing, run validate.mjs.** See Section 7.

The output is the artifact. Everything else, the gathered notes, the curation reasoning, the rejected drafts, stays in scratch.

## 7. Validation loop

The loop is non-negotiable. Run it after every write.

1. After every write to `config/portfolio.yml` or `config/site.yml`, run `node skills/portfolio-author/scripts/validate.mjs config`.
2. **Exit 0**: done with validation. Hand off (Section 9).
3. **Exit 1**: read the errors. Each starts `<file>:<line>:<col>: <code> (<severity>) at <JSON pointer>`, then says what's wrong and how to fix it. The line and column point to the YAML position, and the pointer to the field. A `source.*` record is about the file itself, so it starts `<file>: <code> (<severity>)`, with no position or pointer. Fix the field at that location. `docs/configuration.md` explains every code.
4. Re-run validate.mjs.
5. Repeat until clean.

Don't ship a portfolio that doesn't validate. The validator is fast; running it ten times in a row is fine. Skipping it once produces a server that refuses to start.

Warnings don't fail validation (it still exits 0), and neither do the length rules in `quality-rules.md`, which validate.mjs doesn't check. Don't ignore either: they signal copy or links that are about to look bad. Address every one before declaring done, or explain why it's acceptable in your final report to the user.

## 8. Gotchas

Environment-specific facts that bite agents who skip the references:

- A section's `kind` field is a Zod **discriminant**. Misspelling it (`wroks`, `Evidence`) is a `schema.invalid` record with a did-you-mean hint: the server won't start on it, and under `pnpm dev` the page shows an error until it's fixed. The version 2 kinds (`projects`, `experience`, `stats`, `gallery`, and so on) are gone: their content is records now. Always validate. Spelling matters.
- Every object is strict. A key the schema doesn't define is refused, whatever its value. Data the schema has no field for goes under `extensions`, keyed by an npm package name. It's kept and checked, but no variant shows it to visitors.
- Every section, record, and media asset needs an `id`, and no two may share one: sections and records share one set. A `#fragment` link (a CTA's `#contact`, say) must name a visible section's or record's id. A reference (a section's `items`, `featured`, a work's `evidence`, a placement's `asset`) must name a record of the right type.
- `period.start` and `period.end` accept loose strings (`"Jan 2024"`, `"2024-01"`, `"present"`). Prefer human-readable (`"Jan 2024"`) over ISO when the source is ambiguous: readers see this output, not parsers.
- An image is a media asset, `{ id, kind: image, source, alt }`, and every place that shows it is a placement, `{ asset: <id> }`: `identity.avatar`, a work's `cover` and `media`, an evidence source's `avatar`, a chronology entry's `logo`. `source` is a path under the media root, such as `rowan/portrait.jpg` (no leading `/`), or an https URL. Write alt text that says what it shows, on the asset, or `decorative: true`; a caption isn't alt text. The server derives sized renditions from the source and serves those, never the original; an image renders as unavailable until they derive, or when its source is missing. Link URLs such as `/resume.pdf` are still paths under `apps/web/public/`.
- `links[].platform` is free-form, but variants pick an icon, a label, and an order from known values, the ones `references/schema.md` lists. For an unknown platform, omit `platform` and use `label` only; the variant falls back to a generic link.
- The `tagline` and `subtagline` fields each have a recommended maximum; see `references/quality-rules.md`. Some compositions truncate a long one gracefully and some don't. Stay under the cap.
- A metric is evidence of type `metric` with `metric: { key, value, unit? }`. The value is a number; anything else belongs in the `statement`. Give it a key, so the same figure stated twice is checked (`metric.conflict`).
- A work with a `caseStudy` needs a `slug`: it gets its own page at `/work/<slug>`.
- The first sections are what a visitor sees before scrolling. Hero, the signature work, and one strip of proof is the canonical opening.
- This platform's photographers, makers, musicians, academics, and writers all use the same schema. Don't assume a default audience; read what the user gives you. A wedding photographer's portfolio looks very different from a backend engineer's, and both are valid uses of the same documents.

## 9. Hand-off

When the pair validates and the user is happy with the draft:

- Tell them to run `pnpm dev` from the repo root and visit `http://127.0.0.1:3000` to see it rendered.
- Mention `appearance.variant` in `site.yml`: changing it switches the whole look without touching the content, and `pnpm dev` shows the change on the next page load. Each variant has its own color scheme and typography ids, listed in its manifest, so those change with it.
- **Don't run `pnpm dev` for them unless they ask.** Their dev environment is theirs to control. Suggest, don't auto-launch.
- Point them at the `.bak.<timestamp>` copies if you wrote backups, so they know how to roll back.

That's the skill. Validate, hand off, stop.
