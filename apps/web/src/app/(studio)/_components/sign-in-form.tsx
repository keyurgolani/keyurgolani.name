'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LOGIN_PATH, loginAction, type SignInState } from '~/server/return-to';

// The sign-in form (#2). Without JavaScript it is a plain form post to
// auth.login, which answers with a 303 back here, and the server renders the
// state it names in the alert. With JavaScript it posts the same password as
// JSON and shows each state in that alert, which takes focus: submitting, a
// wrong password, a rate limit, a network failure, and a server error. A
// rate limit is announced once, with the time it started with, and once
// more when it lifts; the seconds left count down beside it, where nothing
// is announced. The username is fixed to owner for password managers, the
// password field takes paste, and a toggle can show it. Nothing asks for
// more than the password (WCAG 2.2 SC 3.3.8).

type Notice =
  | { readonly kind: Exclude<SignInState, 'rate_limited'> | 'submitting' | 'network' }
  | {
      readonly kind: 'rate_limited';
      /** The seconds it started with, which the alert says. */
      readonly initial: number;
      /** The seconds left, which count down outside the alert. */
      readonly seconds: number;
    };

const TEXT: Readonly<Record<Exclude<Notice['kind'], 'rate_limited'>, string>> = {
  submitting: 'Signing in…',
  failed: "That password didn't work.",
  network: "Couldn't reach the server. Check your connection, then try again.",
  error: 'Something went wrong on the server. Try again soon.',
  signed_out: "You're signed out.",
  session_ended: 'Your session ended. Sign in again to go on.',
};

const seconds = (count: number) => `${count} ${count === 1 ? 'second' : 'seconds'}`;

/**
 * What the alert says. For a rate limit it changes twice only: once as the
 * limit starts, and once as it lifts.
 */
function message(notice: Notice): string {
  if (notice.kind !== 'rate_limited') return TEXT[notice.kind];
  return notice.seconds > 0
    ? `Too many attempts. Try again in ${seconds(notice.initial)}.`
    : 'You can try again now.';
}

export interface SignInFormProps {
  /** The state the URL names, which the server renders before any script runs. */
  readonly state: SignInState | null;
  /** Where to go once signed in, already made safe. */
  readonly returnTo: string;
  /** Seconds left, for `rate_limited`. */
  readonly retryAfter: number | null;
}

const subscribeNothing = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;

/** A rate limit of `count` seconds, just started. */
const limited = (count: number): Notice => ({
  kind: 'rate_limited',
  initial: count,
  seconds: count,
});

function initial({ state, retryAfter }: SignInFormProps): Notice | null {
  if (state === null) return null;
  if (state === 'rate_limited') return limited(retryAfter ?? 0);
  return { kind: state };
}

export function SignInForm(props: SignInFormProps) {
  const { returnTo } = props;
  const [notice, setNotice] = useState<Notice | null>(() => initial(props));
  // False while the server renders and the page hydrates, then true: the
  // toggle and the scripted post work only from then on.
  const enhanced = useSyncExternalStore(subscribeNothing, hydrated, notHydrated);
  const [shown, setShown] = useState(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const kind = notice?.kind;
  const busy = kind === 'submitting';
  const waiting = notice?.kind === 'rate_limited' && notice.seconds > 0;

  // Each new notice is announced, and the alert takes focus. A countdown's
  // ticks aren't new notices, and happen outside the alert.
  useEffect(() => {
    if (kind) alert.current?.focus();
  }, [kind]);

  // A rate limit counts down to the second it lifts.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setNotice((current) =>
        current?.kind === 'rate_limited' ? { ...current, seconds: current.seconds - 1 } : current,
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [notice, waiting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || waiting) return;
    const password = new FormData(event.currentTarget).get('password');
    setNotice({ kind: 'submitting' });
    let response: Response;
    try {
      response = await fetch(LOGIN_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: typeof password === 'string' ? password : '' }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      setNotice({ kind: 'network' });
      return;
    }
    if (response.ok) {
      window.location.assign(returnTo);
      return;
    }
    if (response.status === 401) setNotice({ kind: 'failed' });
    else if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'));
      setNotice(limited(Number.isFinite(after) && after > 0 ? Math.ceil(after) : 1));
    } else setNotice({ kind: 'error' });
  }

  return (
    <form
      className="studio-sign-in__form"
      method="post"
      // returnTo in the URL too: a post turned away before its body is read,
      // such as a blocked source's, still comes back here keeping it.
      action={loginAction(returnTo)}
      onSubmit={enhanced ? submit : undefined}
    >
      <p ref={alert} className="studio-alert" role="alert" tabIndex={-1} hidden={notice === null}>
        {notice ? message(notice) : null}
      </p>
      {/* Not a live region: a screen reader hears the alert, not each second. */}
      {waiting ? <p className="studio-countdown">{seconds(notice.seconds)} left.</p> : null}
      <input type="text" name="username" value="owner" autoComplete="username" readOnly hidden />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="studio-label" htmlFor="studio-password">
        Password
      </label>
      <div className="studio-field">
        <input
          id="studio-password"
          className="studio-input"
          name="password"
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        {enhanced ? (
          <button
            type="button"
            className="studio-button studio-button--quiet"
            aria-controls="studio-password"
            aria-pressed={shown}
            onClick={() => setShown((current) => !current)}
          >
            {shown ? 'Hide password' : 'Show password'}
          </button>
        ) : null}
      </div>
      <button
        type="submit"
        className="studio-button"
        aria-disabled={busy || waiting ? true : undefined}
      >
        Sign in
      </button>
    </form>
  );
}
