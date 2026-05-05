# Common bugs that escape first-iteration variant development

> Distilled from real variant builds where each bug shipped past typecheck,
> audit, and HTTP-200 because they were *visual* failures the toolchain
> can't detect. Load this during Phase 2 Wave 1 (so the layout primitives
> are written correctly the first time) and again during Phase 3 (so the
> visual gates know what to look for).
>
> Every bug listed here cost a separate validation iteration in a real session.
> Avoiding them up front pays back the time tenfold.

## 1. Host CSS injection

### What it looks like
- Variant compiles, registry lists it, `/preview/<slug>` returns 200.
- Page renders as black-and-white user-agent default — no colors, no glassmorphism, no fonts.
- The `data-variant='<slug>'` attribute is on the root, but no CSS rule matches it.

### Why
The host's `apps/web/src/app/layout.tsx` has to import each variant's `styles.css` for the rules to land in the bundle. If the host hard-codes one variant's import (the legacy state of the repo before this was generalized), every other variant's stylesheet is orphaned.

### Fix
The repo now generates `apps/web/src/lib/registry.styles.generated.ts` alongside `registry.generated.ts` — a side-effect import file that pulls every registered variant's `styles.css`. The layout imports the generated file, not any specific variant. Run `pnpm --filter @portfolio/web build:registry` to regenerate after scaffolding a new variant. **If your variant's CSS doesn't render, check that file first.**

## 2. CSS specificity trap with global anchor styles

### What it looks like
- Buttons render with the wrong text color — usually invisible on the active gradient.
- Theme toggle active pill, primary CTA, contact LinkedIn button all share the same broken color.
- DevTools shows `color: rgb(...)` resolving to the variant's `--kc-primary` (or whatever your accent variable is) **even though** your `.kc-action--primary` rule says `color: #ffffff`.

### Why
Every variant defines a default anchor style scoped to the variant root:

```css
[data-variant='your-slug'] a {
  color: var(--accent);  /* specificity: 0,1,1 */
  text-decoration: underline;
}
```

A class-only rule like `.kc-action--primary { color: #fff }` has specificity `0,1,0` — **lower** than the attribute-scoped descendant selector. The global anchor rule wins on every classed `<a>` button.

### Fix
Two options. Pick one and apply it consistently:

1. **Restrict the global rule to unclassed anchors** (recommended):
   ```css
   [data-variant='your-slug'] a:not([class]) {
     color: var(--accent);
     ...
   }
   ```
   Any anchor with a `kc-*` (or whatever prefix you use) class falls through to its component rule. Inline prose links still inherit the default style.

2. **Bump every component rule's specificity** to `[data-variant='your-slug'] .my-class`. Repetitive but explicit.

This bug single-handedly makes every primary button on the page unreadable until you find it. Add it to your Wave 1 base-styles checklist.

## 3. SVG gradient/filter URLs broken by spaces in IDs

### What it looks like
- SVG paths render with `stroke="none"` even though the markup says `stroke="url(#grad-Foo)"`.
- Computed style: `stroke: none`. The gradient lookup silently fails.

### Why
SVG fragment refs (`url(#name)`) treat the ID as a literal CSS-style identifier — spaces, slashes, colons all break it. If you synthesize gradient IDs from data fields like organization names or section titles, you get `url(#grad-Gujarat Technological University-...)` and SVG can't resolve it.

### Fix
Always slugify any synthesized ID that you'll reference via `url(#...)`:

```ts
import { slugify } from '@portfolio/kit';
const eventId = slugify(`experience-${item.organization}-${item.role}-${period.startTs}`);
```

Apply this to every SVG `<linearGradient id>`, `<filter id>`, `<mask id>`, `<clipPath id>`, and the strings used to reference them. The kit's `slugify` is the canonical source.

## 4. Reserved-id collision with section IDs

### What it looks like
- The hero section is squeezed to 80px wide, pinned to the left edge of the page.
- Other sections render correctly.
- Inspecting the hero element shows `position: absolute; width: 1px; height: 1px`.

### Why
A common idiom is a top-of-page anchor for a "scroll to top" brand link:

```css
[data-variant='your-slug'] [id='top'] {
  position: absolute; top: 0; height: 1px; width: 1px;
}
```

Meanwhile, `ensureSectionId(section.id, 'top')` on a hero section *without an explicit id* returns `'top'` — and the hero `<section id="top">` matches the rule. Collision.

### Fix
Don't use single-word reserved IDs (`top`, `main`, `home`) for anchor tricks. Either:

- Use a class: `<a className="kc-nav__brand">` + JS `window.scrollTo(0, 0)` on click. No ID needed.
- Pick a namespaced ID: `id="kc-page-top"` and target only that.

The skill's `ensureSectionId` fallbacks are deliberately short — `'top'`, `'main'`, etc. — assume they may collide.

## 5. Theme tokens leaking into print

### What it looks like
- Print preview shows cards with dark gray (or pure black) backgrounds where you expected white.
- Body text on those cards is illegible.
- The `@media print` block sets `background: #ffffff` on the variant root — but cards still render dark.

### Why
Each card's background is `var(--kc-card-bg)`. That variable is set in the `[data-theme='dark']` block as a dark rgba. Your print rule resets `background` and `color` on the variant root but doesn't override `--kc-card-bg`. The card rule re-reads the dark-theme value at render time.

### Fix
In `@media print`, force every paper/ink/card token back to print-friendly values, not just the surface ones:

