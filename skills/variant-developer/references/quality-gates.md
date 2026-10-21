# Quality gates: visual validation recipes

> `pnpm check:variants` catches contract and source problems. The visual
> gates catch what passes them and still looks broken. Load this at the
> start of Phase 3, before declaring a variant done.
>
> Every recipe here exists because a variant shipped past the typecheck,
> the audit, and an HTTP 200 with the bug still present.

Color, type, and display modes are the appearance system's (#19), so these gates judge composition: structure, order, reveal, and behavior. Until #19 ships, every variant renders in the host's neutral defaults.

## Gate A: Visual sanity (first, before anything else)

About 30 seconds. Catches "the structure isn't there".

```bash
skills/variant-developer/scripts/visual-companion/start.sh --mode preview --variant <id>
```

Open `http://127.0.0.1:3000/sample?variant=<id>`. The script runs `pnpm dev` under `PORTFOLIO_PROFILE=demo`, which renders the bundled sample in any registered variant.

**You must see:**

- `data-variant="<id>"` on the boundary, and no `data-requested-variant` (that marks the fallback standing in).
- Your arrangement: the grid, the columns, the navigation you wired, the visitor control slot where the manifest places it.
- Every section the sample has, in the order your composition puts them.

**A 404** means the build doesn't register the id. Run `pnpm check:variants --package @portfolio/variant-<id>` and read the diagnostic. **Unarranged structure** means the stylesheet isn't reaching the page: check the `./styles.css` export, and that every selector starts with `[data-variant='<id>']`.

## Gate B: Content matrix

The structure gate. The bundled sample is curated; a composition has to hold for a sparse portfolio and a dense one too.

| Pair                                                              | What to verify                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| The bundled sample, at `/sample?variant=<id>`                     | Every kind renders; navigation names every titled section |
| A sparse pair: a hero and one or two sections                     | No empty frames, no navigation to nothing                 |
| A dense pair, such as `packages/schema/src/__fixtures__/pairs/*/` | Long lists, many sections, nested items stay readable     |
| `pairs/mixed`, which is Arabic and right to left                  | The composition mirrors; nothing is pinned to the left    |

To render a pair of your own under `pnpm dev`, put it in `config/` with `appearance.variant: <id>`, or point `PORTFOLIO_SOURCE_DIR` at its directory.

What "holds" means:

- **Order** matches the composition's idea, and the reading order matches the visual order.
- **Empty and missing content** leaves no shell: a section with no items renders nothing, and a content slot follows its `whenEmpty`.
- **Navigation** links only sections that render.
- **Headings** descend in order: one `h1`, then section headings.

## Gate C: Reduced motion

### The motion contract

```bash
pnpm build
pnpm exec playwright test tests/e2e/motion-contract.spec.ts
```

For every registered composition, under `motionPolicy: reduce` and under `respect-os` with the visitor's reduced-motion setting: no animation runs once the page settles, after the jump, or at any step of scrolling each scroll container from top to bottom (the Web Animations API lists CSS animations, transitions, and script animations); no script keeps a `requestAnimationFrame` loop going; and a navigation link to `#contact` jumps rather than scrolls, in the window or in a scroll container of the composition's own. Its controls show the checks see an animation, a frame loop, and a smooth scroll when there is one, and `tests/e2e/motion-harness.spec.ts` plants each case the checks are for. It must pass before a variant registers.

### What the contract can't see

A canvas drawn on a timer, or a text animation, shows neither in `getAnimations()` nor as a frame loop. Check each one with reduced motion on (DevTools, Rendering, emulate `prefers-reduced-motion: reduce`):

```js
// A canvas: sample one pixel 300 ms apart. Under reduced motion the values match.
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const a = Array.from(ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data);
setTimeout(() => {
  const b = Array.from(ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data);
  console.log({ stationary: a.every((v, i) => v === b[i]) });
}, 300);
```

