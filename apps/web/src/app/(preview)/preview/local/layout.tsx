import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PREVIEW_ROBOTS } from '../../document';

// Demo Studio's local preview frame (#7, Slice 6; #9): the root layout of
// /preview/local, an empty document. What it shows comes from Studio over
// the frame's port and renders in the browser, so the server renders no
// visitor data and no published content here.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Preview', robots: PREVIEW_ROBOTS };

export default function LocalPreviewLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
