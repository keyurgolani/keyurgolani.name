import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '../experience-base.css';
// Host chrome, for Studio's error and not-found pages: no other layout loads it (#7).
import '../host-chrome.css';
import './studio.css';

// Studio's own root layout (#2): /studio and everything under it, sign-in
// included. It renders none of the site's inline script or JSON-LD, so the
// only scripts on a Studio page are Next's, which take the nonce proxy.ts
// puts in each response's Content-Security-Policy. Rendered per request, as
// that nonce is.
export const dynamic = 'force-dynamic';

// No share metadata: Studio's pages have nothing to share, and none is for
// a crawler to index or follow (#8, Slice 1), whatever robots.txt says.
export const metadata: Metadata = {
  title: 'Portfolio Studio',
  openGraph: null,
  twitter: null,
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="studio">{children}</body>
    </html>
  );
}
