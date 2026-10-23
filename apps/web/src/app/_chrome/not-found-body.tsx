import Link from 'next/link';
import type { Site } from '@portfolio/schema';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { PresentationBoundary } from '~/lib/experience-document';
import { compositionFor, REGISTRY } from '~/lib/variants';
import { getDeploymentState } from '~/server/config-store';
import { getLive } from '~/server/live-revision';
import { capabilityPolicy, type NavLink } from '~/server/policy';

// What every 404 shows, inside the site's layout or the global 404 page's
// own document. It links only to pages the profile serves, from
// CapabilityPolicy, and reads no session, so it lists the public ones. It
// renders inside the live site's presentation boundary (#5, Slice 3, item
// 6), so #19's tokens reach it once they ship. It reads only the site's
// presentation settings, and shows nothing about the request or the
// documents. Its links don't prefetch: under a preview path the page has
// the preview's CSP, whose connect-src lets no request through (#7).
//
// Under a visitor page, it's the boundary of the experience segment's
// composition instead, where that isn't the live site's (#6, Slice 2): Next
// puts the site's 404 in every page's payload, with the stylesheet its
// boundary links, and under demo /sample's ?variant= renders a composition
// the live site doesn't select.
const HOME: readonly NavLink[] = [{ href: '/', label: 'Home' }];

/**
 * The live site document, or null before startup and while the catalog
 * can't serve: the request's own read, so a 404 inside the site's layout
 * renders from the layout's revision.
 */
async function liveSite(): Promise<Site | null> {
  if (!getDeploymentState()) return null;
  try {
    return (await getLive()).unit?.site ?? null;
  } catch {
    return null;
  }
}

export async function NotFoundBody({
  segment,
  nonce,
  registry = REGISTRY,
}: {
  /** The experience segment proxy.ts named for the request, when it's a visitor page's. */
  readonly segment?: string;
  /** The nonce of the request's Content-Security-Policy, for the boundary's stylesheet. */
  readonly nonce?: string;
  readonly registry?: VariantRegistry;
} = {}) {
  const state = getDeploymentState();
  const links = state ? capabilityPolicy(state.config.profile).navigation(null) : HOME;
  const site = await liveSite();
  const page = (
    <main className="host-chrome">
      <h1>Page not found</h1>
      <p>Nothing lives at this address.</p>
      <nav aria-label="Pages">
        <ul className="host-chrome__links">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} prefetch={false}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
  if (!site) return page;
  const live = compositionFor(site.appearance.variant, registry);
  const composition =
    segment === undefined || segment === live.rendered.manifest.id
      ? live
      : compositionFor(segment, registry);
  return (
    <PresentationBoundary composition={composition} motionPolicy={site.motionPolicy} nonce={nonce}>
      {page}
    </PresentationBoundary>
  );
}
