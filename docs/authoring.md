# Authoring your portfolio

A practical guide to writing a portfolio that reads well and renders cleanly. [configuration.md](configuration.md) is the reference for every field and rule.

For an AI-assisted authoring flow, point an agent at [skills/portfolio-author/SKILL.md](../skills/portfolio-author/SKILL.md).

## The two documents

`config/portfolio.yml` holds the content: a body of work. Records, each with an id, hold what you made and what backs it up, and sections place them in the order a visitor reads them:

```yaml
schemaVersion: 3
locale: en
direction: ltr

identity:
  name: Anamika Devi
  tagline: Engineer, writer, speaker
  email: anamika@example.com
  avatar: { asset: portrait }

signature: postmortem-template-kit # the one work you lead with
proof: [tenure-years] # the facts a visitor sees first

works:
  - id: postmortem-template-kit
    slug: postmortem-template-kit # a case study gets /work/<slug>
    title: Postmortem Template Kit
    medium: software
    summary: An opinionated, batteries-included template kit for writing better incident postmortems.
    caseStudy:
      role: I wrote the templates and the CLI, and ran the first forty reviews with them.

evidence:
  - id: tenure-years
    type: metric
    statement: Years engineering, from research code to production systems handling ten billion requests a day.
    metric: { key: tenure-years, value: 12, unit: years }

media:
  - id: portrait
    kind: image
    source: anamika/portrait.png # a path under the media root, or an https URL
    alt: An abstract portrait, a dark head-and-shoulders silhouette on a warm amber gradient.

contact:
  message: Best route is email, with a note about what you're working on.

sections:
  - kind: hero
    id: top
    tagline: I build calm software at scale.
  - kind: works
    id: work-showcase
    title: Work Showcase
    items: [postmortem-template-kit]
  - kind: contact
    id: contact
    title: Contact
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
#   work:
#     hidden: true
```

Every section, record, and media asset needs an `id`: lowercase words joined by hyphens, unique in the whole document. It's the anchor, the feed entry's GUID, and the JSON-LD `@id`, so keep it stable once links point at it. `pnpm config:ids-fix` gives every entry that lacks one an id from its title, keeping your comments; it prints them first and writes with `--write`.

Leave out what you haven't written. An empty string or an empty list is an error, not a blank: a field that's left out isn't authored, and nothing renders in its place.

Every field and kind is defined in `packages/schema/src/`, the source of truth. The quick reference is [`skills/portfolio-author/references/schema.md`](../skills/portfolio-author/references/schema.md), and `portfolio.example.yml` is a whole portfolio written this way.

## Telling the story

Start from the work, not the CV.

1. **Pick a signature.** One work you'd want a stranger to see first. Give it a `caseStudy`, and the composition gives it its own page.
2. **Feature a few more.** `featured` names the flagships, in order. Two to four is plenty. Older work you still want findable goes in `archive`.
3. **Back it up.** Evidence is what someone else could check: a metric with a key, a testimonial with its source, a publication, a talk, an award. `proof` names the facts a composition shows up front, and a work's `evidence` names the ones it cites.
4. **Add the chronology last.** Roles and studies give context. A `chronology` section without `items` lists every public entry, newest first.
5. **Say what you do.** `practice.thesis` is one sentence on the practice; its skills, tools, and services groups are what a `practice` section shows.

A work's `medium` says what it is: `interface`, `system`, `software`, `photography`, `image-series`, `writing`, `research`, `music`, `audio-video`, or `object`. An evidence entry's `type` says what kind of fact it is. Nothing assumes a profession: a photographer's image series, a musician's records, and an academic's publications are works and evidence like any engineer's.

A record with `visibility: private` stays in the document and never reaches a visitor. So does every record only a hidden section lists. Draft freely: nothing hidden or private renders, ships in the page's payload, or appears in the feed.

## Picking sections

There are 14 section kinds. Strong portfolios use 6 to 10 sections. More than that and the page becomes a list of lists.

| Kind         | Places                                               | Use when                                    |
| ------------ | ---------------------------------------------------- | ------------------------------------------- |
| `hero`       | Identity and tagline at the top of the page          | Always                                      |
| `lede`       | One paragraph on what you do and why it matters      | Almost always                               |
| `works`      | Works you choose, in order                           | Always: it's the body of work               |
| `evidence`   | Facts that back the work up                          | When you have checkable proof               |
| `chronology` | Roles, studies, and milestones                       | When the path matters as proof              |
| `practice`   | The thesis, or a group of skills, tools, or services | One part per section                        |
| `now`        | What you're working on this week                     | High-leverage when fresh, costly when stale |
| `focus`      | What you're putting energy into                      | Senior work, leadership                     |
| `quote`      | One line about the work                              | When it lands hard                          |
| `fun-facts`  | Off-the-page personal notes                          | Personal brand                              |
| `github`     | A GitHub profile, from its snapshot                  | Public open-source work                     |
| `custom`     | Content no other kind holds                          | Sparingly                                   |
| `cta`        | One call to action                                   | Job hunt, open to work                      |
| `contact`    | The contact record, email, and links                 | Always                                      |

