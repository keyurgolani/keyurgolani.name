# DESIGN.md: variant-kinetic-cosmos

> #14's build-to scope, approved by the owner on 2026-10-22, is the design contract: `_execution/scope/keyurgolani.name/14.md`. This file says how the package meets it. The first pull request builds the still composition; the second adds the motion layer on #6's runtime.

## Composition idea

An orbital opening, evidence you can pick up and open, and a chronology that branches where the path did.

The page is a small cosmos of the owner's work: the opening sits in front of a still orbit around one luminous core, evidence records are objects that open in place, and the chronology runs in lanes from the owner's own threads. Everything a visitor needs is in the page's order, as links and disclosures. Motion, when it comes, only adds to a still composition that is already complete.

## Manifest summary

| Field                      | Value                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `id` / `name`              | `kinetic-cosmos` / `Kinetic Cosmos`                          |
| `compositionFamily`        | `kinetic`                                                    |
| `motionIntent`             | `kinetic` (the catalog's pin; the first PR moves nothing)    |
| `performanceTier`          | `medium` (the catalog's pin)                                 |
| `renderedKinds`            | `hero`, `evidence`, `chronology`                             |
| `unsupportedKinds`         | none                                                         |
| `routes`                   | home and work shared, no views                               |
| `visitorControl.placement` | `header`                                                     |
| `textDirection`            | `ltr`, `rtl`                                                 |
| `budgets`                  | measured by `pnpm check:budgets`, inside the medium ceilings |

## Arrangement

A wide single column, up to 72rem, with room between sections. The opening is a full block with the orbit behind the hero's words, at the inline end. Evidence is a grid of objects; an open one takes the whole row. A chronology is one ordered list: on a large screen each lane is a column of the list, and on a small one it's one vertical list.

## Navigation and reveal

- A bar of section links on a large screen, and #19's Dialog with the same links on a small one. Each set is in the tab order only while it shows. Every titled section is linked, with no cap.
- Following a link in the menu closes the dialog, which gives focus back to its button, and then goes to the section.
- Evidence opens in place, through native disclosures. Nothing reveals on hover, scroll, or pointer position.
- The chrome is all there from the server's first paint. Nothing recedes in the still composition.

## Motion plan

The first pull request moves nothing: no frame loop, timer, transition of its own, or animation, and the orbit is still. The second adds, on #6's runtime: the bounded glyph field behind the opening, orbit and drag, chrome recession with its reveal on pointer movement, focus, touch, or an explicit control, the pause control, and pausing when hidden or offscreen. Under reduced motion and static modes, every one of them gives way to this still composition. Motion keys on the runtime's state, never on `data-motion` alone.

## Section coverage map

| Kind         | Treatment | Notes                                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------------------- |
| `hero`       | bespoke   | The orbital opening: the shared hero's words in front of a still orbit.               |
| `evidence`   | bespoke   | Each record a disclosure, its face the owner's own name or figure, the record inside. |
| `chronology` | bespoke   | One ordered list, each entry in its thread's lane through `threadLanes`.              |
| every other  | shared    | The kit's shared renderers, inside the composition's spacing.                         |

## Controls and content slots

N/A: the first pull request has no owner-tunable choice and no slot. The orbit's profile count and the content slots are in the backlog.

## Kit usage map

- `@portfolio/kit/sections`: `renderSection`, `SHARED_RENDERERS`, `EvidenceEntry`, `ChronologyItem`, `SectionHeader`, `renderContext`, `evidenceOf`, `chronologyOf`, `recordAnchor`, `formatFigure`, `present`, `RichText`, `VisitorControlSlot`.
- `@portfolio/kit/timeline`: `threadLanes` and `laneCount`, hoisted for this package: lanes from authored threads, tested on their own.
- `@portfolio/appearance/primitives`: `Dialog` for the menu and `Disclosure` for evidence; `@portfolio/appearance/react`: `useBoundary`, so the menu link attaches no listener in a plate.
- Kit fixes this port needed: `AnimatedCounter` renders the real value on the server, and `TypingAnimation` no longer announces through a polite live region.

## Performance tier

`medium`, the catalog's pin. The still composition ships no canvas and almost no JavaScript of its own: the menu's link handler. Its declared budgets are what `pnpm check:budgets` measured, with room for the motion layer to declare its own.

## Accessibility

- Focus order: the boundary's skip link, the section links or the menu button, the visitor control, then the main in reading order.
- The menu is a native modal dialog: named by its title, Escape closes it, focus stays inside, and focus goes back to the button. Scrolling stops in CSS, never through `document.body`.
- Evidence disclosures are native: the summary is the accessible name and says whether it's open, focus stays on it, and no heading sits inside it.
- The chronology's DOM order is its visual order on every screen, so Tab follows reading order. Nothing is positioned off its axis or clipped.
- Decoration is hidden from assistive technology. The host's two words, Sections and Close, carry `lang="en"` in a portfolio in another language.

## Appearance boundary

Color, type, materials, radius, shadow, and timing are #19's tokens. The one signature is the design language's signature fill, `var(--ui-signature-fill)`, on the orbit's core alone: no gradient text, no glass, no gradient section titles. Under high contrast and forced colors the platform stylesheet already makes the fill solid. The composition never overrides a visitor's appearance selection.

# Port-only sections

## Component inventory

| v1 piece                                                | What it did                                               | Plan                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `variant.tsx`                                           | Root, theme toggle, background, nav                       | The composition; the theme toggle is retired to #19.                 |
| `primitives/navigation.tsx`                             | Sliding nav, body scroll lock, eight-item cap             | The chrome: a bar and #19's Dialog, no lock, no cap.                 |
| `renderers/hero.tsx`                                    | Typing roles, gradient name, hidden entrance              | The orbital opening, still, on the shared hero.                      |
| `renderers/experience.tsx`                              | SVG fork/merge timeline with `foreignObject` cards        | One ordered list in authored lanes; no SVG cards.                    |
| `lib/timeline-events.ts`                                | Keyword lane classifier                                   | Retired: `threadLanes` reads the authored threads.                   |
| `renderers/projects.tsx`                                | Filterable cards that expand on click                     | The shared works renderer; expansion is the motion PR's and backlog. |
| v2 kinds (`talks`, `stats`, `press`, `testimonials`, …) | One renderer per kind                                     | Evidence records, through the evidence objects.                      |
| `renderers/github.tsx`                                  | `fetchGitHubData` during render                           | The shared github renderer, from #10's snapshot.                     |
| `primitives/floating-profile-cluster.tsx`               | Draggable brand cards                                     | The motion PR and the backlog's orbital opening rules.               |
| `primitives/animated-background.tsx`                    | Unpaused glyph canvas                                     | The motion PR, on #6's runtime.                                      |
| `primitives/markdown-body.tsx`, `action-link.tsx`       | Local markdown and links                                  | #5's `RichText` with #10's sanitizer, and the kit's link pieces.     |
| `styles.css`                                            | 2,838 lines: 536 `--kc-*`, 123 hex, a Google Fonts import | A layout stylesheet on #19's tokens, none of those left.             |

## Signature interactions

- The orbit around the opening: still here, moving in the motion PR.
- Evidence objects that open: disclosures here; tilt and glow are the backlog's.
- The forking timeline: authored lanes and fork and join markers here.
- Falling glyphs, drag, and the receding chrome: the motion PR.

## Data-shape diff

v1 rendered v2's section kinds; v3 holds records. Experience and education become chronology entries, projects become works, and talks, awards, press, publications, patents, stats, and testimonials become evidence by type. Lanes come from `thread`, `branchesFrom`, and `mergesInto`, never from words. Nothing the scope keeps is lost.

## Fidelity targets

- [x] An orbital opening around one luminous signature.
- [x] Evidence as objects that open in place.
- [x] A chronology that branches on large screens and is vertical on small ones.
- [ ] The glyph field, orbit motion, and receding chrome: #14's second pull request.
