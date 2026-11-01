import { composePages } from '@portfolio/kit/sections';
import { HomePage } from './home';
import { CaseStudyPage } from './work-page';

// Editorial Evidence (#13), the platform's default composition, redesigned
// as a long-form issue (stream C): the thesis at display size over the
// issue's contents, the signature work on Pl. 1 with its notes, chapters
// whose section heads hang in a head column beside a 1 px spine, notes and
// evidence in the notes column beside what they support, and a colophon.
// Each work with a case study has a page of its own.
//
// It renders on the server from the render input alone: no fetch, no
// clock. Two small client islands enhance what is already there, the
// running head (scroll-spy.tsx) and the Contents sheet's popover
// (sheet-control.tsx); with no JavaScript the page, its links and the
// sheet all still work, and a print reads the same. Motion is state
// feedback and one scroll-linked rule, only under full motion. Its color,
// type, materials, and timing are #19's tokens, and its space, steps, and
// grid the platform's shared scales. Inside a catalog plate the host's
// boundary makes it inert.

export default composePages({ HomePage, CaseStudyPage });
