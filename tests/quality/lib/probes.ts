// What a failure record says about the element it's on (#11, Slice 1, item
// 10), read in the page: its ARIA role and accessible name, as axe computes
// them, the #19 slot it's in, and its token role, the boundary token its
// rendered color is, or `hard-coded` when it's none of them. The host
// renders #19's presentation boundary only from #19 slice 4, so on today's
// site pages an element has no boundary and no token role; on the
// /_fixtures/appearance page, which renders the boundary, every one has one.

/** The color properties a token role is matched on, by the rule that failed. */
export type ColorProperty = 'color' | 'background-color' | 'border-color' | 'outline-color';

export interface ElementDetails {
  readonly found: boolean;
  /** Its ARIA role, explicit or implicit, as axe gets it. */
  readonly semanticRole?: string;
  /** Its accessible name, as axe computes it. */
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
