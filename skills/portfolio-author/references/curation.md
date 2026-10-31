# Curation principles: picking and ordering

> The opinionated bit. Loaded when deciding which records to write, which to
> curate, and which sections to place them in, in what order.

## Step 0: read what the user already has

Before picking anything, anchor on what the user has shared. Don't write a record just because the schema has a field for it, and don't add a section just because the schema offers the kind. One talk is better as a sentence in the lede than as an `evidence` section of one. A single generic quote is worse than no testimonial at all.

When in doubt: ask, don't pad. A strong portfolio places 6 to 10 sections.

## Step 1: the work

Start with what the user made. Each project, essay, record, series, or object worth showing is a work, with the `medium` that says what it is. Then curate:

- **`signature`**: the one work a stranger should see first. Give it a `caseStudy` (and a `slug`), written from the parts it has: the challenge, the context, the user's role, the constraints, the decisions with their rationale, the evidence, the outcomes, the reflection.
- **`featured`**: two to four flagships, in order. Not the signature.
- **`archive`**: older work still worth finding. Not a featured one.
- **`proof`**: the two to four facts a composition shows up front: a metric with its key, a testimonial with its source, an award.

A work that's still a draft gets `visibility: private`: it stays in the document and never reaches a visitor.

## Career-stage matrix

| Stage           | Lead with                                                          | Often skip                                                  |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Early (0–3 yrs) | hero, lede, works, practice skills, a study in chronology, contact | metric evidence (often premature), awards, press            |
| Mid (3–8 yrs)   | + chronology of roles, a tenure metric, github                     | patents (rare)                                              |
| Senior (8+ yrs) | + metric and testimonial evidence, publications or talks, focus    | studies (drop unless prestigious or recent)                 |
| Staff/principal | + press, testimonials, patents, a signature case study             | services (unless freelance)                                 |
| Career-changer  | hero, lede, works in the new domain, practice skills               | the tenure metric (resets the clock), the old roles' detail |

Stage is a starting point, not a verdict. A 4-year engineer with three production-shipped open-source projects should lead with works; a 12-year engineer at a single company without external visibility may be better served by a chronology and a tenure metric, with no talks or press.

## Intent matrix

| Intent                     | Lean into                                                          | Drop                                                   |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Job hunt                   | works, chronology, practice skills, contact, cta                   | press, testimonials (read as bragging in this context) |
| Personal brand             | hero, lede, writing works, talk evidence, github, external work    | practice services                                      |
| Freelance / consulting     | practice services, testimonial and client evidence, press, cta     | practice skills (the services say it)                  |
| Academic                   | publication, talk, award, and patent evidence, studies             | software works (unless they're research code)          |
| Open-source / maker        | github, works, focus, fun-facts                                    | practice services, testimonials                        |
| Photographer / artist      | `image-series` and `photography` works, exhibitions, external work | practice skills and tools                              |
| Sabbatical / between roles | hero, lede, now, focus, writing works                              | the old roles' detail                                  |

If the user has more than one intent, pick the dominant one for ordering and let the others surface later in the page. Don't try to serve all intents in the first three sections.

## Audience matrix

| Audience              | Show them                                            | Hide                                                   |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Recruiters            | chronology, practice skills, studies, links          | now, fun-facts                                         |
| Hiring managers       | a signature case study, works, chronology highlights | a tenure metric (they read between lines), old studies |
| Peers / collaborators | github, writing works, talks, focus                  | practice services                                      |
| Clients               | practice services, testimonials, press, contact      | github (often)                                         |
| General public        | hero, lede, works with covers, links                 | publications, patents                                  |
| Conference organizers | talk evidence, writing works, the lede               | role detail, skills                                    |

If you don't know the audience, optimize for the smallest plausible one (usually hiring managers or peers) and let the second-tier audience forgive what they don't need. A portfolio that tries to land for everyone lands for no one.

## Ordering rules

1. `hero` is always first. Always.
2. The work comes early: the `works` section that lists the signature and the featured works sits right after the hero, or after a short `lede`.
3. **Proof close behind.** An `evidence` section of metrics or testimonials, the proof strip, sets context for everything below it.
4. Context after the work. Pick one of two leads based on intent:
   - **Showcase-first** (the default for makers, indies, personal-brand intent): works → evidence → practice → chronology → publications and talks. Lead with the user's strongest work; the path is supporting context. This is the order in `portfolio.example.yml`.
   - **Resume-first** (an active job hunt for a recruiter audience): chronology → works → practice skills → publications and talks. Recruiters skim roles first; the works support them.
     In both leads, drop any section that isn't relevant. Don't pad.
5. Voice goes LATE: testimonial evidence, press, and a `quote` sit between the work and contact. They're proof points, not opening arguments.
6. Links to elsewhere, external work and `github`, go just before `contact`.
7. `contact` and `cta` are always last. If both are present, `cta` precedes `contact`.

## Pruning rules

- If a section would list fewer than two records, consider folding the record into another section or into prose. An `evidence` section with one talk reads as a stretch; that talk belongs in the lede or as a work's cited evidence.
- If two sections cover similar ground, such as talks and podcast episodes, pick the stronger one. Readers compute the union.
- If a section duplicates the hero or lede, drop it. The hero says you're a Staff Engineer; you don't need a metric that says "11 years."
- A record can sit in more than one section. Use that for a work that belongs to two stories, not to repeat the page.
- The first three sections appear in the OG image preview. Treat them like the front cover: every choice there gets disproportionate weight.
- `now` is high-leverage when maintained, high-cost when stale. If the user won't update it monthly, skip it.
- Hide, don't delete. A section the user wants off the page for now gets `sections.<id>.hidden: true` in `site.yml`, and every record only it lists goes with it.