The full matrix of what to include by career stage, intent, and audience lives at [`skills/portfolio-author/references/curation.md`](../skills/portfolio-author/references/curation.md). A practice the core kinds don't cover can add its own through a content extension: see [configuration.md](configuration.md#extensions).

## Section ordering

The order of `sections` is the page order. Rules of thumb, roughly in order of importance:

1. **`hero` first.** Always.
2. **The work early.** The section that lists your signature and featured works comes right after the hero, or after a short `lede`.
3. **Proof close behind.** An `evidence` section of metrics or testimonials gives visitors a reason to keep reading.
4. **Context after the work.** `chronology`, `practice`, and `now` explain the work; they don't lead.
5. **Voice late.** Testimonials, press, and a `quote` are proof points, not opening arguments.
6. **`github` and links to elsewhere near the end.**
7. **`cta` and `contact` last.**

The first sections are what a visitor sees before scrolling, so treat them like the front cover. To take a section off the page without deleting it, hide it in `site.yml`.

## Media and alt text

An image is a media asset in `media`, with its alt text and credit, and every place that shows it is a placement: `{ asset: <id> }`, with a `caption`, or an `alt` that differs for this use. Write alt text that says what the image shows, on the asset. Mark decoration with `decorative: true`. A caption isn't alt text, and an image visitors see with neither is a warning.

The `source` is a path under the media root, such as `anamika/portrait.png`, or an https URL. This release doesn't derive renditions yet, so every image renders as unavailable, keeping its box, caption, and credit, until media ingestion arrives.

## Quality rules

Concrete length numbers and tone guidance for visitor-facing copy live at [`skills/portfolio-author/references/quality-rules.md`](../skills/portfolio-author/references/quality-rules.md). The short version:

- **Hero `tagline`:** 4 to 10 words. One claim, no commas used as conjunctions.
- **`subtagline`:** 1 sentence, at most 120 characters. It adds context to the tagline.
- **`lede.body`:** 60 to 180 words. One paragraph. Concrete detail, no buzzwords.
- **A work's `summary`:** 1 or 2 sentences. What it does, not how.
- **A chronology entry's `highlights`:** at most 25 words each. Lead with the verb.
- **Metrics:** a number goes in `metric.value`, with a `key` that names what it counts, so the same figure stated twice is checked. Anything that isn't a number belongs in the `statement`.
- **No emojis** anywhere. Use plain prose.
- **No "passionate about" anything.** It reads as filler.

## Markdown

Long text, such as a lede's `body` or an item's `description`, takes Markdown. The page renders paragraphs, links, emphasis, inline code and code blocks, bullet and numbered lists, block quotes, headings, line breaks, and horizontal rules, with these limits:

- Raw HTML shows as the text you typed, and HTML comments are dropped.
- An image shows its alt text. Pictures go in the fields that take an image, such as a gallery item's.
- A heading of level 1 or 2 renders at level 3, since the page owns the top two levels.
- A link takes the same URLs as a `url` field (see [configuration.md](configuration.md#files-and-formats)), and a link to anything else shows its text alone. Write a space in a URL as `%20`. With a raw space, `[docs](https://example.com/a b)` isn't a link. It shows as you typed it, and only the bare URL before the space links.
- A table becomes a paragraph per row, and a numbered list starts at 1. Strikethrough shows as plain text, and task-list boxes and link titles are dropped.
- A character reference such as `&copy;` or `&#169;` shows its character, except a name longer than 20 characters, such as `&CounterClockwiseContourIntegral;`, which shows as you typed it.

## Validation

```sh
node skills/portfolio-author/scripts/validate.mjs config
```

It checks `config/portfolio.yml` and `config/site.yml` together. Exit 0 means valid, warnings aside. Exit 1 means a problem blocks the pair, and each one is printed with its file, line, column, JSON pointer, code, and how to fix it. `pnpm config:validate` prints the same records, along with any for the snapshots and media document beside the pair, and [configuration.md](configuration.md#validation) explains each code.

`portfolio.example.yml` and `site.example.yml` are the canonical references. If a document diverges from their shape and the schema rejects it, look at the examples for the right shape.

A portfolio from an earlier release, a version 2 one or the old one-file format, is converted by `pnpm config:migrate`: [configuration.md](configuration.md#migrating-a-version-2-portfolio) walks through it.

## When you're stuck

If you're not sure which sections fit your situation, hand the [`skills/portfolio-author/`](../skills/portfolio-author/) skill to an AI agent (Claude Code, Copilot CLI, Cursor) along with your raw materials (resume, LinkedIn export, GitHub username). The skill interviews you and produces a valid pair.
