import { composePages } from '@portfolio/kit/sections';
import { CaseStudyPage } from './case';
import { HomePage, SECTIONS } from './home';

// Spatial Bento (#16; the redesign's stream E): the portfolio as one
// composed field of tiles, every tile a different kind of object, and the
// page's own index a tile in it, an isometric plane of each board. It owns
// its navigation, its section frames, a renderer for every kind, its
// footer, and a work's own page, all through composePages(). Color, type,
// materials, and timing are the appearance packs' (#19); space, type steps,
// and durations are the shared scales'. A server module but for the stage,
// the dock, and the menu's dialog, so the page reads the same with or
// without JavaScript, in print, and in a plate. A hidden section never
// reaches it.

/** The composition the outline check reads: its renderers and its frame. */
export const sections = SECTIONS;

export default composePages({ HomePage, CaseStudyPage });
