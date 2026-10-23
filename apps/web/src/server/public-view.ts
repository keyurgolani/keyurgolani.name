import 'server-only';
import { resolvePortfolioView, type PublicView } from '@portfolio/schema';
import { CONTENT_EXTENSIONS } from '~/lib/variants';
import { getLive } from './catalog';
import type { PublicationUnit } from './catalog-port';
import { liveMediaDocument } from './live-media';

// What visitors may see of the live revision (#10, item 5): the published
// view, the only input to the page, its metadata and JSON-LD, the feed, and
// the Open Graph image. Hidden sections, private records, what nothing
// visible reaches, and unregistered extension data never reach them. Media
// renditions serve under /media. It reads the request's own live revision,
// so every part of one response shows the same one.

/** Where the published view's renditions serve. */
export const MEDIA_BASE = '/media';

// By unit, then by the media document it shows, which for read-only and
// demo arrives once startup derivation finishes.
const views = new WeakMap<
  PublicationUnit,
  { readonly media: unknown; readonly view: PublicView }
>();

/** Thrown while nothing is servable, which proxy.ts answers visitors with a 503 for. */
const NOTHING_SERVABLE = 'Nothing published can be served.';

export async function getPublicView(): Promise<PublicView> {
  const { unit } = await getLive();
  if (!unit) throw new Error(NOTHING_SERVABLE);
  return publicViewOf(unit);
}

/**
 * `unit`'s public view, built once per unit and media document. The
 * composition root's reader reads its case-study slugs from it (#10b), so
 * the slugs /work serves and the page it renders come from one view.
 */
export function publicViewOf(unit: PublicationUnit): PublicView {
  const media = liveMediaDocument(unit);
  const cached = views.get(unit);
  if (cached && cached.media === media) return cached.view;
  const view = resolvePortfolioView(
    unit,
    { media, snapshots: unit.snapshots },
    { mediaBase: MEDIA_BASE, extensions: CONTENT_EXTENSIONS },
  );
  views.set(unit, { media, view });
  return view;
}
