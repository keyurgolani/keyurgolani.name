# Authoring your portfolio

A practical guide to writing a portfolio that reads well and renders cleanly. [configuration.md](configuration.md) is the reference for every field and rule.

For an AI-assisted authoring flow, point an agent at [skills/portfolio-author/SKILL.md](../skills/portfolio-author/SKILL.md).

## The two documents

`config/portfolio.yml` holds the content:

```yaml
schemaVersion: 2
locale: en
direction: ltr

identity:
  name: Anamika Devi
  tagline: Distributed systems engineer.
  pronouns: she/her
  location: Bangalore, India
  email: anamika@example.com
  avatar: { src: '/me.jpg', alt: 'Author headshot' }

links:
  - { url: 'https://github.com/anamika', platform: github }
  - { url: 'https://linkedin.com/in/anamika', platform: linkedin }
  - { url: '/resume.pdf', platform: resume }

sections:
  - kind: hero
    id: top
    tagline: Building systems that matter at scale.
  - kind: lede
    id: about
    title: About
    body: |
      Multi-line prose about who you are and what you do. Markdown is honored.
  # more sections
```

`config/site.yml` holds how it looks and which sections show:

```yaml
schemaVersion: 2
appearance:
  variant: editorial-evidence # the installed variant that lays out the page
  designLanguage: platform-neutral
  colorScheme: warm # a color scheme id, for #19
  typography: classic # a typography id, for #19
  displayMode: system # system | light | dark | high-contrast
visitorControls:
  variant: locked
  designLanguage: locked
  colorScheme: selectable
  typography: locked
  displayMode: selectable
motionPolicy: respect-os # respect-os | reduce
features:
  feed: true
# Hide a section without deleting it, by its id in portfolio.yml:
# sections:
#   about:
#     hidden: true
```

Every section needs an `id`: lowercase words joined by hyphens, unique in the portfolio. It's the section's anchor, so keep it stable once links point at it. Every field and kind is defined in `packages/schema/src/`, the source of truth. The quick reference is [`skills/portfolio-author/references/schema.md`](../skills/portfolio-author/references/schema.md).

## Picking sections

The schema has 28 core section kinds. Strong portfolios use 6 to 10. More than that and the page becomes a list of lists.

### By career stage

| Stage                | Lead with                                         | Often skip                          |
| -------------------- | ------------------------------------------------- | ----------------------------------- |
| Early (0 to 3 years) | hero, lede, projects, skills, education, contact  | tenure, stats, awards, press        |
| Mid (3 to 8 years)   | + experience, tenure, github, external-portfolios | discography, patents                |
| Senior (8+ years)    | + stats, awards, talks/publications, focus        | education (drop unless prestigious) |
| Career-changer       | hero, lede, projects (new domain), skills         | tenure, experience tail             |

### By intent

| Intent                | Lean into                                               | Drop                            |
| --------------------- | ------------------------------------------------------- | ------------------------------- |
| Job hunt              | experience, projects, skills, contact, cta              | press, testimonials             |
| Personal brand        | hero, lede, writings/talks, github, external-portfolios | services                        |
| Freelance             | services, testimonials, press, cta                      | skills                          |
| Academic              | publications, talks, awards, patents, education         | projects (unless research code) |
| Open-source / maker   | github, projects, focus, fun-facts                      | services, testimonials          |
| Photographer / artist | gallery, external-portfolios                            | skills, stack                   |

The full matrix lives at [`skills/portfolio-author/references/curation.md`](../skills/portfolio-author/references/curation.md). A practice the core kinds don't cover can add its own through a content extension: see [configuration.md](configuration.md#extensions).

## Section ordering

The order of `sections` is the page order. Rules of thumb, roughly in order of importance:

1. **`hero` first.** Always.
2. **`lede` second.** Or merge it into the hero if it fits in one paragraph.
3. **Signal-dense before list-dense.** `tenure`, `stats`, and `focus` give visitors context before they scroll into `experience` and `projects`.
4. **Body of work: pick a lead.**
   - **Showcase-first** (default): `projects`, `skills`, `experience`, `education`, `publications`, `writings`, `talks`, `awards`. Lead with the strongest work; experience is supporting context.
   - **Resume-first** (recruiter audience): `experience`, `education`, `projects`, `skills`, and so on. Recruiters skim experience first.
5. **Voice sections (`testimonials`, `press`, `quote`) go late.** They're proof points, not opening arguments.
6. **`external-portfolios` and `github` cluster near `contact`.** They're where else to find you.
7. **`contact` and `cta` are always last.**

The first sections are what a visitor sees before scrolling, so treat them like the front cover. To take a section off the page without deleting it, hide it in `site.yml`.

## Section kind quick reference

