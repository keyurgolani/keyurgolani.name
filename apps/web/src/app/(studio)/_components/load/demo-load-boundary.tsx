'use client';

import type { ReactNode } from 'react';
import { StudioLoadBoundary } from './load-boundary';

// Demo Studio's load boundary (row 88c): when its shell doesn't load, the
// alert offers Reload Studio alone. Demo Studio has no session to end: its
// /studio needs none, auth.logout isn't in its profile, and it has no
// sign-in page, so a Sign out here would claim something untrue.

export function DemoLoadBoundary({ children }: { readonly children: ReactNode }) {
  return <StudioLoadBoundary>{children}</StudioLoadBoundary>;
}
