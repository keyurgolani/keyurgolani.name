# Common bugs that escape first-iteration variant development

> Distilled from real variant builds, where each bug shipped past the
> typecheck, the audit, and an HTTP 200 because it was a visual failure the
> toolchain can't detect. Load this in Phase 2 Wave 1, so the layout is
> written correctly the first time, and again in Phase 3, so the visual
> gates know what to look for.
>
> Every bug here cost a separate validation round in a real session.

## 1. The stylesheet never reaches the page

### What it looks like

- The variant compiles, `/preview/dev/<id>/complete` answers 200, and `data-variant="<id>"` is on the boundary.
- The sections are there, stacked in the host's defaults, with none of your arrangement.

### Why

Registry generation compiles the file your `./styles.css` export names into `apps/web/public/_portfolio/variant/<id>.<hash>.css`, and the host links it on the pages that render your variant. A missing export, an export pointing at the wrong file, or rules that don't start with `[data-variant='<id>']` all leave your layout off the page.

### Fix

Run `pnpm check:variants --package @portfolio/variant-<id>`. It names a missing export or file, and every unscoped selector. `pnpm dev` regenerates the registry when it starts; after changing `package.json` or your stylesheet mid-session, run `pnpm --filter @portfolio/web build:registry` or restart it.

## 2. A scoped element rule outranks a class

### What it looks like

- A component's own rule, such as `.ao-action { display: inline-flex }`, has no effect on the links it's meant for.
- DevTools shows a `[data-variant='<id>'] a` rule winning.

### Why

`[data-variant='<id>'] a` has specificity 0,1,1. A class-only rule, `.ao-action`, has 0,1,0, so the element rule wins on every classed link.

### Fix

Contract 2.0 already requires the scope on every rule, so write component rules as `[data-variant='<id>'] .ao-action` (0,2,0), which outrank the element rule. For page-wide element rules, restrict them to unclassed elements, `[data-variant='<id>'] a:not([class])`, so prose links keep the default and components keep theirs.

## 3. SVG gradient and filter URLs broken by spaces in ids

### What it looks like

- SVG paths render with `stroke="none"` although the markup says `stroke="url(#grad-Foo)"`.
- The computed style says `stroke: none`. The lookup failed silently.

### Why

A fragment reference, `url(#name)`, treats the id as a literal identifier: spaces, slashes, and colons break it. Ids synthesized from organization names or section titles give `url(#grad-Gujarat Technological University-...)`, which SVG can't resolve.

### Fix

Slugify every synthesized id you reference with `url(#...)`, and start it with `input.ids.prefix`, so a preview frame and the host page can share a document:

```ts
import { slugify } from '@portfolio/kit';
const gradientId = `${input.ids.prefix}${slugify(`chronology-${entry.organization}-${entry.title}`)}`;
```

A record's id is safe as it is: `${input.ids.prefix}grad-${entry.id}` needs no slugify.

Do it for every `<linearGradient id>`, `<filter id>`, `<mask id>`, and `<clipPath id>`, and the strings that reference them.

## 4. Reserved-id collision with section ids

### What it looks like

- The hero is squeezed to 80px wide, pinned to one edge.
- Other sections render correctly.
- The hero element shows `position: absolute; inline-size: 1px; block-size: 1px`.

### Why

A common idiom is an anchor at the top of the page for a "scroll to top" link:

```css
[data-variant='acme-ocean'] [id='top'] {
  position: absolute;
  inset-block-start: 0;
  block-size: 1px;
  inline-size: 1px;
}
```

Every section's DOM id is `input.ids.prefix` and its portfolio id, and a hero is often `top`, so the hero's `<section id="top">` matches the rule.

### Fix

Don't use single-word ids (`top`, `main`, `home`) for layout tricks. Either:

- Use a class and a script: `<a className="ao-nav__brand">` with `window.scrollTo({ top: 0 })` on click. No id needed.
- Use a namespaced id, `${input.ids.prefix}ao-page-top`, and target only that.

Portfolio ids are short words authors choose, such as `top` or `about`; assume any single-word id may collide. `input.ids.main` is your `<main>`'s.

## 5. Retired: theme tokens leaking into print

A v1 variant defined its own theme tokens and had to reset each one for print. A contract 2.0 variant defines none: #19's tokens and their print values are the appearance system's.

## 6. Missing scroll margin for fixed-header anchors

### What it looks like

- A navigation link scrolls to its section, but the heading is hidden behind the fixed header.
- `scrollIntoView({ block: 'start' })` puts the section's top at the viewport's top, ignoring the header.

