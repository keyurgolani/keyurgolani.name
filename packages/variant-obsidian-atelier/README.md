# Obsidian Atelier

`@portfolio/variant-obsidian-atelier` (#15) hangs a portfolio as an exhibition: an entrance, a room for each work the owner curates, a salon wall for the rest of the collection, Practice and Record as rooms of their own, and Contact. Every work has a catalogue number, and the footer is the exhibition's plan.

It owns composition alone. Its colors are the selected color scheme's, through #19's tokens, so it never forces a display mode, and a light scheme or high contrast gives the same rooms in those colors. The light pool on the entrance wall is the scheme's `--color-surface-lit`, which is the canvas in high contrast, so there it isn't drawn.

## What the home page holds

1. The chrome: the name, the room switch, the running head ("Room II", "Practice"), and Index, a native dialog with the whole plan.
2. The entrance: one symmetric room. The signature work hangs on a deep square mat on the page's axis, with its wall label pinned to its bottom-left. The thesis is the room's title on the floor below it, and the floor's front edge says where the owner is, with the way on to Room I. The rest of the thesis, the hero's words, and its links follow on the canvas.
3. The rooms, one for each curated work: the signature, then the featured works, in the owner's order. Each room has a head ("Room II of V"), the work mounted for its medium, a wall label numbered "No. n of 11", and one next link. An essay is one title-page plate on its wall, its label beside it.
4. The collection: one salon wall with a bay for each works section. The home hangs six works at most, the rooms' included (the home outline). The wall hangs what the rooms leave of those six, one piece per bay in turn, each mounted for its medium. Every other piece is in its bay's checklist, a closed disclosure. A work the rooms already hold isn't hung twice; the bay says which rooms it's in.
5. Practice and Record, hung as halls. Each has a wall, a floor line, a plaque, and a sticky running head, then one summary: Practice's words, and the record's At a glance, in sentences across the wall. The rest is closed behind one disclosure, "The whole practice" or "The whole record". There, Practice's lists stand in a vitrine, the experience is a catalogue checklist in a vitrine, and quotes are framed inscriptions.
6. Contact, and the last word on its exit wall, with the call to work together as that wall's label.
7. The colophon: the plan in wings (the entrance and the rooms, the collection, the halls, Contact), then one line with the name, "A catalogue of 11 works in 3 rooms", and the way back to the entrance.

The published view holds visible content only, so a private work, or one only a hidden section reaches, is never a room, a number, or a neighbour.

## The case page

`routes.work` is `bespoke`. `/work/<slug>` is composed through `composePages` from the kit's case-study outline:

- The installation view comes first: the work on the entrance's mat, with a museum label in caption-size prose (plate, title, since, medium, role, tools, award, links). Then the room title and the premise.
- The case bar: the case's own index, its stops named by plate.
- The case's parts as run-in paragraphs ("The challenge.", "Two decisions.", "The evidence.", "What changed."). Each part's plate, notes, or highlights hang beside it, and a part with nothing beside it joins its neighbour's group.
- The reflection wall, then the sources and the next room.

## Media

No artifact is upscaled. The entrance and the installation contain the work on a square mat, so nothing is cropped. Prints are framed on a mat and numbered as plates of their work. Alt text, captions, credits, and rights are the owner's, from #10's media model, and sit below the image, never over it. An image that isn't there yet keeps its box and says so. Mark decoration `decorative: true`; a room never hangs it.

## Client code

Under the budget, `client/here.tsx`:

- keeps the running head on the place in view;
- marks the current stop in the case bar;
- past five windows, keeps the running head as a plate beside Index (on a case page the case bar is the marker);
- opens a fold, lands, and moves focus when a fragment points inside it, on arrival, on hashchange, and from the plan;
- keeps a focused control clear of the fixed and sticky boxes, Tab or Shift+Tab.

Everything works without it: every room, stop, and plan entry is a fragment link, and every fold is a native `details`, which print opens.

## Checks

`pnpm --filter @portfolio/variant-obsidian-atelier test` renders every contract fixture through the outline check, the halls, the plan's wings, the exit label, the case page's anatomy, the floor's contrast in every scheme, and the stylesheet's rules. `pnpm check:variants` and `pnpm check:appearance` audit it. `tests/e2e/obsidian-*.spec.ts` covers:

- the case bar;
- dead space at 1440 and 390;
- no sideways scroll at 320;
- the position marker;
- a first load at a fragment inside a closed fold.
