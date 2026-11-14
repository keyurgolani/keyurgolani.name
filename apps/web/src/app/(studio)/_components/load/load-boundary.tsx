'use client';

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { lateCommitted, latePressed, StudioLoadAlert, type CommitPhase } from './late-alert';
import { inlineLateClockScript } from './late-markup';

// When Studio's shell doesn't load (row 88c): /studio's page wraps its entry,
// under either profile, in this boundary, outside the shell's lazy chunk, so
// it loads with the page and is there when the shell isn't. Both places it
// can show say "Studio couldn't load." with Reload Studio, which takes focus,
// through one alert, StudioLoadAlert:
//
// - A shell whose chunk is refused (its import rejects) gets the alert in
//   its place, here, for good.
// - A shell still on its way after STUDIO_LOAD_TIMEOUT_MS gets it from
//   late-alert.tsx, in a root of its own. It can't come from here: next/dynamic
//   with ssr adds no Suspense boundary (next/dist/shared/lib/lazy-dynamic/
//   loadable.js:49), so a stalled shell chunk suspends the page's whole
//   root, and nothing here commits or runs until it arrives. A Suspense
//   boundary around the shell would let this commit, but on a cold render
//   (React.lazy's first call in a server process, its retry behind Next's
//   setImmediate-then-pipe) the server would stream the shell out of line:
//   never add one (load-boundary-ssr.test.tsx).
//
// At commit, this tells the late alert how the root committed. If the late
// alert showed and Reload wasn't pressed, it goes, and the shell, or this
// alert for a refused one, takes over. Once its Reload was pressed, the page
// reloads: this renders no alert of its own, and a shell that arrives in the
// moment before the reload lands may show until it does.
//
// Reload under both profiles, and under owner Sign out, a plain form post
// (sign-out-form.tsx, row 88c-RC2): this is in the page's entry, which both
// profiles' pages load, so it reaches no owner code (#9; load-imports.test.ts).
// The alert never says the owner is signed out: it says only that Studio
// didn't load.

/** What a shell calls once it has mounted, so the boundary knows it arrived. */
const MountedContext = createContext<() => void>(() => {});

/** Tells the load boundary the shell has mounted: every Studio shell calls it once. */
export function useStudioMounted(): void {
  const mounted = useContext(MountedContext);
  useLayoutEffect(() => {
    mounted();
  }, [mounted]);
}

/** Catches the shell's import when it rejects. */
class Rejected extends Component<
  { readonly children: ReactNode; readonly onRejected: () => void },
  { readonly rejected: boolean }
> {
  override state = { rejected: false };
  static getDerivedStateFromError() {
    return { rejected: true };
  }
  override componentDidCatch() {
    this.props.onRejected();
  }
  override render() {
    return this.state.rejected ? null : this.props.children;
  }
}

type Phase = 'waiting' | 'live' | 'rejected';

export function StudioLoadBoundary({
  children,
  profile,
  nonce,
}: {
  readonly children: ReactNode;
  /** The page's profile (row 88c-RC2 (b)): under owner the alerts offer Sign out. */
  readonly profile: 'owner' | 'demo';
  /**
   * The request's CSP nonce: with it, the server's markup carries the late alert's clock
   * as one inline script under Studio's existing script-src, so a chunk that stalls before any
   * module evaluates still gets "Studio couldn't load." in time. Without one, no script goes out,
   * and late-alert.tsx starts the clock itself.
   */
  readonly nonce?: string;
}) {
  const [phase, setPhase] = useState<Phase>('waiting');
  // Set in the same commit as the shell's mount or the refusal's catch, before this boundary's
  // layout effect, where `phase` still reads 'waiting'.
  const live = useRef(false);
  const rejected = useRef(false);
  const handed = useRef(false);
  const reload = useRef<HTMLButtonElement>(null);

  const [mounted] = useState(() => () => {
    live.current = true;
    setPhase((now) => (now === 'rejected' ? now : 'live'));
  });
  const [onRejected] = useState(() => () => {
    rejected.current = true;
    setPhase('rejected');
  });

  // Once, at the first commit the shell's arrival or refusal is part of.
  useLayoutEffect(() => {
    if (handed.current) return;
    const now: CommitPhase | null = rejected.current ? 'rejected' : live.current ? 'live' : null;
    if (now === null) return;
    handed.current = true;
    lateCommitted(now);
  });

  // Once the late alert's Reload was pressed, the page reloads, and this shows no alert.
  const alerting = phase === 'rejected' && !latePressed();
  useEffect(() => {
    if (alerting) reload.current?.focus();
  }, [alerting]);

  return (
    <>
      {nonce ? (
        // Run by the HTML parser, before any chunk; React never runs it again. A browser hides a
        // nonce's value once it applies it, so the attribute reads differently at hydration.
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: inlineLateClockScript(profile) }}
        />
      ) : null}
      {alerting ? (
        <StudioLoadAlert
          main
          reload={reload}
          profile={profile}
          onReload={() => window.location.reload()}
        />
      ) : null}
      {phase === 'rejected' ? null : (
        // The wrapper adds no box of its own (.studio-load, display: contents); studio.css hides it
        // while the late alert's node is in the page. It names the page's profile, which the late
        // alert, in a root of its own, reads (row 88c-RC2 (b)).
        <div className="studio-load" data-studio-profile={profile}>
          <MountedContext.Provider value={mounted}>
            <Rejected onRejected={onRejected}>{children}</Rejected>
          </MountedContext.Provider>
        </div>
      )}
    </>
  );
}
