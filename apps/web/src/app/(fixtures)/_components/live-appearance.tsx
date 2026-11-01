'use client';

import { useRouter } from 'next/navigation';
import { VisitorAppearance, type VisitorAppearanceProps } from '@portfolio/appearance/react';

// The fixture page's visitor control, given a refresh the way Slice 4 wires
// it on visitor pages (#19, Slice 3), so it goes live once the page
// hydrates and tests/appearance can see its controls keep their nodes.

export function LiveAppearance(props: Pick<VisitorAppearanceProps, 'model' | 'returnTo'>) {
  const router = useRouter();
  return <VisitorAppearance {...props} refresh={() => router.refresh()} />;
}
