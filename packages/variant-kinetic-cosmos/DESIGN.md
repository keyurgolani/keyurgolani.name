# DESIGN.md: variant-kinetic-cosmos

> #14's build-to scope, approved by the owner on 2026-10-22, is the design contract: `_execution/scope/keyurgolani.name/14.md`. This file says how the package meets it. The first pull request built the still composition; the second added the motion layer on #6's runtime.

## Composition idea

An orbital opening, evidence you can pick up and open, and a chronology that branches where the path did.

The page is a small cosmos of the owner's work: the opening sits in front of an orbit around one luminous core, with a field of glyphs falling behind it, evidence records are objects that open in place, and the chronology runs in lanes from the owner's own threads. Everything a visitor needs is in the page's order, as links and disclosures. The motion only adds to a still composition that is already complete, and gives way to it whenever motion should stop.

## Manifest summary

| Field                      | Value                                                     |
| -------------------------- | --------------------------------------------------------- |
| `id` / `name`              | `kinetic-cosmos` / `Kinetic Cosmos`                       |
| `compositionFamily`        | `kinetic`                                                 |
| `motionIntent`             | `kinetic` (the catalog's pin)                             |
| `performanceTier`          | `medium` (the catalog's pin)                              |
| `renderedKinds`            | `hero`, `evidence`, `chronology`                          |
| `unsupportedKinds`         | none                                                      |
| `routes`                   | home and work shared, no views                            |
| `visitorControl.placement` | `header`                                                  |
| `textDirection`            | `ltr`, `rtl`                                              |
| `budgets`                  | measured by `pnpm ci:budgets`, inside the medium ceilings |

## Arrangement

A wide single column, up to 72rem, with room between sections. The opening is a full block with the orbit behind the hero's words, at the inline end, and the glyph field behind both. Evidence is a grid of objects; an open one takes the whole row. A chronology is one ordered list: on a large screen each lane is a column of the list, and a fork or a join draws a connector to the rail of the lane it names, on whichever side; on a small one it's one vertical list.

## Navigation and reveal

- A bar of section links on a large screen, and #19's Dialog with the same links on a small one. Each set is in the tab order only while it shows. Every titled section is linked, with no cap.
- Following a link in the menu closes the dialog, which gives focus back to its button, and then goes to the section.
- Evidence opens in place, through native disclosures. Nothing reveals on hover, scroll, drag, or pointer position.
- The chrome is all there from the server's first paint, for keyboard and touch before any pointer moves. During passive viewing the section links recede: after the visitor has done nothing for twenty of the motion pack's slow durations, they ease to the muted text color. Every color pack holds that color to text contrast, so they stay readable, in view, and in the tab order. Pointer movement, a press, a touch, or a key brings them back, and so do hover and focus inside the chrome. The pause control beside them is the explicit control: paused, they never recede.

## Motion plan

All of it runs on #6's runtime, keyed on the runtime's state, never on `data-motion` alone, which #19 leaves the OS setting out of.

- **The stage.** The opening is the runtime's root. While its runtime is active or paused, it carries `data-runtime`, and the stylesheet starts the motion only under it. Paused, the runtime's `data-activity` holds every animation where it is: the document hidden, the opening offscreen, the visitor's pause, or a preview out of focus. Static, before the page has mounted, under reduced motion from the OS, the site, or a preview, after a failure, and in a plate, there's no `data-runtime`, and the still composition shows: no glyph, no satellite, the orbit where the server drew it.
- **The orbit.** It turns once in 400 of the motion pack's slow durations, a satellite on each ring so the turn shows. A pointer can drag it round. The drag sets a rotation on the orbit's own wrapper from pointer events alone, with no frame loop, and shows nothing that isn't on the page already. It goes back to where the server drew it when motion stops.
- **The glyph field.** A fixed field of code punctuation, never words and nothing from a section: 12 glyphs on each of two layers, every one server rendered at a position that's the same on every render, and none of them growing with the content or the window. Each layer is one tile drawn twice, falling half its height in 300 or 180 slow durations, so it starts over seamlessly. Each glyph is a pseudo-element's `content`, so it's never text in the page, and the field is hidden from assistive technology. Its color and type are the packs' own, `var(--color-text-muted)` and the code type role, so nothing is read through `getComputedStyle`, on any frame.
- **The chrome's recession**, above, on the chrome's own runtime: it recedes only while the chrome is in view on a visible page with motion on and not paused.
- **The pause control.** #6's `MotionControl`, beside the visitor control: one visible toggle that pauses every continuous source on the page. Under reduced motion it's disabled and says why; under the site's reduce policy, and in a plate, there's none.

Each animation is a transform on a layer of its own, so nothing lays out or repaints while it runs, and the only other change, the recession, is a one-time color ease. Three run forever on an active page: the two glyph layers and the orbit.

### Design note: a field of elements, not a canvas

The scope's glyph field, v1's canvas, is a bounded field of `aria-hidden` elements on CSS animations. Three reasons:

1. **Stills.** `test:variants` compares each desktop and mobile screenshot with its baseline pixel for pixel, with animations disabled, which sets each CSS animation at its first frame. A canvas drawn every frame never holds still for one.
2. **Tokens.** The packs' color and type apply as they do to any element, so there's nothing to read, and nothing to read again when the appearance changes.
3. **Timing.** Each duration is a multiple of the motion pack's `--ui-motion-slow`, so the packs set the pace, as the scope asks of timing.

## Section coverage map

| Kind         | Treatment | Notes                                                                                         |
| ------------ | --------- | --------------------------------------------------------------------------------------------- |
| `hero`       | bespoke   | The orbital opening: the shared hero's words in front of the orbit and the glyph field.       |
| `evidence`   | bespoke   | Each record a disclosure, its face its title, or its figure and statement, the record inside. |
| `chronology` | bespoke   | One ordered list, each entry in its thread's lane through `threadLanes`.                      |
| every other  | shared    | The kit's shared renderers, inside the composition's spacing.                                 |

## Controls and content slots

N/A: there's no owner-tunable choice and no slot. The orbit's profile count and the content slots are in the backlog.

## Kit usage map

- `@portfolio/kit/sections`: `renderSection`, `SHARED_RENDERERS`, `EvidenceEntry`, `ChronologyItem`, `SectionHeader`, `renderContext`, `evidenceOf`, `chronologyOf`, `recordAnchor`, `formatFigure`, `present`, `RichText`, `VisitorControlSlot`.
- `@portfolio/kit/timeline`: `threadLanes` and `laneCount`, hoisted for this package: lanes from authored threads, tested on their own.
- `@portfolio/kit/runtime`: `useEnhancementRuntime` for the stage and the chrome, and `MotionControl`. Nothing draws frames, so nothing loops through `useFrameLoop`.
- `@portfolio/appearance/primitives`: `Dialog` for the menu and `Disclosure` for evidence; `@portfolio/appearance/react`: `useBoundary`, so the menu link, the stage, and the chrome attach no listener in a plate.
- Kit fixes the port needed: `AnimatedCounter` renders the real value on the server, and `TypingAnimation` no longer announces through a polite live region.

## Performance tier

`medium`, the catalog's pin, and the composition stays inside it. Its declared budgets are what `pnpm ci:budgets` measured with the motion layer in: three running animations, the medium ceiling, and its JavaScript and CSS, which the manifest declares.

## Accessibility

- Focus order: the boundary's skip link, the section links or the menu button, the visitor control, the pause control, then the main in reading order.
- The menu is a native modal dialog: named by its title, Escape closes it, focus stays inside, and focus goes back to the button. Scrolling stops in CSS, never through `document.body`.
- Evidence disclosures are native: the summary is the accessible name, the record's title or else what it says, with any figure before it, so a figure never stands alone. It says whether it's open, focus stays on it, and no heading sits inside it.
- The chronology's DOM order is its visual order on every screen, so Tab follows reading order. Nothing is positioned off its axis or clipped.
- Decoration, the orbit and the glyph field, is hidden from assistive technology, and nothing moving is the only way to anything. The host's two words, Sections and Close, carry `lang="en"` in a portfolio in another language.
- Motion that starts on its own pauses from one visible control (WCAG 2.2.2), and none of it flashes.

## Appearance boundary

Color, type, materials, radius, shadow, and timing are #19's tokens. The one signature is the design language's signature fill, `var(--ui-signature-fill)`, on the orbit's core alone: no gradient text, no glass, no gradient section titles. The satellites take the accent, and the glyphs the muted text color and the code type role. Under high contrast and forced colors the platform stylesheet already makes the fill solid. The composition never overrides a visitor's appearance selection.

# Port-only sections

## Component inventory

| v1 piece                                                | What it did                                               | Plan                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `variant.tsx`                                           | Root, theme toggle, background, nav                       | The composition; the theme toggle is retired to #19.                                |
| `primitives/navigation.tsx`                             | Sliding nav, body scroll lock, eight-item cap             | The chrome: a bar and #19's Dialog, no lock, no cap, receding in place.             |
| `renderers/hero.tsx`                                    | Typing roles, gradient name, hidden entrance              | The orbital opening, on the shared hero.                                            |
| `renderers/experience.tsx`                              | SVG fork/merge timeline with `foreignObject` cards        | One ordered list in authored lanes; no SVG cards.                                   |
| `lib/timeline-events.ts`                                | Keyword lane classifier                                   | Retired: `threadLanes` reads the authored threads.                                  |
| `renderers/projects.tsx`                                | Filterable cards that expand on click                     | The shared works renderer; expansion is the backlog's.                              |
| v2 kinds (`talks`, `stats`, `press`, `testimonials`, …) | One renderer per kind                                     | Evidence records, through the evidence objects.                                     |
| `renderers/github.tsx`                                  | `fetchGitHubData` during render                           | The shared github renderer, from #10's snapshot.                                    |
| `primitives/floating-profile-cluster.tsx`               | Draggable brand cards                                     | A draggable orbit; the profiles are the backlog's orbital opening rules.            |
| `primitives/animated-background.tsx`                    | Unpaused glyph canvas, tokens read every frame            | A fixed field of glyph elements on the runtime, the packs' tokens applied directly. |
| `primitives/markdown-body.tsx`, `action-link.tsx`       | Local markdown and links                                  | #5's `RichText` with #10's sanitizer, and the kit's link pieces.                    |
| `styles.css`                                            | 2,838 lines: 536 `--kc-*`, 123 hex, a Google Fonts import | A layout stylesheet on #19's tokens, none of those left.                            |

## Signature interactions

- The orbit around the opening: turning on the runtime, and a pointer can drag it.
- Evidence objects that open: disclosures; tilt and glow are the backlog's.
- The forking timeline: authored lanes, with fork and join connectors to the lanes they name.
- Falling glyphs and the receding chrome: on the runtime, both gone under reduced motion.

## Data-shape diff

v1 rendered v2's section kinds; v3 holds records. Experience and education become chronology entries, projects become works, and talks, awards, press, publications, patents, stats, and testimonials become evidence by type. Lanes come from `thread`, `branchesFrom`, and `mergesInto`, never from words. Nothing the scope keeps is lost.

## Fidelity targets

- [x] An orbital opening around one luminous signature.
- [x] Evidence as objects that open in place.
- [x] A chronology that branches on large screens and is vertical on small ones.
- [x] The glyph field, orbit motion and drag, and receding chrome, on #6's runtime, with the pause.
