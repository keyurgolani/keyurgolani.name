# Visual companion guide

> Browser-based companion for showing palette boards, type pairings, and
> section sketches during DESIGN.md (mockup-mode), then live screenshots
> during implementation (preview-mode). Loaded on demand by the agent
> after the user opts in.

## When to use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

**Use the browser** when the content itself is visual:

- Palette comparisons (paper / ink / accent on real type sample)
- Type pairings (display + body candidates rendered with real webfonts)
- Section sketches (wireframe layouts under the chosen metaphor)
- Density grids (minimal / balanced / dense visual options)
- Live preview screenshots in preview-mode

**Use the terminal** when the content is text or conceptual:

- Metaphor selection (the answer is words)
- A/B/C tradeoff questions
- Manifest field decisions (typography character, motion intensity, etc. — these are enums)
- Coverage map decisions (which kinds get bespoke vs. fallback — list-based)

A question *about* a UI topic is not automatically a visual question. "Which performance tier should I pick?" is a conceptual question — terminal. "Which of these three palette boards feels closest to the metaphor?" is a visual question — browser.

## The disclaimer pattern

The companion is OFF by default. Don't launch it without explicit user consent.

### Offer wording

Send this as **its own message**, with no clarifying questions, no context summary, no other content alongside:

> Some of this work might be easier to discuss visually. I can spin up a local browser companion — palette boards and section sketches now (mockup-mode), live screenshots later (preview-mode). The companion is token-intensive, so I won't launch it without your OK. Want to use it?

Wait for the user's response. If they decline, proceed entirely in the terminal — the skill works fully without the companion.

## Mockup-mode

### Starting a session

```bash
docs/skills/variant-developer/scripts/visual-companion/start.sh \
  --mode mockup --project-dir /home/user/code/keyurgolani.name --foreground --port 0
```

The server prints JSON `{type: "server-started", port: NNNNN, url: "http://localhost:NNNNN", screen_dir: "...", state_dir: "..."}` to stdout on startup. Capture `url`, `screen_dir`, `state_dir` from that JSON.

Tell the user to open the URL.

### The loop

1. **Write a content file** to `screen_dir`. Use a semantic filename like `palette.html`, `type-pairing.html`, `section-sketch-hero.html`. **Never reuse filenames** — each new screen gets a fresh file. The server serves the newest file by mtime.
2. **End your turn** with a brief description of what's now on screen, plus a reminder of the URL.
3. **On your next turn**, read `state_dir/events`. Each line is a JSON click event. The user's terminal text is primary; the events log adds structured detail.

### Content fragments vs full documents

If your file starts with `<!DOCTYPE` or `<html`, the server serves it as-is and injects the helper script. Otherwise it wraps your content in the frame template — header, CSS, and helper auto-included.

**Default to fragments.** Only write full documents when you need complete control over the page (rare).

### CSS classes available in fragments

The classes below are defined in `assets/visual-companion/frame-template.html`. Use them in your fragments.

#### Palette board

```html
<h2>Pick a default color scheme for the metaphor</h2>
<p class="label">Click one. The others are still good options for additional schemes.</p>
<div class="palette-board">
  <div class="palette-card" data-choice="warm" onclick="toggleSelect(this)">
    <div class="palette-swatch">
      <div style="background:#fbfaf6; color:#1a1a1a">paper</div>
      <div style="background:#1a1a1a; color:#fbfaf6">ink</div>
      <div style="background:#b54a32; color:#fff">accent</div>
    </div>
    <div class="palette-name">Warm Sienna</div>
    <div class="palette-meta">Cream paper · deep ink · sienna accent</div>
    <div class="palette-sample-heading" style="font-family:Fraunces,serif;color:#1a1a1a">Editorial display</div>
    <div class="palette-sample-body" style="font-family:'Source Serif 4',serif;color:#1a1a1a">Body sample over paper. Notice contrast.</div>
  </div>
  <!-- 1-3 more palette-card elements -->
</div>
```

Classes: `.palette-board` (container), `.palette-card` (each option), `.palette-swatch` (3-up color preview), `.palette-meta`, `.palette-name`, `.palette-sample-heading`, `.palette-sample-body`.

#### Type pairing

```html
<h2>Display + body pairings for this scheme</h2>
<div class="type-pairing">
  <div class="type-card" data-choice="classic" onclick="toggleSelect(this)">
    <div class="type-display" style="font-family:Fraunces,serif">Editorial Classic</div>
    <div class="type-body" style="font-family:'Source Serif 4',serif">Source Serif 4 reads beautifully at 17px with a 1.55 leading. The Fraunces display has high-contrast curves that pair well with the upright serif body.</div>
    <div class="type-meta">display: Fraunces · body: Source Serif 4</div>
  </div>
  <!-- more type-card elements -->
</div>
```

Classes: `.type-pairing` (container), `.type-card` (each option), `.type-display`, `.type-body`, `.type-meta`.

#### Section sketch

```html
<h2>How does the projects section lay out?</h2>
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
docs/skills/variant-developer/scripts/visual-companion/start.sh \
  --mode preview --variant <slug>
```

This runs `pnpm --filter @portfolio/web dev`. Once the dev server is up, tell the user to visit `http://localhost:3000/preview/<slug>`.

### Matrix screenshots (optional)

```bash
docs/skills/variant-developer/scripts/visual-companion/start.sh \
  --mode preview --variant <slug> --matrix
```

This launches the dev server and, after it responds, runs `preview-matrix.mjs` to capture screenshots across `(theme × scheme × typography)` into `<repo-root>/.variant-preview/<slug>/`.

**Requires Playwright.** If Playwright isn't installed, the script prints the install commands and exits gracefully — the rest of preview-mode still works.

To enable Playwright:

```bash
pnpm add -Dw playwright
pnpm exec playwright install chromium
```

The agent reads the captured PNGs (if its harness supports image input) to inspect rendering. Otherwise, ask the user to look at the screenshots and report back.

## Events file format

`state_dir/events` is JSONL — one JSON object per line. Each line is a click event:

```json
{"type":"click","choice":"warm","text":"Warm Sienna","timestamp":1714752000123}
```

The full stream shows the user's exploration path. They may click multiple options before settling. The last `choice` is typically the final answer, but the pattern of clicks can reveal hesitation worth probing.

If `state_dir/events` doesn't exist or is empty, the user didn't interact with the browser — use only their terminal text.

The server clears `state_dir/events` whenever a new fragment file appears in `screen_dir`. So events are scoped to the currently-displayed screen.

## File naming

- Use semantic names that describe what's on the screen: `palette.html`, `type-pairing.html`, `section-sketch-hero.html`, `density.html`.
- For iterations on the same screen, use version suffixes: `palette-v2.html`, `palette-v3.html`.
- The server serves the newest file by modification time, so just writing a new file with a later timestamp is enough.

## Cleaning up

When the work is done, stop the server:

```bash
docs/skills/variant-developer/scripts/visual-companion/stop.sh <state_dir>
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
- Matrix screenshots: `scripts/visual-companion/preview-matrix.mjs`
