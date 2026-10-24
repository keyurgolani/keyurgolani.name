'use client';

import dynamic from 'next/dynamic';
import type { LocalFrameProps } from '~/preview/local-document';

// The local frame's client entry (#9): the frame itself loads in the
// browser alone, with no server render, so no server chunk carries the
// renderer it reaches, the compositions, or the import validator, and the
// server never has a document to render.

const LocalFrame = dynamic(
  () => import('~/preview/local-document').then((module) => module.LocalFrame),
  {
    ssr: false,
    loading: () => (
      <p className="local-preview__status" aria-busy="true">
        Waiting for the document…
      </p>
    ),
  },
);

export function LocalPreview(props: Omit<LocalFrameProps, 'install'>) {
  return <LocalFrame {...props} />;
}
