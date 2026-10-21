import Link from 'next/link';
import type { Site } from '@portfolio/schema';
import { PresentationBoundary } from '~/lib/render-composition';
import { compositionFor } from '~/lib/variants';
import { getDeploymentState } from '~/server/config-store';
import { capabilityPolicy, type NavLink } from '~/server/policy';

// Links only to pages the profile serves, from CapabilityPolicy. No session
// reaches this page until #2, so it lists the public ones. It renders inside
// the live site's presentation boundary (#5, Slice 3, item 6), so #19's
// tokens reach it once they ship. It reads only the site's presentation
// settings, and shows nothing about the request or the documents.
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

export default async function NotFound() {
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
              <Link href={link.href}>{link.label}</Link>
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
