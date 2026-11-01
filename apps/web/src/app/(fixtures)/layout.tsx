import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './fixtures.css';

// The test fixtures' own root layout (#19, Slice 3): /_fixtures/appearance,
// which only a build made with APPEARANCE_FIXTURES=1 serves. Like #7's
// preview, it loads no host chrome: none of the site's or Studio's CSS,
// scripts, or metadata. The page's presentation boundaries link the
// stylesheets that style it, and fixtures.css only places its scenes.
// Rendered per request, as the deployment it reads is.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Appearance fixtures',
  robots: { index: false, follow: false },
};

export default function FixturesLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
