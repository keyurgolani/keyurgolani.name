import { startFrameChannel, type RegisteredPacks, type SampleQueryKeys } from './frame-channel';

// The sample's agent (DEM-2): what lets Demo Studio's /sample or /reference
// frame show a scheme, a typography, a design language, or a display mode in
// place, in the same document, as Owner Studio's frame does, rather than
// loading the page again for each. It starts the frame's half of the channel
// in sample mode (frame-channel.ts), which takes `connect` from its parent
// window and Studio's origin alone and over the port only an `appearance`
// whose every pack is one the server rendered here as this build's own, and
// carries what it shows on to the page's own links.
//
// No page imports it: lib/sample-frame.tsx loads it with a dynamic import,
// in a framed /sample or /reference page under demo alone, so it sits in a
// chunk of its own that no public page loads (#6, Slice 2's purity), and a
// visitor who opens the sample at the top level loads none of it
// (preview-agent-demo.spec.ts).

/** What the sample's agent starts from: all of it the server's. */
export interface SampleChannel {
  /** The deployment's origin, Demo Studio's: the only one `hello` goes to and `connect` comes from. */
  readonly studioOrigin: string;
  /** Where the page's routes are mounted. */
  readonly linkBase: '/sample' | '/reference';
  /** The packs the frame may show, each by id with its build stylesheet. */
  readonly registered: RegisteredPacks;
  /** The query keys the page's links carry the appearance under, #19's. */
  readonly queryKeys: SampleQueryKeys;
}

/** Starts the channel in sample mode in `win`, and returns what stops it, or null unframed. */
export function startSampleAgent(win: Window, channel: SampleChannel): (() => void) | null {
  return startFrameChannel(win, {
    mode: 'sample',
    studioOrigin: channel.studioOrigin,
    linkBase: channel.linkBase,
    renderedVersion: null,
    registered: channel.registered,
    queryKeys: channel.queryKeys,
  });
}
