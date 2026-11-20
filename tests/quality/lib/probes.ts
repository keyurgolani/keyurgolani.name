// What a failure record says about the element it's on (#11, Slice 1, item
// 10), read in the page: its ARIA role, as axe computes it, its accessible
// name, as Chromium's accessibility tree has it on Chromium and as axe
// computes it on another engine, the #19 slot it's in, and its token role,
// the boundary token its rendered color is, or `hard-coded` when it's none
// of them. Every page renders in #19's document boundary (#19, Slice 4), so
// an element inside it has a token role; one outside any boundary, as
// Studio's are, has none.
import type { CDPSession, Page } from '@playwright/test';

/** The color properties a token role is matched on, by the rule that failed. */
export type ColorProperty = 'color' | 'background-color' | 'border-color' | 'outline-color';

export interface ElementDetails {
  readonly found: boolean;
  /** Its ARIA role, explicit or implicit, as axe gets it. */
  readonly semanticRole?: string;
  /**
   * Its accessible name. elementDetails() gives Chromium's accessibility tree's on Chromium, what a
   * screen reader there hears; elementDetailsScript() alone, and another engine, give axe's.
   */
  readonly accessibleName?: string;
  /** The nearest data-ui-slot, the element's or an ancestor's (#19's slots). */
  readonly uiSlot?: string;
  /** The boundary color role its color is, `hard-coded`, or nothing without a boundary. */
  readonly tokenRole?: string;
}

interface AxeGlobal {
  setup(node?: Element | Document): unknown;
  teardown(): void;
  commons: {
    aria: { getRole(element: Element): string | null };
    text: { accessibleText(element: Element): string };
  };
}

/**
 * The details of each element `selectors` names, with the token role
 * matched on `property`, or none when it's null: a rule that isn't about
 * color. `roles` are the token contract's color roles, as --color-<role>.
 * Runs in the browser, after axe ran there, so window.axe is set; without
 * it, role and name stay unset.
 */
export function elementDetailsScript(args: {
  readonly selectors: readonly string[];
  readonly property: ColorProperty | null;
  readonly roles: readonly string[];
}): ElementDetails[] {
  const axe = (window as unknown as { axe?: AxeGlobal }).axe;
  if (axe) axe.setup(document);
  try {
    return args.selectors.map((selector) => {
      let element: Element | null = null;
      try {
        element = document.querySelector(selector);
      } catch {
        element = null;
      }
      if (!element) return { found: false };
      const boundary = element.closest('[data-appearance-boundary]');
      let tokenRole: string | undefined;
      if (boundary && args.property !== null) {
        const rendered = getComputedStyle(element).getPropertyValue(args.property);
        // Each role's value as the boundary resolves it, normalized by the
        // browser the way the element's own color is.
        const probe = document.createElement('span');
        probe.hidden = true;
        boundary.append(probe);
        const defined = getComputedStyle(boundary);
        tokenRole = 'hard-coded';
        for (const role of args.roles) {
          // An unset role would leave the probe inheriting the boundary's
          // color, which could match the element's by accident.
          if (defined.getPropertyValue(`--color-${role}`).trim() === '') continue;
          probe.style.setProperty('color', `var(--color-${role})`);
          if (getComputedStyle(probe).color === rendered) {
            tokenRole = role;
            break;
          }
        }
        probe.remove();
      }
      const slot = element.closest('[data-ui-slot]')?.getAttribute('data-ui-slot') ?? undefined;
      return {
        found: true,
        semanticRole: axe?.commons.aria.getRole(element) ?? undefined,
        accessibleName: axe
          ? axe.commons.text.accessibleText(element).trim() || undefined
          : undefined,
        uiSlot: slot,
        tokenRole,
      };
    });
  } finally {
    if (axe) axe.teardown();
  }
}

/**
 * The details of each element `args.selectors` names in `page`, read by elementDetailsScript, with
 * each one's accessible name taken from Chromium's accessibility tree where the tree has one.
 * axe's accname spaces a child only when its tag isn't phrasing content, so two spans laid out as
 * flex items read as one word ("More1"); Chromium's tree spaces them by their layout ("More 1").
 * The names never fail a cell: any CDP error, empty node or call past CDP_CALL_MS keeps axe's.
 */
export async function elementDetails(
  page: Page,
  args: Parameters<typeof elementDetailsScript>[0],
): Promise<ElementDetails[]> {
  const details = await page.evaluate(elementDetailsScript, args);
  return withNames(details, await chromiumNames(page, args.selectors));
}

/** `details` with each found element's accessible name replaced by its entry in `names`, if any. */
export function withNames(
  details: readonly ElementDetails[],
  names: readonly (string | undefined)[],
): ElementDetails[] {
  return details.map((detail, index) => {
    const name = detail.found ? names[index] : undefined;
    return name === undefined ? detail : { ...detail, accessibleName: name };
  });
}