| Kind                  | Purpose                                                    | Use when                                    |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `hero`                | Identity and tagline at the top of the page                | Always                                      |
| `lede`                | One paragraph on what you do and why a visitor should care | Almost always                               |
| `now`                 | Current focus: what you're working on this week            | High-leverage when fresh, costly when stale |
| `experience`          | Chronological work history with role highlights            | When jobs matter as proof                   |
| `education`           | Schools, degrees, dates                                    | When recent or prestigious                  |
| `projects`            | Curated body of work, often the resume itself for makers   | When projects are stronger than employers   |
| `writings`            | Blog posts, essays                                         | When you write publicly                     |
| `publications`        | Academic or formal publications                            | Academia, research                          |
| `talks`               | Conference talks, panels, interviews                       | When you speak publicly                     |
| `awards`              | Recognitions                                               | Sparingly                                   |
| `episodes`            | Episodes of a podcast or video series                      | When you host a show                        |
| `patents`             | Filed or granted patents                                   | Industrial, hardware                        |
| `gallery`             | Image grid                                                 | Photographers, artists                      |
| `discography`         | Tracks and releases                                        | Musicians                                   |
| `testimonials`        | Quoted endorsements                                        | Freelancers, consultants                    |
| `press`               | Articles written about you                                 | Public-facing work                          |
| `quote`               | A single quote about your work                             | Like testimonials, but tighter              |
| `skills`              | Grouped skills lists                                       | Engineers (with restraint)                  |
| `stack`               | Curated tools you use                                      | Makers, indies                              |
| `services`            | What you offer for hire                                    | Freelancers                                 |
| `contact`             | Email and links                                            | Always                                      |
| `cta`                 | Call-to-action banner before contact                       | Job hunt, open to work                      |
| `stats`               | Headline figures                                           | When numbers tell a story                   |
| `focus`               | What you're putting energy into now                        | Senior IC, leadership                       |
| `fun-facts`           | Off-the-page personal notes                                | Personal brand                              |
| `tenure`              | A years-in headline                                        | Senior, with a strong narrative             |
| `external-portfolios` | Links to other sites where your work lives                 | Cross-discipline                            |
| `github`              | A GitHub profile link; repository data comes with #10      | Engineers                                   |

Every kind's fields, one by one: [`skills/portfolio-author/references/schema.md`](../skills/portfolio-author/references/schema.md). [`section-kinds.md`](../skills/portfolio-author/references/section-kinds.md) says when to use each.

## Quality rules

Concrete length numbers and tone guidance for visitor-facing copy live at [`skills/portfolio-author/references/quality-rules.md`](../skills/portfolio-author/references/quality-rules.md). The short version:

- **Hero `tagline`:** 4 to 10 words. One claim, no commas used as conjunctions.
- **`subtagline`:** 1 sentence, at most 120 characters. It adds context to the tagline.
- **`lede.body`:** 60 to 180 words. One paragraph. Concrete detail, no buzzwords.
- **`experience.items[].highlights[]`:** at most 25 words each. Lead with the verb.
- **`projects.items[].description`:** 1 or 2 sentences. What it does, not how.
- **No emojis** anywhere. Use plain prose.
- **No "passionate about" anything.** It reads as filler.

## Markdown

Long text, such as a lede's `body` or an item's `description`, takes Markdown. The page renders paragraphs, links, emphasis, inline code and code blocks, bullet and numbered lists, block quotes, headings, line breaks, and horizontal rules, with these limits:

- Raw HTML shows as the text you typed, and HTML comments are dropped.
- An image shows its alt text. Pictures go in the fields that take an image, such as a gallery item's.
- A heading of level 1 or 2 renders at level 3, since the page owns the top two levels.
- A link takes the same URLs as a `url` field (see [configuration.md](configuration.md#files-and-formats)), and a link to anything else shows its text alone. Write a space in a URL as `%20`. With a raw space, `[docs](https://example.com/a b)` isn't a link. It shows as you typed it, and only the bare URL before the space links.
- A table becomes a paragraph per row, and a numbered list starts at 1. Strikethrough shows as plain text, and task-list boxes and link titles are dropped.

## Validation

```sh
node skills/portfolio-author/scripts/validate.mjs config
```

It checks `config/portfolio.yml` and `config/site.yml` together. Exit 0 means valid, warnings aside. Exit 1 means a problem blocks the pair, and each one is printed with its file, line, column, JSON pointer, code, and how to fix it. `pnpm config:validate` prints the same records, and [configuration.md](configuration.md#validation) explains each code.

`portfolio.example.yml` and `site.example.yml` are the canonical references. If a document diverges from their shape and the schema rejects it, look at the examples for the right shape.

## When you're stuck

If you're not sure which sections fit your situation, hand the [`skills/portfolio-author/`](../skills/portfolio-author/) skill to an AI agent (Claude Code, Copilot CLI, Cursor) along with your raw materials (resume, LinkedIn export, GitHub username). The skill interviews you and produces a valid pair.
