import 'server-only';
import { resolvePortfolioView, type PublicView } from '@portfolio/schema';
import { CONTENT_EXTENSIONS } from '~/lib/variants';
import { getLive } from './catalog';
import type { PublicationUnit } from './catalog-port';

// What visitors may see of the live revision (#10, item 5): the published
// view, the only input to the page, its metadata and JSON-LD, the feed, and
// the Open Graph image. Hidden sections, private records, what nothing
// visible reaches, and unregistered extension data never reach them. Media
// renditions serve under /media.

/** Where the published view's renditions serve. */
export const MEDIA_BASE = '/media';

const views = new WeakMap<PublicationUnit, PublicView>();

export async function getPublicView(): Promise<PublicView> {
  const { unit } = await getLive();
  let view = views.get(unit);
  if (!view) {
    view = resolvePortfolioView(
      unit,
      { media: unit.media, snapshots: unit.snapshots },
      { mediaBase: MEDIA_BASE, extensions: CONTENT_EXTENSIONS },
    );
    views.set(unit, view);
  }
  return view;
}