/** How long one CDP call for a name has before it's given up, and axe's name kept. */
export const CDP_CALL_MS = 2_000;

/** What the names overlay sends its CDP calls through: a CDPSession, or a unit's stand-in. */
export interface NameSession {
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Whether the overlay is off for a page: its first timeout or session error turns it off. */
export interface NameBreaker {
  off: boolean;
}

/** A page's names over CDP: its one session, opened on its first read, and its breaker. */
interface NameState {
  readonly session: Promise<NameSession | null>;
  readonly breaker: NameBreaker;
}

/** Each page's state, until closeNameSession() detaches its session at the cell's end. */
const states = new WeakMap<Page, NameState>();

/** `call`, rejected once it runs past `ms`. */
function bounded<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`a CDP call ran past ${ms} ms`)), ms);
  });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}

/** `page`'s state: no session on another engine than Chromium, and the breaker off if none opens. */
function nameState(page: Page): NameState {
  let state = states.get(page);
  if (!state) {
    const breaker: NameBreaker = { off: false };
    const engine = page.context().browser()?.browserType().name();
    const session: Promise<NameSession | null> =
      engine !== undefined && engine !== 'chromium'
        ? Promise.resolve(null)
        : bounded(page.context().newCDPSession(page), CDP_CALL_MS).catch(() => {
            breaker.off = true;
            return null;
          });
    state = { session, breaker };
    states.set(page, state);
  }
  return state;
}

/** Detaches `page`'s name session, if a read opened one: a cell does at its end. It never throws. */
export async function closeNameSession(page: Page): Promise<void> {
  const state = states.get(page);
  states.delete(page);
  const session = (await state?.session.catch(() => null)) as CDPSession | null | undefined;
  await session?.detach().catch(() => undefined);
}

/**
 * Each selector's element's accessible name in Chromium's accessibility tree, over `page`'s one
 * CDP session. DOM.querySelector, like the document.querySelector elementDetailsScript reads with,
 * takes a selector's first match in document order, so both read the same element. Undefined for
 * one the document no longer holds or the tree doesn't name, for every one on another engine, and
 * for every one once the page's breaker is off.
 */
export async function chromiumNames(
  page: Page,
  selectors: readonly string[],
): Promise<(string | undefined)[]> {
  if (selectors.length === 0) return [];
  const { session, breaker } = nameState(page);
  const cdp = breaker.off ? null : await session;
  return cdp ? namesOver(cdp, selectors, breaker) : selectors.map(() => undefined);
}

/**
 * Each selector's name over `session`, each call bounded by `ms`. The first call that times out
 * or fails turns `breaker` off: that one and every element after it keep axe's name, and no
 * further call goes out on the page, in this read or a later one of its cell.
 */
export async function namesOver(
  session: NameSession,
  selectors: readonly string[],
  breaker: NameBreaker,
  ms: number = CDP_CALL_MS,
): Promise<(string | undefined)[]> {
  const names: (string | undefined)[] = selectors.map(() => undefined);
  if (breaker.off) return names;
  const call = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    try {
      return await bounded(session.send(method, params), ms);
    } catch (error) {
      breaker.off = true;
      throw error;
    }
  };
  try {
    const document = (await call('DOM.getDocument', { depth: 0 })) as {
      root?: { nodeId?: unknown };
    };
    const root = document?.root?.nodeId;
    if (typeof root !== 'number') return names;
    for (const [index, selector] of selectors.entries()) {
      const found = (await call('DOM.querySelector', { nodeId: root, selector })) as {
        nodeId?: unknown;
      };
      const nodeId = found?.nodeId;
      if (typeof nodeId !== 'number' || nodeId === 0) continue;
      const tree = (await call('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      })) as { nodes?: readonly { name?: { value?: unknown } }[] };
      const value = tree?.nodes?.[0]?.name?.value;
      if (typeof value === 'string' && value.trim() !== '') names[index] = value.trim();
    }
  } catch {
    // The breaker is off: every name not read yet keeps axe's.
  }
  return names;
}

/** The resolved tokens of each boundary on the page: its kind, its selection, and every --color-*, --ui-*, and --type-* value. Runs in the browser. */
export function resolvedTokensScript(properties: readonly string[]): {
  readonly boundaries: {
    readonly kind: string | null;
    readonly attributes: Record<string, string>;
    readonly tokens: Record<string, string>;
  }[];
} {
  return {
    boundaries: [...document.querySelectorAll('[data-appearance-boundary]')].map((boundary) => {
      const style = getComputedStyle(boundary);
      const attributes: Record<string, string> = {};
      for (const { name, value } of boundary.attributes) {
        if (name.startsWith('data-')) attributes[name] = value;
      }
      const tokens: Record<string, string> = {};
      for (const property of properties) {
        const value = style.getPropertyValue(property).trim();
        if (value) tokens[property] = value;
      }
      return { kind: boundary.getAttribute('data-appearance-boundary'), attributes, tokens };
    }),
  };
}
