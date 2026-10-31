# Visual companion guide

> Browser-based companion for showing layout boards and section sketches
> during DESIGN.md (mockup-mode), then live renders during implementation
> (preview-mode). Loaded on demand by the agent after the user opts in.

## When to use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

**Use the browser** when the content itself is visual:

- Section sketches (wireframe layouts under the chosen idea)
- Density grids (how much fits on a screen)
- Navigation and reveal options (a table of contents, a sidebar, an overlay)
- Live preview renders in preview-mode

**Use the terminal** when the content is text or conceptual:

- Choosing the composition idea (the answer is words)
- A/B/C tradeoff questions
- Manifest field decisions (composition family, motion intent: they're enums)
- Coverage map decisions (which kinds render bespoke and which shared: a list)

A question _about_ a UI topic isn't automatically a visual question. "Which performance tier should I pick?" is conceptual: terminal. "Which of these three layouts fits the idea?" is visual: browser.

Palettes and type pairings aren't a variant's to choose: they're the appearance system's (#19). The frame template still defines `.palette-board` and `.type-pairing` classes for that work; this skill doesn't use them.

## The disclaimer pattern

The companion is OFF by default. Don't launch it without explicit user consent.

### Offer wording

Send this as **its own message**, with no clarifying questions, no context summary, no other content alongside:

> Some of this work might be easier to discuss visually. I can spin up a local browser companion: layout boards and section sketches now (mockup-mode), live renders later (preview-mode). The companion is token-intensive, so I won't launch it without your OK. Want to use it?

Wait for the user's response. If they decline, proceed entirely in the terminal — the skill works fully without the companion.

## Mockup-mode

### Starting a session

```bash
skills/variant-developer/scripts/visual-companion/start.sh \
  --mode mockup --project-dir /home/user/code/keyurgolani.name --foreground --port 0
```

The server prints JSON `{type: "server-started", port: NNNNN, url: "http://localhost:NNNNN", screen_dir: "...", state_dir: "..."}` to stdout on startup. Capture `url`, `screen_dir`, `state_dir` from that JSON.

Tell the user to open the URL.

### The loop

1. **Write a content file** to `screen_dir`. Use a semantic filename like `layout.html`, `navigation.html`, `section-sketch-hero.html`. **Never reuse filenames**: each new screen gets a fresh file. The server serves the newest file by mtime.
2. **End your turn** with a brief description of what's now on screen, plus a reminder of the URL.
3. **On your next turn**, read `state_dir/events`. Each line is a JSON click event. The user's terminal text is primary; the events log adds structured detail.

### Content fragments vs full documents

If your file starts with `<!DOCTYPE` or `<html`, the server serves it as-is and injects the helper script. Otherwise it wraps your content in the frame template — header, CSS, and helper auto-included.

**Default to fragments.** Only write full documents when you need complete control over the page (rare).

### CSS classes available in fragments

The classes below are defined in `assets/visual-companion/frame-template.html`. Use them in your fragments.

#### Section sketch

```html
<h2>How does the works section lay out?</h2>
<div class="section-sketch" data-choice="single-column" onclick="toggleSelect(this)">
  <div class="sketch-title">Single column · prose-driven</div>
  <div class="sketch-row heading"></div>
  <div class="sketch-row long"></div>
  <div class="sketch-row long"></div>
  <div class="sketch-row medium"></div>
</div>
<div class="section-sketch" data-choice="two-column" onclick="toggleSelect(this)">
  <div class="sketch-title">Two column · grid</div>
  <div class="sketch-grid">
    <div>
      <div class="sketch-row heading"></div>
      <div class="sketch-row medium"></div>
    </div>
    <div>
      <div class="sketch-row heading"></div>
      <div class="sketch-row medium"></div>
    </div>
  </div>
</div>
```

Classes: `.section-sketch`, `.sketch-title`, `.sketch-row` (with modifiers `.short`, `.medium`, `.long`, `.heading`), `.sketch-grid`.

#### Density grid

```html
<h2>Default density</h2>
<div class="density-grid">
  <div class="density-option minimal" data-choice="minimal" onclick="toggleSelect(this)">
    <div class="density-name">minimal</div>
    <div class="density-preview"></div>
  </div>
  <div class="density-option balanced" data-choice="balanced" onclick="toggleSelect(this)">
    <div class="density-name">balanced</div>
    <div class="density-preview"></div>
  </div>
  <div class="density-option dense" data-choice="dense" onclick="toggleSelect(this)">
    <div class="density-name">dense</div>
    <div class="density-preview"></div>
  </div>
</div>
```

#### General-purpose options (A/B/C choices, split views)

```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Title</h3>
      <p>Description</p>
    </div>
  </div>
  <!-- more options -->
</div>

<div class="split">
  <div>Left content (HTML)</div>
  <div>Right content (HTML)</div>
</div>
```

For multi-select, add `data-multiselect` to the container — the server's helper.js detects it and lets the user select multiple.

## Preview-mode

Used in Phases 2–3, once the variant has actual code rendering through `apps/web`'s registry.

### Starting

```bash
skills/variant-developer/scripts/visual-companion/start.sh \
  --mode preview --variant <id>
```

This runs `pnpm --filter @portfolio/web dev` and polls `http://127.0.0.1:3000/preview/dev/<id>/complete` until it answers 200: the `complete` contract fixture in the variant, in the preview document and under the preview's headers. Tell the user to visit it once the script says it answers. `--fixture <name>` picks another of the contract fixtures, and `?displayMode=dark`, `?contrast=more`, `?motion=reduce`, or `?enhancement=off` sets the environment. The dev server runs under `PORTFOLIO_PROFILE=demo`, so `/sample?variant=<id>` shows the bundled sample in the variant too. An id the build doesn't register is a 404 at both; `pnpm check:variants --package @portfolio/variant-<id>` says why it isn't registered.

### Screenshots in every mode

The variant specs replace the old matrix script. They boot the production build on every contract fixture and on the bundled sample, and check the variant in six modes (desktop, mobile, no JavaScript, print, failed enhancement, reduced motion), with a screenshot of each fixture at desktop and mobile:

```bash
pnpm exec playwright install chromium   # once
pnpm build
PORTFOLIO_VARIANTS_ONLY=<id> pnpm test:variants
```

`start.sh --mode preview --variant <id> --matrix` runs the last line for you.

The screenshots are attached to the report in `reports/variants/html/`. The agent reads them (if its harness supports image input) to inspect rendering; otherwise, ask the user to open the report and look. They're compared against baselines only for the platform's own packages, in CI's pinned Playwright image. See [docs/variants.md](../../../docs/variants.md#testing-a-variant).

## Events file format

`state_dir/events` is JSONL — one JSON object per line. Each line is a click event:

```json
{ "type": "click", "choice": "two-column", "text": "Two column, grid", "timestamp": 1714752000123 }
```

The full stream shows the user's exploration path. They may click multiple options before settling. The last `choice` is typically the final answer, but the pattern of clicks can reveal hesitation worth probing.

If `state_dir/events` doesn't exist or is empty, the user didn't interact with the browser — use only their terminal text.

The server clears `state_dir/events` whenever a new fragment file appears in `screen_dir`. So events are scoped to the currently-displayed screen.

## File naming

- Use semantic names that describe what's on the screen: `layout.html`, `navigation.html`, `section-sketch-hero.html`, `density.html`.
- For iterations on the same screen, use version suffixes: `layout-v2.html`, `layout-v3.html`.
- The server serves the newest file by modification time, so just writing a new file with a later timestamp is enough.

## Cleaning up

When the work is done, stop the server:

```bash
skills/variant-developer/scripts/visual-companion/stop.sh <state_dir>
```

The server also auto-shuts down after 30 minutes of inactivity (configurable via `--inactivity-minutes` to start.sh).

Files in `screen_dir` persist (they live under `<project-dir>/.skills/variant-companion/<session-id>/`). They survive across stops and starts. If you don't want them in version control, add `.skills/` to `.gitignore`.

## Tips

- **Two to four options per screen** — more is overwhelming; one is a question, not a choice.
- **Real content matters for visual choices.** Use the actual user's data when it's available — a portfolio with their real heading text shows up better than Lorem Ipsum.
- **Iterate before advancing.** If the user's feedback changes the current screen, write a new version (v2). Only push a different question once the current one is resolved.
- **Cap fidelity to the question.** Wireframe-level sketches for "which layout?". Polish for "is this the final feel?". Don't over-render — the goal is decision speed.

## Reference

- Frame template (CSS class definitions): `assets/visual-companion/frame-template.html`
- Helper script (client-side click capture): `assets/visual-companion/helper.js`
- Server (HTTP + watcher): `scripts/visual-companion/server.cjs`
- Launcher: `scripts/visual-companion/start.sh`
- Shutdown: `scripts/visual-companion/stop.sh`
- Screenshots in every mode: `pnpm test:variants`, in `tests/variants/`
