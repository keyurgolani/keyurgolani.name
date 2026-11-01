'use client';

import type { ReactElement } from 'react';
import { BALLAST } from './ballast';

// fixture-over-budget's client island (#6, Slice 2): it reads all of
// BALLAST, so no bundler can leave the bytes out of its chunk, and renders
// one hidden mark with their checksum.

/** A 32-bit checksum of `text`, in hex. */
function checksum(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export function Ballast(): ReactElement {
  return <span className="fob-ballast" data-fob-ballast={checksum(BALLAST)} hidden />;
}
