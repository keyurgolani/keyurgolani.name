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

// The first, Content, is the shell's own first task, so its cell loads /studio as it is.
export const stateFixtures: readonly SurfaceState[] = TASKS.map((task, index): SurfaceState => ({
  id: task,
  query: index === 0 ? {} : { task },
  status: 200,
}));

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
