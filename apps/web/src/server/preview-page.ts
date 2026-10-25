import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { AppearanceStylesheets, ResolvedAppearance } from '@portfolio/appearance';
import { documentAppearance, type DocumentAppearanceInput } from '~/lib/document-appearance';
import { ExperienceDocument } from '~/lib/experience-document';
import { ClientHostModules } from '~/lib/host-modules-client';
import { variantLoader } from '~/lib/variant-loaders';
import { resolveVisitorPath } from '~/lib/visitor-routes';
import { getDeploymentState, requireDeploymentConfig } from './config-store';
import { previewStylesheets } from './generated-schemes';
import type { GrantChannel, OpenedGrant } from './preview-port';
import { requestNonce } from './request-nonce';

// What a grant path renders (#7, Slice 2). proxy.ts has already checked the
// grant, from the path alone, and let only an iframe document load, or an
// asset load of the right destination, through. The page checks it again
// as it reads what the grant renders, through the port the owner
// composition binds: under demo and read-only there's none, and no grant
// path is served. Nothing here reads a cookie, and of the request's headers
// only the Content-Security-Policy proxy.ts set, for the nonce the variant's
// stylesheet needs (server/request-nonce.ts), as Next reads it for its own.

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
 * What an active grant's agent opens its channel with (Slice 3), checked
 * without reading what the grant renders, for a frame whose content fails
 * to render. Null when the grant isn't active, or can't be checked.
 */
export const grantChannel = cache(async (grant: string): Promise<GrantChannel | null> => {
  const previews = getDeploymentState()?.previews;
  return previews ? previews.channel(grant).catch(() => null) : null;
});

/**
 * What a frame's document boundary renders for `grant`: the grant's
 * environment, so the frame's first paint is right (Slice 4), through #19's
 * resolver, what Studio asked for and never a visitor's value, with the
 * generated schemes its subject stored (#20 PR 3), and their stylesheets
 * under the grant, never /_portfolio/scheme/.
 */
export function frameAppearance(
  grant: string,
  opened: Pick<OpenedGrant, 'environment' | 'schemes'>,
  site: DocumentAppearanceInput['site'],
  variant: string,
): { readonly appearance: ResolvedAppearance; readonly stylesheets: AppearanceStylesheets } {
  return {
    appearance: documentAppearance({
      site,
      variant,
      profile: requireDeploymentConfig().profile,
      environment: opened.environment,
      schemes: opened.schemes,
    }),
    stylesheets: previewStylesheets(grant, opened.schemes),
  };
}

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
    // A draft can select any registered variant, so a frame loads the one it
    // renders through every variant's loader: frames are owner-only (#6).
    load: variantLoader(resolved.composition.rendered.manifest.id),
    hostModules: ClientHostModules,
    ...frameAppearance(
      grant,
      opened,
      resolved.view.site,
      resolved.composition.rendered.manifest.id,
    ),
    linkBase: { basePath },
    route: resolved.target,
    origin: requireDeploymentConfig().origin,
    nonce: await requestNonce(),
  });
}
