# Quality gates — visual validation recipes

> The audit script catches schema breaks. The visual gates catch what
> compiles fine but looks broken. Load this at the start of Phase 3,
> before declaring a variant done.
>
> **Every recipe here exists because a variant shipped past typecheck +
> audit + HTTP-200 with the bug still present.** Following the recipes
> makes one-shot variant builds significantly more likely to land on the
> first try.

## Gate A — Visual sanity (do this first, before anything else)

Smoke test, ~30 seconds. Catches "the page renders as plain HTML".

```bash
pnpm dev   # or: docker compose up -d --build
```

Open `http://localhost:3000/preview/<slug>` (or `:3050` on Docker setups).

**You must see:**
- Background / paper color matching your scheme (not white-on-white default).
- Hero-section text using your declared font family (not system-ui).
- The theme toggle, nav, or any other variant chrome you wired.

**If you see plain black text on white background with no styling**, the variant's CSS isn't reaching the page. Check `apps/web/src/lib/registry.styles.generated.ts` was regenerated and includes your variant. Run `pnpm --filter @portfolio/web build:registry`.

## Gate B — Theme × scheme × typography matrix sweep

The contrast gate. Run before Phase 3 sign-off.

### Recipe

For each combination, capture a hero screenshot and skim the page top-to-bottom. The combinations:

| # | Theme | Scheme | Typography | What to verify |
|---|---|---|---|---|
| 1 | dark | default scheme | default typography | baseline |
| 2 | dark | scheme #2 | default | scheme switch is visibly distinct |
| 3 | dark | scheme #3 | default | scheme switch is visibly distinct |
| 4 | light | default | default | paper/ink swap; nothing reads as inverted |
| 5 | light | scheme #2 | default | scheme readable on light paper |
| 6 | light | scheme #3 | default | scheme readable on light paper |
| 7 | bright | default | default | crisp; no contrast loss vs light |
| 8 | black | default | default | AMOLED; no contrast loss vs dark |
| 9 | dark | default | typography #2 | type-feel difference visible |

Optionally extend with `bright + scheme #2` and `black + scheme #2` if any user might combine them. Skip if your manifest doesn't claim those themes.

### Switch theme programmatically (faster than clicking)

```js
// In Chrome devtools console:
localStorage.setItem('portfolio:theme', 'bright');
location.reload();
```

### Switch scheme/typography via URL

```
/preview/<slug>?scheme=<id>&typography=<id>
```

### What "looks correct" means

- **Body text** — readable, not muted-into-background.
- **CTA buttons** — text contrast ≥ 4.5:1 with background; icons visible.
- **Heading gradients** — both stops produce a readable color (no light-on-light or dark-on-dark midpoints).
- **Card borders** — visible against paper, not vanishing.
- **Nav active state** — the active item is unambiguously distinguishable from inactive.

### Programmatic contrast check

For any element that fails by eye, get computed contrast via DevTools:

```js
// Picks a button; reads its color and the resolved background of its parent.
const el = document.querySelector('.kc-action--primary');
const fg = getComputedStyle(el).color;
const bg = getComputedStyle(el.parentElement).backgroundColor;
// Plug into a contrast calculator (e.g. https://webaim.org/resources/contrastchecker/).
console.log({ fg, bg });
```

Aim for ≥ 4.5:1 body text, ≥ 3:1 large headings.

## Gate C — Reduced-motion programmatic verification

CSS `@media (prefers-reduced-motion)` blocks animation durations, but JS-driven motion (canvases, framer-motion `useTransform`) needs explicit gating. Verify each motion source:

### Force the preference

```
/* Chrome DevTools → Rendering panel → Emulate CSS media feature
   prefers-reduced-motion → reduce */
```

Or programmatically (works for `useMotionPreference` in the kit, since the hook reads `window.matchMedia`):

