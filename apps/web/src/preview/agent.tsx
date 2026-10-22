'use client';

import { useEffect } from 'react';
import { startFrameChannel, type FrameChannelOptions } from './frame-channel';

// The preview agent (#7, Slices 1 and 3): the one thing a preview document
// adds to the portfolio tree. It renders nothing and adds no DOM, CSS, or
// visible UI, so the frame shows the portfolio exactly as a visitor gets it.
// Once the page hydrates it runs the frame's half of the channel
// (frame-channel.ts): the handshake with Studio, the link guard, scrolling,
// and the lifecycle state. A document with no channel, such as the dev
// fixture route, gets none, and a document that isn't framed starts nothing.

/** Renders nothing, and runs `channel` while the document is framed. */
export function PreviewAgent({ channel }: { readonly channel?: FrameChannelOptions }) {
  const mode = channel?.mode;
  const studioOrigin = channel?.studioOrigin;
  const linkBase = channel?.linkBase;
  const nonce = channel?.nonce;
  const renderedVersion = channel?.renderedVersion ?? null;
  useEffect(() => {
    if (mode === undefined || studioOrigin === undefined || linkBase === undefined) return;
    const stop = startFrameChannel(window, {
      mode,
      studioOrigin,
      linkBase,
      renderedVersion,
      ...(nonce === undefined ? {} : { nonce }),
    });
    return stop ?? undefined;
  }, [mode, studioOrigin, linkBase, nonce, renderedVersion]);
  return null;
}
