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

// When Studio's shell doesn't load (row 88c): each profile's /studio page
// wraps its entry in a boundary of its own (owner-load-boundary.tsx,
// demo-load-boundary.tsx), outside the shell's lazy chunk, so it loads with
// the page and is there when the shell isn't. It says "Studio couldn't
// load." with Reload Studio, which takes focus, and whatever actions the
// profile adds (the owner's Sign out):
//
// - A shell whose chunk is refused (its import rejects) gets the alert in
//   its place, for good.
// - A shell still on its way after STUDIO_LOAD_TIMEOUT_MS gets the same
//   alert, the server's markup hidden under it. If the shell arrives later
//   and nothing in the alert was pressed, the shell takes over: the alert
//   goes and focus moves to the shell's main region. Once Reload or an
//   action is pressed, that goes ahead and a late shell is ignored.
//
// The alert never says the owner is signed out: it says only that Studio
// didn't load.

/** How long a shell, or the owner adapter it loads, may take before Studio says it couldn't load. */
export const STUDIO_LOAD_TIMEOUT_MS = 5_000;

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

type Phase = 'waiting' | 'live' | 'late' | 'rejected';

/** The failure state's box: the page's one main once the shell is gone, a plain box while it's late. */
function Failure({
  rejected,
  children,
  ...props
}: {
  readonly rejected: boolean;
  readonly children: ReactNode;
  readonly className: string;
  readonly id: string;
  readonly tabIndex: number;
}) {
  return rejected ? <main {...props}>{children}</main> : <div {...props}>{children}</div>;
}

/** The alert's own part: the actions a profile adds, told when one is pressed. */
export type LoadActions = (pressed: () => void) => ReactNode;

export function StudioLoadBoundary({
  children,
  actions,
}: {
  readonly children: ReactNode;
  readonly actions?: LoadActions;
}) {
  const [phase, setPhase] = useState<Phase>('waiting');
  // Once Reload or an action is pressed, that goes ahead, and a late shell is ignored.
  const pressed = useRef(false);
  const reload = useRef<HTMLButtonElement>(null);
  const live = useRef(false);

  // Set when the alert showed for a shell still on its way, so its arrival moves focus.
  const wasLate = useRef(false);
  const [mounted] = useState(() => () => {
    live.current = true;
    if (pressed.current) return;
    setPhase((now) => (now === 'rejected' ? now : 'live'));
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (live.current) return;
      wasLate.current = true;
      setPhase((now) => (now === 'waiting' ? 'late' : now));
    }, STUDIO_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // A late shell took over: focus goes where the shell starts.
  useEffect(() => {
    if (phase !== 'live' || !wasLate.current) return;
    wasLate.current = false;
    document.getElementById('studio-main')?.focus();
  }, [phase]);

  const alerting = phase === 'late' || phase === 'rejected';
  useEffect(() => {
    if (alerting) reload.current?.focus();
  }, [alerting]);

  const [press] = useState(() => () => {
    pressed.current = true;
  });

  return (
    <>
      {alerting ? (
        // Studio's name and the alert, as the quality harness's failure state reads a page that
        // needs its script: one main and an h1. While the shell is only late, its own main stays in
        // the page, hidden, so the alert's box is no second main.
        <Failure
          className="studio-shell__main"
          id="studio-load-failure"
          tabIndex={-1}
          rejected={phase === 'rejected'}
        >
          <h1 className="studio-shell__name">Portfolio Studio</h1>
          <div className="studio-alert" role="alert">
            <p>Studio couldn&apos;t load.</p>
            <button
              ref={reload}
              type="button"
              className="studio-button"
              onClick={() => {
                press();
                window.location.reload();
              }}
            >
              Reload Studio
            </button>
            {actions?.(press)}
          </div>
        </Failure>
      ) : null}
      {phase === 'rejected' ? null : (
        // The shell, hidden under the alert while it's late; otherwise the wrapper adds no box of
        // its own (.studio-load, display: contents).
        <div className="studio-load" hidden={phase === 'late' ? true : undefined}>
          <MountedContext.Provider value={mounted}>
            <Rejected onRejected={() => setPhase('rejected')}>{children}</Rejected>
          </MountedContext.Provider>
        </div>
      )}
    </>
  );
}
