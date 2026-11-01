import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case-study';
import { HomePage } from './home';

// Shell (variants-10 brief §5.6): the portfolio as one open terminal
// session. Home is the transcript; a work's own page, /work/<slug>
// (routes.work: bespoke), is its case study as a man(1) page read in the
// same session (case-study.tsx).

const Shell = composePages({ HomePage, CaseStudyPage });

export default Shell;
