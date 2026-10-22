import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { renderComposition } from '~/lib/render-composition';
import { resolveVisitorPath, type VisitorPath } from '~/lib/visitor-routes';
import { requireDeploymentConfig } from './config-store';
import { getPublicView } from './public-view';

// Every visitor page renders through here (#5, Slice 4): the composition
// with its route, a 307 to the canonical route of a view only another
// installed variant declares, or the 404 page.

export async function visitorPage(path: VisitorPath) {
  const route = await resolveVisitorPath(path, getPublicView);
  if (route.kind === 'not-found') notFound();
  // From a page, before anything streams, redirect() answers 307.
  if (route.kind === 'redirect') redirect(route.location);
  return renderComposition({
    view: route.view,
    composition: route.composition,
    route: route.target,
    basePath: path.basePath,
    query: path.query,
    origin: requireDeploymentConfig().origin,
    canonical: route.canonical,
  });
}