```js
// Inject before page load:
const original = window.matchMedia.bind(window);
window.matchMedia = (q) => {
  const r = original(q);
  if (q.includes('prefers-reduced-motion: reduce')) {
    Object.defineProperty(r, 'matches', { value: true, configurable: true });
  }
  return r;
};
```

### Validate canvas freezes

```js
// Sample a single canvas pixel 300ms apart. With reduce-motion ON, the
// values must be byte-identical.
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const a = Array.from(ctx.getImageData(canvas.width/2, canvas.height/2, 1, 1).data);
setTimeout(() => {
  const b = Array.from(ctx.getImageData(canvas.width/2, canvas.height/2, 1, 1).data);
  console.log({ stationary: a.every((v, i) => v === b[i]) });
}, 300);
```

If `stationary === false`, your rAF loop isn't gated on motion preference.

### Validate scroll-driven motion freezes

```js
const el = document.querySelector('.your-floater');
const before = getComputedStyle(el).transform;
window.scrollTo(0, 400);
setTimeout(() => {
  const after = getComputedStyle(el).transform;
  console.log({ frozen: before === after });
}, 500);
```

If `frozen === false`, your `useScroll` / `useTransform` outputs aren't disabled.

### Validate typing animations stop

```js
const el = document.querySelector('.your-typing-target');
const a = el.textContent;
setTimeout(() => console.log({ frozen: el.textContent === a }), 500);
```

The static reduced-motion value should be the first text in the cycle, not mid-animation.

## Gate D — Print preview verification

Run this even if `capabilities.print = false`. A bad print can be confidently disabled, but you still want to know what your variant looks like printed.

### Recipe (Chrome — most reliable)

In the running app on `/preview/<slug>`:

```
Chrome menu → Print  (or Ctrl/Cmd + P)
```

Verify:
- [ ] **Layout doesn't overflow page width.** Cards reflow; SVGs aren't bigger than page width.
- [ ] **Backgrounds aren't solid black.** White paper, dark ink. Token leaks (gradient backgrounds, dark card-bg) get caught here.
- [ ] **Decorative chrome is hidden.** Canvas, theme toggle, nav, skip-link, floaters — all `display: none`.
- [ ] **Gradient text is solid black.** `background-clip: text; color: transparent` defaults must be reset.
- [ ] **Buttons are outlined, not filled.** Gradient backgrounds don't print well.
- [ ] **Inline link URLs surface** (article-body links only — not nav, not buttons).
- [ ] **Sections don't split mid-card.** `page-break-inside: avoid` on `.kc-section` and `.kc-card`.

### Recipe (DevTools-only, when you can't trigger Print)

```js
// Walks every stylesheet and rewrites @media print rules to match all media,
// so you can see the print layout in the browser viewport.
for (const sheet of document.styleSheets) {
  try {
    for (const rule of sheet.cssRules || []) {
      if (rule instanceof CSSMediaRule && rule.media.mediaText.includes('print')) {
        rule.media.mediaText = 'all';
      }
    }
  } catch (e) { /* CORS-blocked stylesheets, skip */ }
}
```

Then scroll through the page. You see exactly what print preview would render. Reload to revert.

### When print fails

Don't ship a broken print stylesheet. Set `capabilities.print = false` in the manifest and write `## Print` in DESIGN.md as `Not supported.` Print is opt-in. Ship without it cleanly is fine; ship with broken print is not.

## Gate E — `/variants` listing entry

Verify your variant appears correctly on the gallery page. Open `http://localhost:3000/variants` and confirm:

- [ ] Your variant card is present alongside others.
- [ ] Name, version, description match `manifest`.
- [ ] Aesthetic / motion / typography / density chips render.
- [ ] "N schemes, N typesets" count is correct.
- [ ] Best-for tags display if you set them.
- [ ] Activate / Preview buttons link correctly.
- [ ] Screenshot thumbnail renders (requires `manifest.screenshots` populated AND PNGs present at the declared paths).