### Fix

Every section that's a scroll target needs a scroll margin matching the header's height:

```css
[data-variant='acme-ocean'] section {
  scroll-margin-block-start: 5rem; /* the header's block size */
}
```

One rule covers every section. Add it with the navigation in Wave 3, at the section level, not per renderer.

## 7. Retired: text gradients that don't print

Gradient text is a color effect, so it's the appearance system's (#19) now, with its print handling.

## 8. Reduced motion that doesn't reduce motion

### What it looks like

- The site's `motionPolicy` is `reduce`, or the visitor asks for reduced motion under `respect-os`, but a canvas still animates, particles still fall, parallax still moves.
- `document.getAnimations()` lists animations still running after load, after a jump, or once a section scrolls into view; a `requestAnimationFrame` loop keeps asking for frames; or a link still scrolls smoothly to its section. The motion contract (`tests/e2e/motion-contract.spec.ts`) fails.

### Why

`@media (prefers-reduced-motion)` can stop CSS animations and transitions, but not `requestAnimationFrame` loops, framer-motion's `useTransform` outputs, its Web Animations API animations, or `scrollIntoView({ behavior: 'smooth' })`. Those need gating in the script.

### Fix

Wrap the variant's client parts in `MotionPolicyProvider` with `input.presentation.motionPolicy`, and gate every animation entry point on `useMotionPreference()`:

```tsx
const reduceMotion = useMotionPreference() === 'reduce';

useEffect(() => {
  if (reduceMotion) {
    drawFrame(); // one still frame
    return;
  }
  // the requestAnimationFrame loop
}, [reduceMotion]);
```

For framer-motion's `useScroll` and `useTransform`, pass `enabled: !reduceMotion` to your wrapper hook (the kit's `useScrollDispersal` does). A framer-motion variant also wraps its root in `MotionConfig`, `reducedMotion: 'always'` under the site's `reduce` and `'user'` otherwise; `legacy/variant-kinetic-cosmos/src/primitives/motion-config.tsx` shows how. That skips transform and layout animations only, and opacity still animates, so an entrance takes `initial={reduce ? false : 'hidden'}`, an animation that repeats forever isn't rendered under reduce, and scrolling takes `behavior: reduce ? 'auto' : 'smooth'`.

**Check it programmatically.** The motion contract covers what `getAnimations()` lists at load, after a jump, and as the page scrolls, every `requestAnimationFrame` loop, and how links scroll. For a canvas drawn on a timer or a typing animation, use the recipes in `quality-gates.md` Gate C.

## 9. Floating elements drifting off the page at small viewports

### What it looks like

- Decorative floaters push the layout wider than the viewport on phones.
- A horizontal scrollbar appears.
- Cards overlap text.

### Fix

Hide decoration at mobile widths rather than shrink it:

```css
@media (max-width: 639px) {
  [data-variant='acme-ocean'] .ao-floater {
    display: none;
  }
}
```

If you must keep it, clamp its position to the viewport, and use `position: absolute` inside an `overflow: hidden` parent rather than `position: fixed`.

## 10. Data drift when porting from a reference

### What it looks like

- The reference (a `legacy/` package, page-zero) had richer data than the schema carries.
- The schema dropped or renamed fields the reference's renderers used (such as `experienceTracks[].branch` against a chronology entry's `thread`, which the owner writes and nothing infers).
- Renderers crash on missing fields, or render less than the reference did.

### Fix

**Before Phase 1**, diff the data shapes. List every field the reference touches, and map each to the schema. When one is missing:

- **Renamed** (the old `track.branch`, which is a chronology entry's `thread` now, written by the owner): read it as it is. Never infer it.
- **Inferable** (how long a role ran, from its `period`): document the rule in DESIGN.md.
- **Not modeled** (an old per-skill `proficiency: 80%`): say it's dropped, and adjust the renderer. Don't fake the data.
- **Composed from several records** (an old timeline that merged work, study, research, and awards): document that the renderer reads the chronology entries a section lists, and the works and evidence they point at.

Skip this and Wave 2 stalls when a renderer can't reproduce the reference.

## Watch for these in code review

A reviewer can spot most of these without running the app:

- A new SVG `id=` that isn't slugified and prefixed.
- A new `[data-variant='<id>'] a` rule without `:not([class])`.
- A new section the scroll margin rule doesn't cover.
- A new `requestAnimationFrame` call that doesn't check the motion preference.
- A CSS hook on a single-word id (`top`, `main`, `home`) a portfolio section could also have.
- A color, font, or theme rule in a variant's stylesheet.
