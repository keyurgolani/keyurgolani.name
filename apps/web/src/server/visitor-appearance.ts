import 'server-only';
import { cookies } from 'next/headers';
import type { Site } from '@portfolio/schema';
import type { ResolvedAppearance, SelectionText } from '@portfolio/appearance';
import { APPEARANCE_COOKIE, documentAppearance } from '~/lib/document-appearance';
import { requireDeploymentConfig } from './config-store';

// A visitor page's appearance (#19, Slice 4): the site's, with the visitor's
// own values on the axes it lets them choose, from the preference cookie
// POST /api/appearance sets under owner and read-only, and from the query
// under demo, never the other. Every page that reads it is rendered per
// request, and proxy.ts marks its answer private and varying with Cookie.

/**
 * The request's preference cookie. A test outside a request, where Next has
 * no cookies to give, replaces `read` with node:test's mock.method().
 */
export const preferenceCookie = {
  async read(): Promise<string | null> {
    return (await cookies()).get(APPEARANCE_COOKIE)?.value ?? null;
  },
};

/** The document boundary's appearance for a visitor page showing `site`, rendered by `variant`. */
export async function visitorPageAppearance(
  site: Pick<Site, 'appearance' | 'visitorControls' | 'motionPolicy'> | null,
  variant: string,
  query?: SelectionText,
): Promise<ResolvedAppearance> {
  const { profile } = requireDeploymentConfig();
  if (profile === 'demo') {
    return documentAppearance({ site, variant, profile, ...(query ? { query } : {}) });
  }
  const cookie = await preferenceCookie.read();
  return documentAppearance({ site, variant, profile, cookie });
}
