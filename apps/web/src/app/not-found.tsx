import Link from 'next/link';
import { getDeploymentConfig } from '~/server/config-store';
import { capabilityPolicy, type NavLink } from '~/server/policy';

// Links only to pages the profile serves, from CapabilityPolicy. No session
// reaches this page until #2, so it lists the public ones.
const HOME: readonly NavLink[] = [{ href: '/', label: 'Home' }];

export default function NotFound() {
  const config = getDeploymentConfig();
  const links = config ? capabilityPolicy(config.profile).navigation(null) : HOME;
  return (
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
}
