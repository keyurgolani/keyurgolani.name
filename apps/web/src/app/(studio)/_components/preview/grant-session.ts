import type { StudioFetchOptions } from '~/lib/studio-fetch';

// One preview frame's grant, as Studio keeps it (#7, Slice 4, item 8): mint
// when the frame is made and again for what it shows next, renew on a
// heartbeat, ask for its status when a renewal fails or a load brings no
// valid hello, mint again when it's superseded, expired, or unknown, and
// revoke it when the frame goes. A version preview_blocked stops gets no
// grant: the frame keeps the one it has, and nothing mints again until the
// next save asks. Once the session ends, nothing more goes out. It sends
// only #61's preview.grant commands, through studioFetch, with the page's
// CSRF token, and holds no DOM, so PreviewSurface draws what it says.

/** What preview.grant.mint takes: the subject, the frame's environment, and an appearance override. */
export interface MintRequest {
  readonly subject:
    | { readonly draft: string; readonly version: number }
    | { readonly revision: string }
    | { readonly fixture: string };
  readonly environment: {
    readonly displayMode: 'system' | 'light' | 'dark' | 'high-contrast';
    readonly contrast: 'system' | 'more';
    readonly motion: 'system' | 'reduce';
    readonly enhancement: 'on' | 'off';
  };
  readonly appearance?: Readonly<Record<string, unknown>>;
}

/** A grant the frame can load. */
export interface HeldGrant {
  readonly grant: string;
  readonly nonce: string;
}

/** Where the frame's grant is. */
export type GrantState =
  | { readonly kind: 'minting' }
  | ({ readonly kind: 'active' } & HeldGrant)
  /**
   * No new grant: the version has `diagnostics` findings that block
   * preview. The frame keeps the grant it held, if any, and the next save
   * tries again.
   */
  | { readonly kind: 'blocked'; readonly diagnostics: number; readonly kept: HeldGrant | null }
  /**
   * The session ended: signed out, a 401, or session_ended. `announce` says
   * the other Studio tabs haven't heard: a grant's status said its session
   * ended. A 401 told them as studioFetch saw it.
   */
  | { readonly kind: 'ended'; readonly announce: boolean }
  /** The mint failed for another reason, which Retry tries again. */
  | { readonly kind: 'failed' };

/** What a grant session sends Studio's operations through: studioFetch, or a stand-in. */
export type StudioCall = (name: string, options: StudioFetchOptions) => Promise<Response>;

export interface GrantSessionOptions {
  readonly call: StudioCall;
  readonly csrfToken: string;
  readonly onState: (state: GrantState) => void;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface GrantSession {
  /** Mints a grant of `request`, for the frame to load next, and revokes the one it held. */
  mint(request: MintRequest): Promise<void>;
  /**
   * Asks for the grant's status, as a failed renewal or a load with no
   * valid hello does, and mints again when it's superseded, expired, or
   * unknown.
   */
  check(): Promise<void>;
  /** The session ended: no request goes out from here on. */
  end(): void;
  /** Revokes the grant and stops, as the frame unmounts. */
  stop(): void;
}

/** The statuses that mint a new grant of the same request. */
const REMINT = new Set(['superseded', 'expired', 'unknown']);

/** When the next renewal goes, from the time an active grant has left idle: a third of it, from 5 s to 5 min. */
export function renewalDelay(idleExpiresAt: string, now: number): number {
  const left = Date.parse(idleExpiresAt) - now;
  if (!Number.isFinite(left)) return 5_000;
  return Math.min(300_000, Math.max(5_000, Math.floor(left / 3)));
}

interface Answer {
  readonly status: number;
  readonly data?: Record<string, unknown>;
}

interface Current extends HeldGrant {
  readonly idleExpiresAt: unknown;
}

/** Starts a grant session. Nothing goes out until mint(). */
export function createGrantSession(options: GrantSessionOptions): GrantSession {
  const {
    call,
    csrfToken,
    onState,
    now = () => Date.now(),
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  } = options;
  let request: MintRequest | null = null;
  let current: Current | null = null;
  let timer: unknown;
  let ended = false;
  let stopped = false;
  /** Each mint's turn: the answer to an older one is dropped. */
  let turn = 0;

  const set = (state: GrantState) => {
    if (!stopped) onState(state);
  };

  const send = async (name: string, body: unknown): Promise<Answer | null> => {
    if (ended || stopped) return null;
    try {
      const response = await call(name, { body, csrfToken });
      const parsed = (await response.json().catch(() => ({}))) as {
        data?: Record<string, unknown>;
      };
      return { status: response.status, ...(parsed.data ? { data: parsed.data } : {}) };
    } catch {
      return { status: 0 };
    }
  };

  const endSession = (announce: boolean) => {
    if (ended) return;
    ended = true;
    clearTimer(timer);
    current = null;
    set({ kind: 'ended', announce });
  };

  const schedule = () => {
    clearTimer(timer);
    const held = current;
    if (!held || typeof held.idleExpiresAt !== 'string' || ended || stopped) return;
    timer = setTimer(() => void renew(held), renewalDelay(held.idleExpiresAt, now()));
  };

  const revoke = (held: HeldGrant | null) => {
    if (held) void send('preview.grant.revoke', { grant: held.grant });
  };

  async function mint(next: MintRequest): Promise<void> {
    request = next;
    const mine = ++turn;
    set({ kind: 'minting' });
    const answer = await send('preview.grant.mint', next);
    if (!answer || mine !== turn) return;
    if (answer.status === 401) return endSession(false);
    const data = answer.data;
    if (answer.status === 200 && data?.status === 'active') {
      revoke(current);
      current = {
        grant: data.grant as string,
        nonce: data.nonce as string,
        idleExpiresAt: data.idleExpiresAt,
      };
      set({ kind: 'active', grant: current.grant, nonce: current.nonce });
      return schedule();
    }
    if (answer.status === 200 && data?.status === 'preview_blocked') {
      const kept = current ? { grant: current.grant, nonce: current.nonce } : null;
      return set({ kind: 'blocked', diagnostics: Number(data.diagnostics), kept });
    }
    revoke(current);
    current = null;
    clearTimer(timer);
    set({ kind: 'failed' });
  }

  /** What a renewal or a status check found, acted on. */
  const act = async (status: unknown) => {
    if (status === 'session_ended') return endSession(true);
    if (typeof status === 'string' && REMINT.has(status) && request) return mint(request);
  };

  async function renew(held: Current): Promise<void> {
    const answer = await send('preview.grant.renew', { grant: held.grant });
    if (!answer || current?.grant !== held.grant) return;
    if (answer.status === 401) return endSession(false);
    if (answer.status === 200 && answer.data?.status === 'active') {
      current = { ...held, idleExpiresAt: answer.data.idleExpiresAt };
      return schedule();
    }
    if (answer.status === 200) return act(answer.data?.status);
    // The renewal itself failed: ask what the grant is.
    return check();
  }

  async function check(): Promise<void> {
    const held = current;
    if (!held) return;
    const answer = await send('preview.grant.status', { grant: held.grant });
    if (!answer || current?.grant !== held.grant) return;
    if (answer.status === 401) return endSession(false);
    if (answer.status === 200) return act(answer.data?.status);
  }

  return {
    mint,
    check,
    end: () => endSession(false),
    stop() {
      clearTimer(timer);
      revoke(current);
      current = null;
      stopped = true;
    },
  };
}
