import Link from 'next/link';
import type { Site } from '@portfolio/schema';
import { PresentationBoundary } from '~/lib/experience-document';
import { compositionFor } from '~/lib/variants';
import { getDeploymentState } from '~/server/config-store';
import { capabilityPolicy, type NavLink } from '~/server/policy';

// What every 404 shows, inside the site's layout or the global 404 page's
// own document. It links only to pages the profile serves, from
// CapabilityPolicy, and reads no session, so it lists the public ones. It
// renders inside the live site's presentation boundary (#5, Slice 3, item
// 6), so #19's tokens reach it once they ship. It reads only the site's
// presentation settings, and shows nothing about the request or the
// documents. Its links don't prefetch: under a preview path the page has
// the preview's CSP, whose connect-src lets no request through (#7).
const HOME: readonly NavLink[] = [{ href: '/', label: 'Home' }];

/** The live site document, or null before startup and while the catalog can't serve. */
async function liveSite(): Promise<Site | null> {
  const state = getDeploymentState();
  if (!state) return null;
  try {
    return (await state.catalog.getLive()).unit.site;
  } catch {
    return null;
  }
}

export async function NotFoundBody() {
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
  return (
    <PresentationBoundary
      composition={compositionFor(site.appearance.variant)}
      motionPolicy={site.motionPolicy}
    >
      {page}
    </PresentationBoundary>
  );
}
