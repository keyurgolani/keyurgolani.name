import { DISCARD_LABEL, SIGN_OUT_ACTION } from '../sign-out-form';

// Studio's late alert, as markup the server can send. When the shell's chunks are still
// on their way after STUDIO_LOAD_TIMEOUT_MS, "Studio couldn't load." shows in a <studio-load-late>
// element of its own (late-alert.tsx). Its clock can't depend on the code that's late: the Flight
// client evaluates none of the page's client modules until every chunk they need has arrived, so a
// chunk that stalls (the owner shell's 44dd-qmnz83wu.js at 8ea4d003a, through e.v()) leaves the
// page on the server's markup with no module to start one. So the page sends its own clock: one
// inline script, nonced under Studio's existing script-src (no CSP change, no 'unsafe-inline'),
// which StudioLoadBoundary renders and the HTML parser runs. It shows this markup at the timeout
// unless the entry adopted the clock first; late-alert.tsx adopts it when it evaluates. Both build
// the alert from lateAlertHTML, here, the one source of its markup; the boundary's own alert
// (StudioLoadAlert in late-alert.tsx) renders the same, as late-markup.test.tsx pins.
//
// It imports nothing that renders, nothing of Owner Studio's, and nothing that reads a request: the
// server serialises it into the page, and the page's entry loads it.

/** How long a shell, or the owner adapter it loads, may take before Studio says it couldn't load. */
export const STUDIO_LOAD_TIMEOUT_MS = 5_000;

/** The late alert's element, a direct child of <body>: a custom tag, which hydration never claims. */
export const LATE_ALERT_TAG = 'studio-load-late';

/**
 * The late alert's Reload Studio, as both clocks find it. Each listens for its click on window in the
 * capture phase, ahead of the page's root: while React's root is still dehydrated it stops a click's
 * propagation at the document, so a listener on the button itself never ran. The listener answers a
 * click on this control alone, and stops or prevents nothing.
 */
export const RELOAD_SELECTOR = '[data-studio-reload]';

/** Where the inline clock keeps its state on window, for late-alert.tsx to adopt. */
export const LATE_CLOCK_KEY = 'portfolioStudioLateClock';

/** The words the alert says. */
export const LATE_ALERT_TEXT = {
  name: 'Portfolio Studio',
  message: "Studio couldn't load.",
  reload: 'Reload Studio',
  signOut: 'Sign out',
} as const;

/** The inline clock's state: the page's entry adopts it, or it showed the alert itself. */
export interface InlineLateClock {
  /** performance.now() when the HTML parser ran the script. */
  readonly startedAt: number;
  /** The <studio-load-late> it put in <body>, once it showed. */
  node: HTMLElement | null;
  /** Whether its Reload Studio was pressed: the page is reloading. */
  pressed: boolean;
  /** Stops its timer: the entry's clock runs from here, from the same start. */
  readonly cancel: () => void;
}

/** Text as HTML text, the way React's server renderer escapes it. */
function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * The late alert's markup: Studio's name as an h1, and the alert with Reload Studio and, under
 * owner, the plain Sign out form (sign-out-form.tsx's SignOutForm: a post to auth.logout, which
 * takes a form without a CSRF token on the exact Origin with Sec-Fetch-Site same-origin, so it
 * needs no per-request value). A plain box, not the page's main: the server's shell, hidden, keeps
 * its own main in the page.
 */
export function lateAlertHTML(profile: string | null): string {
  const signOut =
    profile === 'owner'
      ? `<form class="studio-sign-out" action="${SIGN_OUT_ACTION}" method="post">` +
        `<button type="submit" class="studio-button studio-button--quiet">${text(LATE_ALERT_TEXT.signOut)}</button>` +
        `<button type="submit" value="discard" class="studio-button studio-button--quiet" name="choice">${text(DISCARD_LABEL)}</button>` +
        `</form>`
      : '';
  return (
    `<div class="studio-shell__main" id="studio-load-failure" tabindex="-1">` +
    `<h1 class="studio-shell__name">${text(LATE_ALERT_TEXT.name)}</h1>` +
    `<div class="studio-alert" role="alert"><p>${text(LATE_ALERT_TEXT.message)}</p>` +
    `<div class="studio-alert__actions">` +
    `<button type="button" class="studio-button" data-studio-reload="">${text(LATE_ALERT_TEXT.reload)}</button>` +
    signOut +
    `</div></div></div>`
  );
}

/** A JSON string literal that is safe inside a <script> element. */
function scriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The page's inline clock, as script source: at HTML parse it starts STUDIO_LOAD_TIMEOUT_MS and
 * keeps its state at window[LATE_CLOCK_KEY]. At the timeout, if the entry hasn't adopted it (which
 * cancels its timer), it puts <studio-load-late> in <body> with lateAlertHTML(profile), focuses
 * Reload Studio, and reloads on that control's click, heard on window in the capture phase
 * (RELOAD_SELECTOR). It reads no cookie, no storage, and nothing from the network: only the markup
 * the server put in it.
 */
export function inlineLateClockScript(profile: string | null): string {
  return (
    `(function(){var w=window,k=${scriptString(LATE_CLOCK_KEY)};if(w[k])return;` +
    `var t,c={startedAt:performance.now(),node:null,pressed:false,cancel:function(){clearTimeout(t)}};w[k]=c;` +
    `t=setTimeout(function(){var n=document.createElement(${scriptString(LATE_ALERT_TAG)});` +
    `n.innerHTML=${scriptString(lateAlertHTML(profile))};document.body.appendChild(n);c.node=n;` +
    `var b=n.querySelector(${scriptString(RELOAD_SELECTOR)});if(b){w.addEventListener("click",function(e){var x=e.target;if(x&&x.closest&&x.closest(${scriptString(RELOAD_SELECTOR)})===b){c.pressed=true;location.reload()}},true);b.focus()}` +
    `},${STUDIO_LOAD_TIMEOUT_MS})})();`
  );
}
