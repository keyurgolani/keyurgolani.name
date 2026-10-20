import 'server-only';
import { toPublicView, type Portfolio, type PublicView } from '@portfolio/schema';
import { getLive } from './catalog';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { HOST_SITE } from './host-defaults';

// What visitors may see of the live revision (#4, item 16): the only input
// to the page, its metadata and JSON-LD, the feed, and the Open Graph image.
// Hidden sections and unregistered extension data never reach them.

const views = new WeakMap<Portfolio, PublicView>();

export async function getPublicView(): Promise<PublicView> {
  const { portfolio } = (await getLive()).unit;
  let view = views.get(portfolio);
  if (!view) {
    view = toPublicView({ portfolio, site: HOST_SITE }, { extensions: CONTENT_EXTENSIONS });
    views.set(portfolio, view);
  }
  return view;
}
