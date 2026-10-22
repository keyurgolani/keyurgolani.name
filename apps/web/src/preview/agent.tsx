'use client';

// The preview agent (#7, Slice 1, item 3): the one thing a preview document
// adds to the portfolio tree. It renders nothing and adds no DOM, CSS, or
// visible UI, so the frame shows the portfolio exactly as a visitor gets it.
// Slice 3 gives it the message protocol: the handshake with Studio, the
// environment updates, and the link guard, all without rendering anything.

/** Renders nothing. */
export function PreviewAgent() {
  return null;
}
