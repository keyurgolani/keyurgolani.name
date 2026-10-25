// #9's Demo Studio, as a quality surface (#11, Slice 1, item 4): its Content
// task, the picker that imports a visitor's own pair and Export setup, under
// the demo profile, with no session, at every viewport, 320px included, in
// every preference row that applies, under the same accessibility checks
// as Owner Studio's tasks (studio.ts). The task opens from the `task` query,
// as Owner Studio's do. With nothing imported, the task shows the picker,
// Export setup, and the sample's frame. Demo Studio's other tasks join under
// #11's own coverage.
import type {
  AuthMode,
  Interaction,
  NotApplicable,
  PerformanceTier,
  Profile,
  SurfaceState,
} from '../../tests/quality/lib/registration';

export const id = 'demo-studio';

export const owner = '#9';

export const profile: Profile = 'demo';

export const routes: readonly string[] = ['/studio'];

export const sources: readonly string[] = [
  'apps/web/src/app/(studio)/studio/page.tsx',
  'apps/web/src/app/(studio)/_components/studio-entry.tsx',
  'apps/web/src/app/(studio)/_components/demo/**',
  'apps/web/src/app/(studio)/_components/shell/**',
  'apps/web/src/app/(studio)/layout.tsx',
  'apps/web/src/app/(studio)/studio.css',
  'apps/web/src/lib/demo/**',
  'apps/web/src/lib/studio/**',
];

export const stateFixtures: readonly SurfaceState[] = [
  { id: 'content', query: { task: 'content' }, status: 200 },
];

// Its perf cell is the Content task's, the state above, as no state here
// is /studio with no query. The server sends /studio the same document and
// chunks with or without the `task` query, which the shell reads once it
// has loaded, so only which task it draws differs: the Content task's
// picker and the sample's frame, where the default Appearance task draws
// its selects and the same frame.
export const perfState = 'content';

// The frame shows the sample, the reference, or a visitor's own pair, in a
// composition whose own cells check its document, its contrast and its focus
// rings included, and this page's checks can't reach into a frame. So this
// surface's contrast sampler leaves out what axe names inside it, and its
// keyboard walk takes the frame as one stop while Tab moves through it,
// without measuring a ring there; each cell's report says so. Studio's own
// chrome stays under both, axe still checks all of it, and the frame's own
// box is still checked for being shown while it has focus.
export const framed = {
  reason:
    "The frame's document is the sample, the reference, or an imported pair in a registered composition, whose own composition cells check its contrast and its focus.",
} as const;

export const performanceTier: PerformanceTier = 'medium';

export const auth: AuthMode = 'none';

export const interactions: readonly Interaction[] = [
  {
    kind: 'status',
    name: 'Import your portfolio and site documents',
    route: '/studio',
    announces:
      'The import report says, as text, that the documents were imported or why they were refused, with each finding and each remote media item.',
  },
  {
    kind: 'status',
    name: 'Export setup',
    route: '/studio',
    announces:
      "The task lists a download link for each document and says what the files leave out, or that the documents couldn't be exported.",
  },
];

export const primaryActions: readonly string[] = ['Export setup'];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      'Studio renders outside any presentation boundary, so a display mode has nothing to apply to.',
  },
];

// Demo Studio needs its script by design: it keeps a visitor's changes in
// their browser. Its no-JavaScript cells check that it says so, and under
// failed enhancement that it says it couldn't load (#11's registration contract).
export const requiresScript = {
  reason:
    "Demo Studio keeps a visitor's changes in their own browser with JavaScript: without it the page says so, and the sample works without it.",
} as const;
