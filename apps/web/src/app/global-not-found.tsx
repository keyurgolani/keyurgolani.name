import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDeploymentConfig } from '~/server/config-store';
import { NotFoundDocument } from './_chrome/not-found-document';
// The site's 404 renders inside its presentation boundary, so it gets the
// stylesheets the site's layout imports, and never host chrome (#7).
import '~/lib/experience-styles';

// A URL no route matches (#2). The site and Studio each have their own root
// layout, so there is none to compose a 404 from: this page brings its own
// document (_chrome/not-found-document.tsx). A page that calls notFound()
// gets its group's not-found.tsx.

// Rendered per request, like every page, so its links follow the profile
// register() loaded, never the build's.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // The site's origin, as the site's layout gives it, for any URL the page's
  // metadata resolves. Before startup there is none to give.
  const origin = getDeploymentConfig()?.origin;
  return { title: 'Page not found', ...(origin ? { metadataBase: new URL(origin) } : {}) };
}

export default async function GlobalNotFound() {
  // The nonce of the request's Content-Security-Policy, which proxy.ts sets on a Studio path.
  const policy = (await headers()).get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  return NotFoundDocument({ nonce });
}
