# DESIGN.md: variant-kinetic-cosmos

> The redesign (stream E, 2026-10-25) replaces #14's still composition. Its target is the concept in `_execution/artifacts/kgn-redesign-audit/concepts/kinetic-cosmos/` (`concept.json` and the round-2 mockups), judged against the redesign dossier. #14's safety, accessibility, and motion rules still hold. This file says how the package meets it.

## Composition idea

The portfolio as an orrery. **Signature: the orbital navigator.**

One inset stage opens the page, on the scheme's inverse pair. Its top row is the name, the hero's line about the practice, and an Index. Below it the system is drawn as an orrery: four tilted rings, Work, Writing, Record, and Personal, turn slowly around one luminous core, the design language's signature fill, and each ring has a plate, a real link with a count of what it holds, wired to its body by a leader line. The thesis's first sentence is the page's h1 at display size, its last word stepped in to the fourth column; the rest of the thesis is the standfirst, with the hero's actions under it. A band with registration marks closes the stage: what the owner is doing now, where they are, and the pause for the orbits.

Each ring follows as a chapter. It opens on a full-bleed orbit line, flatter for each ring further out, that carries the ring's section links, then the ring's name and what it holds. Each section in it opens on an orbit rule: a body on the line, the title, a hairline, and a count. A closing stage mirrors the opening with the ways out on their own orbits. A dock, low on the screen once the stage has gone by, says which ring you're in, and the Index lists every section on its ring.

## Manifest summary

| Field                      | Value                                                     |
| -------------------------- | --------------------------------------------------------- |
| `id` / `name`              | `kinetic-cosmos` / `Kinetic Cosmos`                       |
| `compositionFamily`        | `kinetic`                                                 |
| `motionIntent`             | `kinetic` (the catalog's pin)                             |
| `performanceTier`          | `medium` (the catalog's pin)                              |
| `renderedKinds`            | every core kind, each bespoke                             |
| `unsupportedKinds`         | none                                                      |
| `routes`                   | home bespoke through `composePages`; work shared until P2 |
| `visitorControl.placement` | `header`, in the masthead                                 |
| `textDirection`            | `ltr`, `rtl`                                              |
| `budgets`                  | css 12288, js 8192, animation 3: inside the medium tier   |

## Grouping (`src/model.ts`)

Every section `pageOutline()` lists has one place:

- **Opening:** the hero and the first thesis.
- **Work:** works sections of software, interfaces, systems, and objects; the github section; services.
- **Writing:** works that are all writing, research, or episodes; evidence that is all talks, publications, press, or recordings.
- **Record:** a lede; figures, testimonials, awards, and patents; chronologies; skills and tools.
- **Personal:** now, focus, fun facts, quotes, custom sections, photo series and releases, work kept elsewhere.
- **Closing:** the contact section and any call to action.

Inside a ring, sections run in a fixed order of what they are (`rankOf()`), the owner's order kept within each rank. Two compact neighbours (a lede and figures, awards and patents, skills and tools, now and focus) share a row. When the kit's `navigationModel()` lands, `placementOf()` becomes its `destinationOf`.

## Grid, space, type, color, motion

- **Grid:** 12 columns, the gutter `--space-s`, the margin `--space-s-l`, the page `81rem`. The stages are inset by `--space-s` (`--space-2xs` on a phone) and pad their content onto the page's column lines.
- **Space:** the platform's `--space-*` steps only. The section ladder is `--space-xl-3xl` before a ring, `--space-2xl` between sections, `--space-xl` and `--space-m` inside them.
- **Type:** a contrast regime: the h1 on `--type-step-7` (6rem at the wide end), ring names on step 5, titles on step 3 and step 1, body on the typography role. Families and weights are the roles'.
- **Color:** roles only. The stages are the inverse pair (`--color-text-primary` ground, `--color-text-inverse` ink), with a quieter ink and hairlines mixed from the two in oklab. The core is `--ui-signature-fill`, once per stage.
- **Motion:** the house curve is expo-out, feedback 200 ms, scene 800 ms, read as `--motion-*`. Exactly three endless animations, only inside `prefers-reduced-motion: no-preference`, only while the stage's runtime is active (`data-runtime`), and never under the boundary's `reduced` or `static`: the inner orbit plane, the outer one, and the far stars. The runtime pauses them when the document is hidden, the stage is offscreen, or the visitor pauses; hovering the orrery or focusing a plate holds them too. Under reduced motion the page is the complete still the server drew.

## Navigation

- **Persistent:** the masthead holds the name and the Index; the plates hold the four rings. After the stage, the dock holds the rings and Contact (five destinations) and the Index. The dock is hidden, out of the tab order, while the stage is in view.
- **Index:** a native modal dialog, "The system": every titled section, grouped by ring, with counts. Escape closes it and the browser gives focus back to the trigger; following a link closes it first.
- **Depth:** each ring's orbit line carries its section links, which wrap under it on narrow screens.

## Islands

`stage.tsx` (the stage's runtime and the pause), `dock.tsx` (two IntersectionObservers, no scroll listener), and `system-index.tsx` (the dialog's triggers and links). Everything else is server markup.

## Accessibility and fallbacks

One h1, the masthead, main, the dock's nav, and the footer; ordered headings (h1, ring h2, section h3, item h4). The orrery, the orbit lines, and every mark are `aria-hidden`; every fact they stand for is a link or text beside them. With no JavaScript the page is complete: the Index opens through invoker commands where the browser has them. Forced colors drop the stars and the core and keep the stages' edges; print drops the decoration and the dock.

## Departures from the concept (phase 1)

- The work page stays the host's until P2 (`routes.work: shared`).
- The h1's glyph rise and the rings' one-time draw are left for P2; the page has one moving thing, the orrery.
- Talks open as objects with links, not dialogs, until P2.
- The dock has no pause of its own: nothing moves while it shows, since the orbits pause offscreen.
