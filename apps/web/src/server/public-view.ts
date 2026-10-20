import 'server-only';
import { toPublicView, type PublicView } from '@portfolio/schema';
import { getLive } from './catalog';
import type { PublicationUnit } from './catalog-port';
import { CONTENT_EXTENSIONS } from './content-extensions';

// What visitors may see of the live revision (#4, item 16): the only input
// to the page, its metadata and JSON-LD, the feed, and the Open Graph image.
// Hidden sections and unregistered extension data never reach them.

const views = new WeakMap<PublicationUnit, PublicView>();

export async function getPublicView(): Promise<PublicView> {
  const { unit } = await getLive();
  let view = views.get(unit);
  if (!view) {
    view = toPublicView(unit, { extensions: CONTENT_EXTENSIONS });
    views.set(unit, view);
  }
  return view;
}
