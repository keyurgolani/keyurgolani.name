# Obsidian Atelier

`@portfolio/variant-obsidian-atelier` (#15) is a night gallery of chapters: one chapter a work, each a full-bleed room for its artifact beside a narrow analytical column, and the rest of its case one disclosure away.

It owns composition alone. The mineral dark and the oxidized accents are the selected color scheme's, through #19's tokens, so it never forces a display mode, and a light scheme or high contrast gives the same rooms in those colors.

## What the home page holds

1. The chrome: the name, which goes home, a link to the index, and the visitor control.
2. The opening: the leading hero section, or the identity's name and tagline. It holds the page's one `h1`.
3. The index: every chapter by its number, title, and medium, then the other titled sections the page shows. It's #19's `Navigation`, in flow.
4. The chapters: the signature work, then the featured works, in the owner's order. With neither curated, the works the reading order's works sections show, in that order, without the archive's. A works section the chapters show whole keeps its id, on the first chapter, so a link to it still lands.
5. The rest of the reading order, through the kit's shared renderers, without the works the chapters show.

The published view holds visible content only, so a private work, or one only a hidden section reaches, is never a chapter, a number, or a neighbor.

## A room

Each room says where it is ("Chapter 2 of 5") and its medium, then the work's title, role, organization, and summary, in a `Surface`. Its artifact is the cover, else the work's first image, and how it shows follows the authored `medium` alone:

| Medium                           | Room                                       |
| -------------------------------- | ------------------------------------------ |
| `photography`, `image-series`    | a plate across the room, below the premise |
| `interface`                      | a screen on a matte, beside the premise    |
| `system`, `software`, `research` | a diagram on a matte, beside the premise   |
| `writing`                        | its own excerpt, at a reading measure      |
| anything else, extensions too    | an object on a matte                       |

No artifact is cropped or upscaled: each keeps its own aspect, no wider than its pixels or the room and no taller than 80% of the window, so portraits, panoramas, transparent images, pages of text, and small images read whole. Its alt text, caption, credit, and rights are the owner's, from #10's media model, and sit below it, never over it. An image that isn't there yet keeps its box and says so; a work with no artifact is a text room with no empty frame.

**Unfold the case** is a native `details`, closed on the server. It holds the work's description, its highlights, tools, and tags, its case study's fields under their fixed labels, the rest of its media, its evidence, and its links. A room with nothing more has no disclosure. Each room ends with plain previous, index, and next links.

## What it doesn't do

- No client code: no effect, no listener, no fetch, no clock. Every chapter, its index, and its neighbors are fragment links, so they work without JavaScript, without hover or a pointer, and under reduced motion.
- No transition, animation, smooth scrolling, tilt, or parallax.
- Nothing from `legacy/`, and none of the kit's `TypingAnimation`, `useMouseTilt`, or `MagneticCursor`.
- No work page of its own: `routes.work` is `shared`, so `/work/<slug>` is the host's.

## Media guidance

Give every meaningful image alt text, and mark decoration `decorative: true`, which renders nothing until it's there and an empty alt once it is. A caption shows under the image at a compact measure, however long. Set a cover on each chapter's work for its room to lead with it; without one, the first image the work places leads.

## Checks

`pnpm --filter @portfolio/variant-obsidian-atelier test` renders every contract fixture and checks the manifest's pins, the chapters and their numbering, the index and the previous and next links, Unfold the case, the medium treatments, missing and extreme media, the plate, the mount, and the stylesheet's rules. `pnpm check:variants` and `pnpm check:appearance` audit it, and CI's variant specs and quality cells run it in every mode.
