// #8's Owner Studio, as a quality surface (#11, Slice 1, item 4; #8, Slice
// 8): every primary task, signed in, under the owner profile. Each task is a
// state, which the shell opens from the `task` query as it does from a
// task link's fragment, so every cell is the one Studio page in the task
// the owner would be working in, at every viewport, 320px included, in
// every preference row that applies. With the quality server's data
// directory as its first start leaves it, the live revision imported and
// no working draft, each task shows what it shows before a draft starts.
import type {
  AuthMode,
  Interaction,
  NotApplicable,
  PerformanceTier,
  Profile,
  SurfaceState,
} from '../../tests/quality/lib/registration';

export const id = 'studio';

export const owner = '#8';

export const profile: Profile = 'owner';

export const routes: readonly string[] = ['/studio'];

export const sources: readonly string[] = [
  'apps/web/src/app/(studio)/studio/page.tsx',
  'apps/web/src/app/(studio)/_components/studio-entry.tsx',
  'apps/web/src/app/(studio)/_components/shell/**',
  'apps/web/src/app/(studio)/_components/preview/**',
  'apps/web/src/app/(studio)/_components/split/**',
  'apps/web/src/app/(studio)/layout.tsx',
  'apps/web/src/app/(studio)/studio.css',
  'apps/web/src/lib/studio/**',
];

/** Studio's primary tasks, in the order its navigation lists them. */
const TASKS = [
  'content',
  'case-studies',
  'media',
  'appearance',
  'site',
  'validation',
  'history',
] as const;

// Appearance is where the shell lands with no task named (OWN-3), so its cell comes first and
// loads /studio as it is, the PR plan's and the perf cell's; every other task names itself.
export const stateFixtures: readonly SurfaceState[] = [
  'appearance' as const,
  ...TASKS.filter((task) => task !== 'appearance'),
].map((task): SurfaceState => ({
  id: task,
  query: task === 'appearance' ? {} : { task },
  status: 200,
}));

// The Appearance task's frame shows the owner's draft under a preview grant (#7), rendered
// by a registered composition, whose own composition cells check that document, its
// contrast and its focus rings included; this page's checks can't reach into a frame. So
// the contrast sampler leaves out what axe names inside it, and the keyboard walk takes
// the frame as one stop without a ring measured there. Studio's chrome stays under both,
// axe still checks all of it, and the frame's own box is still checked for being shown
// while it has focus.
export const framed = {
  reason:
    "The frame's document is the owner's draft under a preview grant, in a registered composition, whose own composition cells check its contrast and its focus.",
} as const;

export const performanceTier: PerformanceTier = 'medium';

export const auth: AuthMode = 'session';

export const interactions: readonly Interaction[] = [
  {
    kind: 'status',
    name: 'Save draft',
    route: '/studio',
    announces: 'The status line says the version the draft was saved as, or why it was not saved.',
  },
  {
    kind: 'status',
    name: 'Apply to the draft',
    route: '/studio',
    announces: 'The status line says the version the appearance was applied as, or why not.',
  },
  {
    kind: 'status',
    name: 'Publish',
    route: '/studio',
    announces:
      'Its dialog names the live revision and the draft version that replaces it; once confirmed, the status says what the store did and which revision live.get says is live.',
  },
  {
    kind: 'status',
    name: 'Roll back',
    route: '/studio',
    announces:
      'Its dialog names the live revision and the one that replaces it, and that the draft stays; once confirmed, the status says which revision is live.',
  },
];

export const primaryActions: readonly string[] = ['Sign out', 'Start a draft', 'Publish'];

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      'Studio renders outside any presentation boundary, so a display mode has nothing to apply to.',
  },
];

// Studio needs its script by design: its no-JavaScript cells, the row and the
// default row's condition, check that it says so, and under failed
// enhancement that it says it couldn't load, each with axe, in place of
// comparing its content (#11's registration contract).
export const requiresScript = {
  reason:
    'Studio is a signed-in workspace its script draws from the store: without JavaScript it says it needs it, and nothing in it can be used.',
} as const;
