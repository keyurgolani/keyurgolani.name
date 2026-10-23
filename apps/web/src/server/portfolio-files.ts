import { PACKS, PLATFORM_STYLESHEET } from '../lib/generated/registry.meta';

// The files registry generation writes into public/_portfolio/ (#19, Slice
// 2), by the path each is served at: the platform stylesheet, and every
// pack's compiled stylesheet and font files. proxy.ts lets a GET or HEAD
// under /_portfolio/ go on only for one of these, spelled exactly as listed
// (#7), and answers every other path there with the plain 404. A file the
// registry writes there that this leaves out would answer 404 too, so a test
// holds the list to what public/_portfolio/ holds after generation.

/** Every path under /_portfolio/ the registry wrote a file for. */
export const PORTFOLIO_FILES: ReadonlySet<string> = new Set(
  [
    PLATFORM_STYLESHEET?.url,
    ...PACKS.flatMap((pack) => [pack.stylesheet?.url, ...(pack.fonts ?? []).map(({ url }) => url)]),
  ].filter((url): url is string => typeof url === 'string'),
);
