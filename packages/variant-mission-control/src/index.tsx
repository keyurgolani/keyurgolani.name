import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case-study';
import { HomePage } from './home';

// Mission Control (variants-10 brief §5.8): the portfolio as an operations
// wall. A 52 px board rail and a status line frame one measured 16-column
// wall of uniform panels, each with a title bar, a body and its count; the
// lamps (a dot and a word, always) report state only from fields that
// exist. The first view is the monoscale anchor panel, the name at title
// size and the thesis's first sentence at lede size, beside square readout
// modules, whose numerals are the largest type on the page (MC-M1 to M3).
// Pointing at or pinning a record lights the records it names (correlate,
// MC-M4); the full record waits behind closed panels at each board's end.
//
// It renders on the server from the render input alone: no fetch, no
// clock. A work's own page is its own too (routes.work: bespoke): one
// board, its title the h1, the brief beside the inspector, the case's parts
// as panels with the decisions as a numbered log, and the way on.

export default composePages({ HomePage, CaseStudyPage });

// Row 44 evidence only, drop before landing: this line makes quality:pr change-direct Mission Control, so its
// 1440 default cells take the reload conditions on the evidence PR.