```js
// Scroll-driven motion: the transform doesn't change as the page scrolls.
const el = document.querySelector('.your-floater');
const before = getComputedStyle(el).transform;
window.scrollTo(0, 400);
setTimeout(() => console.log({ frozen: before === getComputedStyle(el).transform }), 500);
```

```js
// A typing animation: the text stays put, at the first text in the cycle.
const el = document.querySelector('.your-typing-target');
const a = el.textContent;
setTimeout(() => console.log({ frozen: el.textContent === a }), 500);
```

If one moves, its script isn't gated on `useMotionPreference()`. (`references/common-bugs.md` §8)

## Gate D: Print preview

A visitor can always print, so check what they get. In the running app, with your variant selected:

```
Chrome menu, Print (or Ctrl/Cmd + P)
```

Verify:

- [ ] Nothing overflows the page width.
- [ ] Navigation, the visitor control slot, and decoration are hidden.
- [ ] Content prints in reading order, with no section split mid-item where `break-inside: avoid` can prevent it.

When you can't trigger Print, this shows the print layout in the viewport:

```js
for (const sheet of document.styleSheets) {
  try {
    for (const rule of sheet.cssRules || []) {
      if (rule instanceof CSSMediaRule && rule.media.mediaText.includes('print')) {
        rule.media.mediaText = 'all';
      }
    }
  } catch (e) {
    /* A stylesheet from another origin: skip it. */
  }
}
```

Reload to revert.

## Gates E and F: retired

Gate E checked a variant's card in the variant gallery, which the platform no longer serves. Gate F checked `manifest.screenshots`, which contract 2.0 dropped: the contract fixtures render the screenshots. The letters that follow keep their names.

## Gate G: Fidelity against the reference (port-only)

When the variant ports a `legacy/` package, another platform's design, or a Figma, check that its signature elements survived. For each signature interaction in DESIGN.md's `## Component inventory`:

| Reference signature                       | Present? | Notes |
| ----------------------------------------- | -------- | ----- |
| Floating elements with parallax dispersal | yes / no | ...   |
| 3D mouse-tilt cards                       | yes / no | ...   |
| Multi-text typing animation               | yes / no | ...   |
| Animated counters                         | yes / no | ...   |
| (and so on)                               |          |       |

A "no" on something load-bearing for the idea means the variant isn't done: implement it, or document why it was dropped. A reference's palette, fonts, and theme modes aren't fidelity targets for the variant; they're #19's, recorded as `folded-into-pack` in `provenance`.

## Gate H: Real data

`portfolio.example.yml` is curated. Check against the user's own `portfolio.yml` and `site.yml`:

- [ ] Long organization names and titles don't overflow.
- [ ] Empty sections render nothing, with no error and no empty frame.
- [ ] Missing optional fields (no `subtagline`, no `period.end`) don't crash a renderer.
- [ ] Non-ASCII text renders correctly.
- [ ] A right-to-left pair mirrors, if the manifest declares `rtl`.

A bug found here goes back to Wave 2: defensive rendering, `null` returns, `items.length > 0` guards.

## Gate I: Mobile sweep

At 375×667 and 430×932:

- [ ] Decoration is hidden or repositioned, never pushing the layout wider.
- [ ] Calls to action stack.
- [ ] Navigation collapses.
- [ ] Nothing overflows horizontally.
- [ ] A timeline, if present, is usable: one column or a deliberate horizontal scroll.
- [ ] Hit targets are at least 44×44 px.

## Phase 3 sign-off

You've passed Phase 3 when:

- Every scripted gate exits clean (`pnpm check:variants`, the motion contract, `kit-dedup.mjs`, `pnpm typecheck`, `pnpm lint`, `pnpm build`).
- Gates A to I, less the retired E and F, pass, with screenshots and notes for the PR description.
- DESIGN.md and the package are on the same branch.
- The user has looked at it and approved.

A failing gate sends the variant back to Wave 2 or 3, not to a follow-up PR.
