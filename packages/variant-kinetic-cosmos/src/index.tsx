import { composePages, type SectionComposition } from '@portfolio/kit/sections';
import { OpeningFrame } from './frames';
import { HomePage } from './home';
import { CaseStudyPage } from './work-page';
import { RENDERERS } from './renderers';

// Kinetic Cosmos (#14, redesigned in stream E): the portfolio as an orrery.
// Its home page is the opening stage, four rings of chapters, and a closing
// stage, with its own navigation, frames, and renderer for every kind. It
// owns composition alone: color, type, materials, and timing are the
// appearance packs' (#19), and its one signature is the design language's
// signature fill, on the orrery's core. It renders from its input alone,
// and only what the input holds: a hidden section never reaches it.

/** The composition the outline check reads: its renderers, and frames that take each section's own id. */
export const sections: SectionComposition = { renderers: RENDERERS, Frame: OpeningFrame };

export default composePages({ HomePage, CaseStudyPage });
