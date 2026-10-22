import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { ExperienceDocument } from '~/lib/experience-document';
import { resolveVisitorPath } from '~/lib/visitor-routes';
import { PREVIEW_STATUS, PREVIEW_STATUS_DOCUMENT, PREVIEW_STATUS_TYPE } from '~/preview/status';
import { getDeploymentState, requireDeploymentConfig } from './config-store';
import type { OpenedGrant } from './preview-port';

// What a grant path renders (#7, Slice 2). proxy.ts has already checked the
// grant, from the path alone, and let only an iframe document load, or an
// asset load of the right destination, through. The page checks it again
// as it reads what the grant renders, through the port the owner
// composition binds: under demo and read-only there's none, and no grant
// path is served. Nothing here reads a cookie or a request header.

/**
 * The grant's document, checked and read once per request, so the layout,
 * its metadata, and the page see the same answer. Null when the grant isn't
 * active; it rejects when an active grant's content doesn't render.
 */
export const openGrant = cache(async (grant: string): Promise<OpenedGrant | null> => {
  const previews = getDeploymentState()?.previews;
  return previews ? previews.open(grant) : null;
});

/**
 * The frame's page: the portfolio at `route` inside the grant's link base,
 * exactly as a visitor would get it there. A grant that ended since proxy.ts
 * checked it renders nothing of its content: the 404 boundary answers.
 */
export async function previewPage(grant: string, route: readonly string[]) {
  const opened = await openGrant(grant);
  if (!opened) notFound();
  const basePath = `/preview/${grant}` as const;
  const resolved = await resolveVisitorPath({ segments: route, basePath }, async () => opened.view);
  if (resolved.kind === 'not-found') notFound();
  // To the view's canonical route, under the same grant.
  if (resolved.kind === 'redirect') redirect(resolved.location);
  return ExperienceDocument({
    unit: resolved.view,
    selection: resolved.composition,
    linkBase: { basePath },
    route: resolved.target,
    origin: requireDeploymentConfig().origin,
  });
}

/**
 * A draft-only asset (Slice 2, item 7). Until #10 adds the rendition lookup
 * behind the same check, every one is the status document.
 */
export async function previewAsset(): Promise<Response> {
  return new Response(PREVIEW_STATUS_DOCUMENT, {
    status: PREVIEW_STATUS,
    headers: { 'content-type': PREVIEW_STATUS_TYPE, 'cache-control': 'private, no-store' },
  });
}
