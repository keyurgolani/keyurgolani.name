# Curation principles — picking and ordering sections

> The opinionated bit. Loaded when deciding which optional sections to
> include, in what order, with what depth.

## Step 0 — Read what the user already has

Before picking sections, anchor on what data the user has shared. Don't
include a section just because the schema offers it; only include a
section if the user can fill it well. A `talks` section with one talk is
worse than no `talks` section. A `testimonials` section with a single
generic quote is worse than no `testimonials` at all.

When in doubt: ask, don't pad. The schema offers ~30 kinds; a strong
portfolio uses 6–10 of them.

## Career-stage matrix

| Stage | Signature sections | Often-skip |
|-------|--------------------|------------|
| Early (0–3 yrs) | hero, lede, projects, skills, education, contact | tenure, stats (often premature), awards, press |
| Mid (3–8 yrs) | + experience, tenure, github, external-portfolios | discography (only if musician), patents (rare) |
| Senior (8+ yrs) | + stats, awards, talks/publications, focus | education (drop unless prestigious or recent) |
| Staff/principal | + press, testimonials, patents | services (unless freelance) |
| Career-changer | hero, lede, projects (new domain), skills | tenure (resets the clock), experience (often de-emphasized) |

Stage is a starting point, not a verdict. A 4-year engineer with three
production-shipped open-source projects should use `projects` heavily; a
12-year engineer at a single company without external visibility may be
better served by `experience` + `tenure` and skipping `talks`/`press`.

## Intent matrix

| Intent | Lean into | Drop |
|--------|-----------|------|
| Job hunt | experience, projects, skills, contact, cta | press, testimonials (read as bragging in this context) |
| Personal brand | hero, lede, writings/talks, github, external-portfolios | services |
| Freelance / consulting | services, testimonials, press, cta | skills (replaced by services list) |
| Academic | publications, talks, awards, patents, education | projects (unless they're research code) |
| Open-source / maker | github, projects, focus, fun-facts | services, testimonials |
| Photographer / artist | gallery, external-portfolios | skills, stack |
| Sabbatical / between roles | hero, lede, now, focus, writings | experience tail (don't rehash a job you've moved past) |

If the user has more than one intent, pick the dominant one for ordering
and let the others surface later in the page. Don't try to serve all
intents in the first three sections.

## Audience matrix

| Audience | Show them | Hide |
|----------|-----------|------|
| Recruiters | experience, skills, education, links | now, fun-facts |
| Hiring managers | experience.items[].highlights, projects, github | tenure (they read between lines), education (unless recent) |
| Peers / collaborators | github, writings, talks, focus | services |
| Clients | services, testimonials, press, contact | github (often) |
| General public | hero, lede, gallery / projects, links | publications, patents |
| Conference organizers | talks, writings, bio (lede) | experience details, skills |

If you don't know the audience, optimize for the smallest plausible one
(usually hiring managers or peers) and let the second-tier audience
forgive what they don't need. A portfolio that tries to land for
everyone lands for no one.

## Ordering rules

1. `hero` is always first. Always.
2. `lede` is second when present (or merge into hero if very short).
3. **Signal-dense** sections (`tenure`, `stats`, `focus`) before **list-dense** sections (`experience`, `projects`, `publications`). Signal-dense sections set context for the lists that follow.
4. Body of work — pick one of two leads based on intent:
   - **Showcase-first** (default for makers, indies, personal-brand intent): `projects` → `skills` → `experience` → `education` → `publications` → `writings` → `talks` → `awards`. Lead with the user's strongest work; experience is supporting context. This is the canonical order in `portfolio.example.yml`.
   - **Resume-first** (for active job-hunt against recruiter audience): `experience` → `education` → `projects` → `skills` → `publications` → `writings` → `talks` → `awards`. Recruiters skim experience first; projects support.
   In both leads, drop any sections that aren't relevant. Don't pad.
5. Voice sections (`testimonials`, `press`, `quote`) go LATE — between body of work and contact. They're proof points, not opening arguments.
6. `external-portfolios` and `github` go just before `contact`. They're "where else to find me" sections, so they cluster with contact.
7. `contact` and/or `cta` are always last. If both are present, `cta` precedes `contact`.

## Pruning rules

- If a section would have <2 items, consider folding into prose elsewhere or skipping. A `talks` section with one talk reads as a stretch; that talk belongs in the lede or experience.
- If two sections cover similar ground (e.g. `talks` and `episodes`), pick the stronger one. Don't list every podcast appearance in both — readers compute the union.
- If a section duplicates information already in the hero or lede, drop the section. The hero says you're a Staff Engineer at Amazon; you don't need a `tenure` section that says "11 years."
- The first three sections appear in the OG image preview. Treat them like the front cover — every choice there gets disproportionate weight.
- `now` is high-leverage when maintained, high-cost when stale. If the user won't update it monthly, skip it.
