import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case-study';
import { HomePage } from './home';

// Raw Grid (variants-10 brief §5.3): the portfolio as an exposed-structure
// poster wall. One gutterless twelve-column field, every boundary a single
// drawn rule because cells share their edges; a proof ticker across the
// top with its Pause; a header row of cells (the name, five destinations
// with their counts, where you are, the Index); a pasted-up poster opening
// beside the thesis and the pinned work; five destination sheets of
// butt-jointed cells with black-tape heads; sticker cards that press into
// their shadows; and an ink block whose biggest link is the email.
//
// It renders on the server from the render input alone: no fetch, no
// clock. One small client module enhances what's already there (the
// ticker, the Index over the page, where you are, the paste-up); without
// it the page, its links and its index all still work, and print reads
// the same. Its color, type, materials, and timing are #19's tokens; the
// grid as geometry (zero radius on cells, the cell rules, zero gutters,
// the tilts and the name fit) is its own. It owns a work's own page too,
// /work/<slug> (routes.work: bespoke): the case pasted up as a poster of
// its own on the same field (case-study.tsx).

export default composePages({ HomePage, CaseStudyPage });