If the screenshot thumbnail is broken, run the screenshot capture recipe (Gate F).

## Gate F — Screenshot capture

`manifest.screenshots` declares paths under `/variants/<slug>/`. The PNGs must exist as static assets at `apps/web/public/variants/<slug>/`.

### Recipe (manual)

For each manifest entry, navigate to the right config and capture:

```
http://localhost:3000/preview/<slug>?scheme=<id>&typography=<id>
```

with the desired theme set via `localStorage.setItem('portfolio:theme', '...')` before reload.

Wait for first paint + 1.2s for animations to settle (typing cursor, dispersal entrance, gradient text shift). Capture browser screenshot to `apps/web/public/variants/<slug>/<scheme>-<theme>-<typography>.png`.

### Recipe (automated, optional)

The visual companion's `--matrix` mode runs `preview-matrix.mjs` which captures across `theme × scheme × typography`. Requires Playwright. See `references/visual-companion.md`.

### Image quality

PNGs at viewport 1440×900, retina 2x is fine. Targets ≤ 800KB per image. If you exceed that, use WebP via `format: 'webp'` and update the manifest.

## Gate G — Fidelity comparison (when porting from a reference)

If your variant is a re-imagining of an archive variant, another platform's design, or a Figma mockup, verify the fidelity didn't regress on signature elements.

### Recipe

For each "signature interaction" identified in DESIGN.md's `## Component inventory` section (see DESIGN.template.md), confirm the new variant has it:

| Reference signature | Present in new variant? | Notes |
|---|---|---|
| Floating elements with parallax dispersal | yes / no | … |
| 3D mouse-tilt cards | yes / no | … |
| Multi-text typing animation | yes / no | … |
| Animated counters | yes / no | … |
| Brand-colored social cards | yes / no | … |
| (etc.) | | |

If any are "no", and they're load-bearing for the metaphor, the variant isn't done. Either implement them or document why they were intentionally dropped (data shape mismatch, scope decision).

This gate is the difference between "the variant compiles" and "the variant feels right".

## Gate H — Real-data testing

`portfolio.example.yml` is a curated, well-formed dataset. Real users have weird data. Verify against the user's actual `portfolio.yml`:

- [ ] Long organization names don't overflow timeline cards.
- [ ] Long URLs in print don't break layout.
- [ ] Empty sections (e.g. no `gallery` items) render gracefully — no error, no awkward empty card.
- [ ] Missing optional fields (no `subtagline`, no `period.end`) don't crash renderers.
- [ ] Mojibake / non-ASCII characters render correctly in the chosen fonts.

Found bugs go back to Wave 2 — defensive destructuring, `null` short-circuits, `Array.isArray(items) && items.length > 0` guards. Don't ship past this gate.

## Gate I — Mobile breakpoint sweep

Resize to 375×667 (iPhone SE) and 430×932 (iPhone Pro Max) and confirm:

- [ ] Decorative floating elements hidden or repositioned (not pushing layout wider).
- [ ] Hero CTAs stack vertically.
- [ ] Nav collapses to hamburger.
- [ ] Cards don't overflow horizontally.
- [ ] Timeline (if present) is usable on a narrow viewport — single-column collapse or horizontal scroll, your call but it must be intentional.
- [ ] Text remains readable at body size; nothing shrinks below 12pt.
- [ ] Hit targets (buttons, links) are at least 44×44 px.

## Phase 3 sign-off summary

You've passed Phase 3 when:

- All scripted gates exit clean (`audit.mjs`, `kit-dedup.mjs`, `pnpm typecheck`, `pnpm lint`, `pnpm build`).
- Gates A–I all pass with screenshots/notes captured for the PR description.
- DESIGN.md and the variant package are on the same branch.
- The user has visually approved at least one combination.

If any gate fails, the variant goes back to Wave 2 or Wave 3 — not "fix in a follow-up PR".
