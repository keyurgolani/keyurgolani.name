import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '../globals.css';
import './studio.css';

// Studio's own root layout (#2): /studio and everything under it, sign-in
// included. It renders none of the site's inline script or JSON-LD, so the
// only scripts on a Studio page are Next's, which take the nonce proxy.ts
// puts in each response's Content-Security-Policy. Rendered per request, as
// that nonce is.
export const dynamic = 'force-dynamic';

// No share metadata: Studio's pages have nothing to share.
export const metadata: Metadata = { title: 'Portfolio Studio', openGraph: null, twitter: null };

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="studio">{children}</body>
    </html>
  );
}
