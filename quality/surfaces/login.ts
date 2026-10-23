// #2's sign-in page, as a quality surface (#11, Slice 1, item 4). Only the
// owner profile serves it, outside the Studio shell, signed out. Each state
// it renders before any script runs comes from its URL, as auth.login's
// redirect gives it.
import type {
  AuthMode,
  Interaction,
  NotApplicable,
  PerformanceTier,
  Profile,
  SurfaceState,
} from '../../tests/quality/lib/registration';

export const id = 'login';

export const owner = '#2';

export const profile: Profile = 'owner';

export const routes: readonly string[] = ['/studio/sign-in'];

export const sources: readonly string[] = [
  'apps/web/src/app/(studio)/studio/sign-in/**',
  'apps/web/src/app/(studio)/_components/sign-in-form.tsx',
  'apps/web/src/app/(studio)/layout.tsx',
  'apps/web/src/app/(studio)/studio.css',
  'apps/web/src/server/return-to.ts',
];

export const stateFixtures: readonly SurfaceState[] = [
  { id: 'signed-out', query: {}, status: 200 },
  { id: 'failed', query: { state: 'failed' }, status: 200 },
  { id: 'rate-limited', query: { state: 'rate_limited', retryAfter: '30' }, status: 200 },
  { id: 'server-error', query: { state: 'error' }, status: 200 },
  { id: 'session-ended', query: { state: 'session_ended' }, status: 200 },
];

export const performanceTier: PerformanceTier = 'light';

export const auth: AuthMode = 'none';

export const interactions: readonly Interaction[] = [
  {
    kind: 'status',
    name: 'Sign in',
    route: '/studio/sign-in',
    announces:
      'The alert says each state: signing in, a wrong password, a rate limit, a network failure, and a server error.',
  },
  { kind: 'disclosure', name: 'Show password', route: '/studio/sign-in' },
];

export const primaryActions: readonly string[] = ['Sign in'];

export const notApplicable: readonly NotApplicable[] = [];
