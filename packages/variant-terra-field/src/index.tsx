import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case-study';
import { HomePage } from './home';

// Terra Field (variants-10 brief §5.5): the field-and-arc document. The
// masthead and the hero sit on one field of the scheme's accent whose
// lower edge is a wide arc, with the hero's one proof as a seal on the
// arc's lowest point; one photograph and two captioned plates anchor the
// band under it; the five destinations each open on their own field on the
// page's axis, with a short index; every work follows one series template,
// lists are ruled on paper, and the page closes on a second field whose arc
// rises.
//
// It renders on the server from the render input alone: no fetch, no
// clock. Its colour, type, materials and timing are #19's tokens; the
// field's geometry, the arc, the seal, the axial masthead, the band, the
// field heads and the choreography are its own. A work's own page is its
// own too (routes.work: bespoke): the short field the cover overlaps, the
// ruled fact sheet, and the account under horizon-line heads.

export default composePages({ HomePage, CaseStudyPage });