```css
@media print {
  [data-variant='your-slug'] {
    --kc-paper: #fff !important;
    --kc-paper-elevated: #fff !important;
    --kc-ink: #000 !important;
    --kc-ink-muted: #444 !important;
    --kc-card-bg: #fff !important;
    --kc-card-border: #999 !important;
    --kc-card-shadow: none !important;
    --kc-primary: #000 !important;
    --kc-accent: #000 !important;
  }
}
```

Anywhere you have a `var(--token)` with a theme-dependent default, that token must be reset in print or the dark theme bleeds through.

## 6. Missing `scroll-margin-top` for fixed-nav anchors

### What it looks like
- Clicking a nav link scrolls to the section, but the section's heading is hidden behind the fixed nav bar.
- Programmatic `scrollIntoView({ block: 'start' })` puts the section's `top` at viewport `0`, ignoring the nav.

### Fix
Every section that's a scroll target needs `scroll-margin-top` matching the nav height:

```css
.kc-section,
.kc-timeline,
.kc-hero {
  scroll-margin-top: 5rem; /* or whatever your nav height is */
}
```

This is a one-line fix that affects every section. Add it during Wave 3 navigation work, but the rule belongs at the section-base level, not per-renderer.

## 7. Text gradients that don't print or paste

### What it looks like
- Names, headings, stat values render with `background-clip: text; color: transparent` and a gradient background.
- In print preview, they vanish (text becomes invisible because `color: transparent` doesn't get the print-rule's `color: #000` override).
- Copy-paste preserves the styling, breaking text in other contexts.

### Fix
In `@media print`, explicitly null both background and `color` for every gradient-text class:

```css
@media print {
  [data-variant='your-slug'] .my-gradient-title {
    background: none !important;
    -webkit-background-clip: initial !important;
    background-clip: initial !important;
    color: #000 !important;
    -webkit-text-fill-color: #000 !important;
  }
}
```

Both `color` and `-webkit-text-fill-color` are required — Chrome respects whichever is more specific, and the WebKit prefix sometimes wins.

## 8. Reduced-motion that doesn't actually reduce motion

### What it looks like
- `prefers-reduced-motion: reduce` is set, but a canvas continues to animate, particles still fall, parallax still parallaxes.
- Dispatched scroll events show motion values still updating.

### Why
The CSS `@media (prefers-reduced-motion)` block can zero animation/transition durations, but it can't stop `requestAnimationFrame` loops or framer-motion `useTransform` outputs. Those need JS-level gating.

### Fix
At every animation entry point, gate on `useMotionPreference()` returning `'reduce'`:

```tsx
const reduceMotion = useMotionPreference() === 'reduce';

useEffect(() => {
  if (reduceMotion) {
    drawFrame(); // single static frame
    return;
  }
  // …rAF loop…
}, [reduceMotion]);
```

For framer-motion hooks like `useScroll` + `useTransform`, pass an `enabled: !reduceMotion` flag to your wrapper hook (the kit's `useScrollDispersal` does this). Spring-smoothed motion values that have already mounted will have stale momentum — accept that, or remount the element when the flag flips.

**Validate programmatically.** Don't trust "I checked the toggle once". Sample `getComputedStyle(canvas).backgroundColor` at the canvas center 300ms apart — pixel-stable means the rAF loop is stopped. Sample a floater's `transform` before/after a synthetic scroll — string-equal means dispersal is disabled. The skill's audit checklist now includes both checks.

## 9. Floating elements drifting off-canvas at small viewports

### What it looks like
- Decorative floaters (social profile cards, ambient elements) push the layout wider than the viewport on phones.
- Horizontal scrollbar appears.
- Cards overlap text.

### Fix
Decorative floating elements should be `display: none` at mobile breakpoints, not just shrink. They're decoration, not core content:

```css
@media (max-width: 639px) {
  .kc-floater { display: none; }
}
```

If you must keep them, change positioning logic to use viewport-relative-but-clamped values, and reduce `position: fixed` to `position: absolute` inside a `overflow: hidden` parent.

## 10. Schema-vs-archive data drift when porting from a reference

### What it looks like
- A reference (page-zero, another variant) had richer data than the current schema carries.
- The new schema dropped or renamed fields the reference's renderers used (e.g., `experienceTracks[].branch` vs flat `experience.items`).
- Renderers either crash on missing fields or render less faithfully than the reference.

### Fix
**Before Phase 1**, do a data-shape diff. List every field the reference renderer touches; verify each one's mapping to the current schema. When a field is missing:

- **Inferable** (e.g., archive's `track.branch` → infer from `inferKindFromText` on role + organization): document the heuristic in DESIGN.md.
- **Not modeled** (e.g., archive's per-skill `proficiency: 80%`): note explicitly that this is dropped, and adjust the renderer's visual richness accordingly. Don't fake the data.
- **Multi-section composition** (e.g., archive's "Timeline Odyssey" merged work + study + research + awards into one stream): document that you're pulling from multiple section kinds in the renderer.

Skipping this step means Wave 2 stalls when the renderer can't reproduce the reference's behavior. Better to know in Phase 1.

## Watch for these during code review

A code reviewer can spot most of these without running the app:

- Any new SVG `id=` attribute that isn't already slugified.
- Any new `[data-variant='X'] a` rule that doesn't include `:not([class])`.
- Any new section that isn't covered by the `scroll-margin-top` rule.
- Any new `@media print` block that doesn't reset card/paper tokens.
- Any new `requestAnimationFrame` callsite that doesn't check the motion preference.
- Any `ensureSectionId(..., 'top'|'main'|'home')` call where the fallback is a reserved CSS hook.
