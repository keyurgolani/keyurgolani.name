'use client';

import { useEffect } from 'react';
import type { SampleChannel } from '~/preview/sample-agent';

// What loads the sample's agent (DEM-2) on a /sample or /reference page under
// demo. Every experience segment serves those pages and the public site's
// alike, and the bundler puts each client component the segment's server
// code reaches into the segment's own chunks, so this loader renders on every
// visitor page's chunk list. It holds none of the agent: the agent, and the
// frame's half of the channel with it, come through a dynamic import, which
// the bundler gives a chunk of its own, and only here, only in a framed page
// whose server gave it a channel. A public page, under any profile, renders
// none of this and loads none of the agent (#6, Slice 2's purity); /sample at
// the top level loads none of it either.

/** Renders nothing; framed, it loads the sample's agent and starts it with `channel`. */
export function SampleFrame({ channel }: { readonly channel: SampleChannel }) {
  // As text, so a new render of the same channel starts nothing again.
  const given = JSON.stringify(channel);
  useEffect(() => {
    // At the top level the page is a visitor's, with no Studio to talk to: nothing loads.
    if (window.parent === window) return;
    let stop: (() => void) | null = null;
    let stopped = false;
    void import('~/preview/sample-agent').then(({ startSampleAgent }) => {
      if (!stopped) stop = startSampleAgent(window, JSON.parse(given) as SampleChannel);
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }, [given]);
  return null;
}
