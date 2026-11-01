import { composePages } from '@portfolio/kit/sections';
import { HomePage } from './home';
import { CaseStudyPage } from './work-page';

// Obsidian Atelier (redesign, stream C): a private viewing. Each work
// hangs alone on a wall with its wall label and catalogue number, the
// walls alternating with the canvas the reading is on; the rest of the
// collection is one salon wall hung by section, and the index is a plan of
// the exhibition. Its colors, type, and materials are the selected packs';
// it owns the composition alone, so in a light scheme, a dark one, and high
// contrast it's the same rooms in their colors.
//
// It owns both its pages through composePages(): the home page, and a
// work's own page, /work/<slug>, the case hung as a room of its own
// (work-page.tsx). The manifest's routes.work is bespoke.

export default composePages({ HomePage, CaseStudyPage });
