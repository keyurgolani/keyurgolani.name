// What the pack-distinctness guard reads from a build and a browser (LANG-3):
// the packs the build registers on the guarded axis, each as an AxisPack
// (its family and token vector, pack-distinct.ts), the looks that render
// them on one composition with the other axes at distinct-capture.ts's tuple,
// how many language tokens a rendered first viewport uses, and the specimen
// sheets the report shows. Rendering itself is distinct-capture.ts's
// captureComposition(): one server for the composition, each look a visitor
// cookie, reduced motion, Math.random seeded, at 1440x900 and 390x844.

import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  aliasOf,
  createAppearanceRegistry,
  PACK_KIND_BY_AXIS,
  selectableIds,
} from '../../packages/appearance/src/index';
import type { AppearanceRegistry, ExcludedPack } from '../../packages/appearance/src/registry';
import { accepts, readBuildMeta } from '../quality/cells';
import { DEFAULT_LOOK, type Look } from './distinct-capture';
import { COLOR_ROLES } from '../../packages/appearance/src/roles';
import {
  AXES,
  genericFamily,
  renderedRoleColors,
  languageVector,
  schemeVector,
  SURFACE_SELECTOR,
  typographyVector,
  type AxisPack,
  type GuardAxis,
  type SurfaceProbe,
} from './pack-distinct';
import { WEB } from './target';

/** The build's appearance registry. */
export const buildRegistry = (web = WEB): AppearanceRegistry =>
  createAppearanceRegistry(readBuildMeta(web) as never);

let schemes: AppearanceRegistry | undefined;
/**
 * A color scheme's one base mode, when it has only one (iridescent-pearl and
 * poster-primaries are light only; liquid-dusk, neon-city, and oled-black dark
 * only): such a scheme locks the display mode to it, so the system mode the
 * guards' tuple asks for would render as that mode instead.
 */
export function onlyMode(id: string): string | undefined {
  schemes ??= buildRegistry();
  const modes = schemes.packs.colorScheme.get(id)?.modes ?? [];
  return modes.length === 1 ? modes[0] : undefined;
}

/**
 * The look that renders `id` on `axis`, every other axis at the guards'
 * tuple, except that a color scheme with one base mode renders in it
 * (onlyMode()), the mode it locks to.
 */
export function packLook(axis: GuardAxis, id: string): Look {
  const mode = axis === 'colorScheme' ? onlyMode(id) : undefined;
  return {
    ...DEFAULT_LOOK,
    name: `pack-${id}`,
    [axis]: id,
    ...(mode ? { displayMode: mode } : {}),
  };
}

/**
 * A color scheme's dark look (LANG-4): the scheme in the dark display mode,
 * every other axis at the guards' tuple, so its dark colors are read from
 * the render and its dark tiles sit beside the light ones.
 */
export const darkLook = (id: string): Look => ({
  ...packLook('colorScheme', id),
  name: `dark-${id}`,
  displayMode: 'dark',
});

/** The "same" controls' looks for `id`: a re-render, and each of the axis's other-axis changes. */
export function controlLooks(axis: GuardAxis, id: string): Look[] {
  return [
    { ...packLook(axis, id), name: `rerender-${id}` },
    ...AXES[axis].same.map((control) => ({
      ...packLook(axis, id),
      name: `${control.name}-${id}`,
      [control.axis]: control.value,
    })),
  ];
}

/** Whether `variant` renders `look` as asked, read-only. */
export const rendersAsAsked = (registry: AppearanceRegistry, variant: string, look: Look) =>
  accepts(
    registry,
    {
      variant,
      designLanguage: look.designLanguage,
      colorScheme: look.colorScheme,
      typography: look.typography,
      displayMode: look.displayMode,
    },
    'read-only',
  );

/**
 * The packs on `axis` the guard can't score, each with why: a generator
 * color scheme (brand-seed, hct-tonal, portfolio-artwork, profile-image)
 * has no palette of its own until the owner's appearance input generates
 * one, and with none the axis's fallback renders in its place, so the guard
 * would score the fallback under its name.
 */
export function unscorable(
  registry: AppearanceRegistry,
  axis: GuardAxis,
): { readonly id: string; readonly reason: string }[] {
  if (axis !== 'colorScheme') return [];
  return selectableIds(registry, axis).flatMap((id) =>
    registry.packs.colorScheme.get(id)?.manifest.generator
      ? [
          {
            id,
            reason:
              "a generator scheme: its colors come from the owner's appearance input, and with none the fallback renders in its place",
          },
        ]
      : [],
  );
}

/**
 * The packs on `axis` this build leaves out, each with why, such as
 * profile-image while it waits on the owner's reference record: the report
 * names them, and none is scored or counted as distinct. They're the
 * registry's own list when it carries one, else the build's generated
 * excluded-packs module, which the build meta doesn't include.
 */
export function excludedPacks(
  registry: AppearanceRegistry,
  axis: GuardAxis,
  web = WEB,
): { readonly id: string; readonly reason: string }[] {
  const own = registry.excluded?.[axis];
  if (own && own.size > 0) return [...own.values()].map(({ id, reason }) => ({ id, reason }));
  const file = path.join(web, 'src', 'lib', 'generated', 'excluded-packs.ts');
  if (!existsSync(file)) return [];
  // apps/web has no "type": "module", so its modules are CommonJS to Node, as readBuildMeta() reads them.
  const { EXCLUDED_PACKS } = createRequire(import.meta.url)(file) as {
    EXCLUDED_PACKS: readonly ExcludedPack[];
  };
  return EXCLUDED_PACKS.filter(({ kind }) => kind === PACK_KIND_BY_AXIS[axis]).map(
    ({ id, reason }) => ({ id, reason }),
  );
}

/**
 * The packs the build registers on `axis`, as the guard compares them: the
 * selectable ids, each with its family and token vector. A retired id
 * (LANG-1) is only an alias of its survivor and never registers, so it's
 * never rendered or scored; one that did would throw here. A typography
 * profile has no family, so its body face's generic family stands in.
 */
/**
 * Every selectable pack on `axis`, with its family and token vector. A
 * design language's material scores only with `scoreMaterial`
 * (detectMaterial()).
 */
export function axisPacks(
  registry: AppearanceRegistry,
  axis: GuardAxis,
  scoreMaterial = false,
): AxisPack[] {
  const ids = selectableIds(registry, axis);
  const retired = ids.filter((id) => aliasOf(registry, axis, id) !== undefined);
  if (retired.length > 0) {
    throw new Error(`${retired.join(', ')} are retired aliases, and the guard scores none`);
  }
  return ids.map((id) => {
    if (axis === 'designLanguage') {
      const { manifest } = registry.packs.designLanguage.get(id)!;
      return {
        id,
        family: manifest.family ?? 'none',
        vector: languageVector(manifest.tokens, scoreMaterial),
      };
    }
    if (axis === 'colorScheme') {
      const entry = registry.packs.colorScheme.get(id)!;
      return {
        id,
        family: entry.manifest.family ?? 'none',
        vector: schemeVector(entry.sets),
        colors: entry.sets,
      };
    }
    const { manifest } = registry.packs.typography.get(id)!;
    const roles = manifest.roles as unknown as Record<string, Record<string, string | number>>;
    return {
      id,
      family: genericFamily(String(roles.body?.['font-family'] ?? '')),
      vector: typographyVector(roles),
    };
  });
}

/** How much of the guarded axis a first viewport shows: the composition choice's measure. */
export interface TokenUse {
  /** The distinct tokens at least one visible element's rules reach, sorted. */
  readonly tokens: readonly string[];
  /** Σ over visible elements of the distinct tokens each one's rules reach. */
  readonly uses: number;
  /** The visible elements any such rule reaches. */
  readonly elements: number;
  /**
   * Σ over those elements of the share of the first viewport each covers
   * times the distinct tokens it shows: how much of the viewport the tokens
   * paint, so a few dividers count for less than a page of cards.
   */
  readonly coverage: number;
}

/**
 * The tokens with `prefix` (--ui- for a design language) a settled page's
 * first viewport uses. It reads every style rule the page applies (inside
 * @media and @supports only when they match, nested rules with their
 * parent's selector), follows custom properties that reference the tokens
 * to the tokens they reach, and counts, for each element of the boundary
 * whose box is in the first viewport and visible, the tokens its matching
 * rules reach through a property that isn't custom. A rule for a state
 * (:hover, :focus) matches only in that state, so it doesn't count; a
 * pseudo-element's rule counts for its element. It runs in the page, reading
 * nothing from outside it.
 */
export function tokenUse({ prefix, skip }: { prefix: string; skip: readonly string[] }): TokenUse {
  type Rule = { selector: string; text: string };
  const rules: Rule[] = [];
  const walk = (list: CSSRuleList, parent: string | null) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        const own = rule.selectorText;
        const selector =
          parent === null
            ? own
            : own.includes('&')
              ? own.replaceAll('&', `:is(${parent})`)
              : `:is(${parent}) ${own}`;
        rules.push({ selector, text: rule.style.cssText });
        if (rule.cssRules?.length) walk(rule.cssRules, selector);
      } else if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, parent);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) walk(rule.cssRules, parent);
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        walk((rule as CSSGroupingRule).cssRules, parent);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, null);
    } catch {
      // A sheet the page can't read applies nothing the count can see.
    }
  }
  const declarations = (text: string) => {
    const out: [string, string][] = [];
    let depth = 0;
    let current = '';
    for (const character of `${text};`) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ';' && depth === 0) {
        const colon = current.indexOf(':');
        if (colon > 0) out.push([current.slice(0, colon).trim(), current.slice(colon + 1).trim()]);
        current = '';
        continue;
      }
      current += character;
    }
    return out;
  };
  const references = (value: string) =>
    [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);
  // Custom properties, and the properties they reference.
  const graph = new Map<string, Set<string>>();
  const parsed = rules.map((rule) => ({ ...rule, declarations: declarations(rule.text) }));
  for (const rule of parsed) {
    for (const [name, value] of rule.declarations) {
      if (!name.startsWith('--')) continue;
      const set = graph.get(name) ?? new Set<string>();
      for (const reference of references(value)) set.add(reference);
      graph.set(name, set);
    }
  }
  const reach = new Map<string, Set<string>>();
  const tokensOf = (name: string, seen = new Set<string>()): Set<string> => {
    const known = reach.get(name);
    if (known) return known;
    const out = new Set<string>();
    if (name.startsWith(prefix) && !skip.some((start) => name.startsWith(start))) out.add(name);
    if (!seen.has(name)) {
      seen.add(name);
      for (const reference of graph.get(name) ?? []) {
        for (const token of tokensOf(reference, seen)) out.add(token);
      }
    }
    reach.set(name, out);
    return out;
  };
  const using = parsed
    .map((rule) => {
      const tokens = new Set<string>();
      for (const [name, value] of rule.declarations) {
        if (name.startsWith('--')) continue;
        for (const reference of references(value)) {
          for (const token of tokensOf(reference)) tokens.add(token);
        }
      }
      const selector = rule.selector
        .replace(
          /::?(before|after|marker|placeholder|selection|backdrop|first-line|first-letter)\b/g,
          '',
        )
        .replace(/::part\([^)]*\)/g, '');
      return { selector: selector.trim() === '' ? '*' : selector, tokens };
    })
    .filter((rule) => rule.tokens.size > 0);
  const boundary = document.querySelector('[data-variant]') ?? document.body;
  const all = new Set<string>();
  let uses = 0;
  let elements = 0;
  let coverage = 0;
  for (const element of [boundary, ...Array.from(boundary.querySelectorAll('*'))]) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const own = new Set<string>();
    for (const rule of using) {
      let matches = false;
      try {
        matches = element.matches(rule.selector);
      } catch {
        matches = false;
      }
      if (matches) for (const token of rule.tokens) own.add(token);
    }
    if (own.size === 0) continue;
    elements += 1;
    uses += own.size;
    const width = Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left);
    const height = Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top);
    coverage += ((width * height) / (window.innerWidth * window.innerHeight)) * own.size;
    for (const token of own) all.add(token);
  }
  return { tokens: [...all].sort(), uses, elements, coverage: Math.round(coverage * 1000) / 1000 };
}

/**
 * The guarded axis's tokens, for tokenUse(): its prefix, less the tokens a
 * still can't show. A language's motion tokens only time transitions, and
 * the guard renders with motion reduced and shoots a settled frame.
 */
export const AXIS_TOKENS: Readonly<
  Record<GuardAxis, { readonly prefix: string; readonly skip: readonly string[] }>
> = {
  designLanguage: { prefix: '--ui-', skip: ['--ui-motion-'] },
  colorScheme: { prefix: '--color-', skip: [] },
  typography: { prefix: '--type-', skip: [] },
};

/**
 * The role colors a settled page's document boundary computes: each
 * `--color-<role>` of `roles`, as six-digit hex where it reads as one. It
 * runs in the page, reading nothing from outside it.
 */
export function roleColors(roles: readonly string[]): Record<string, string> {
  const boundary =
    document.querySelector('[data-appearance-boundary="document"]') ?? document.documentElement;
  const style = getComputedStyle(boundary);
  const out: Record<string, string> = {};
  for (const role of roles) {
    const value = style.getPropertyValue(`--color-${role}`).trim();
    if (value !== '') out[role] = value;
  }
  return out;
}

/**
 * Reads roleColors() from a settled page: every color role, each as hex,
 * and the problems, a scored role computed translucent among them
 * (pack-distinct.ts's renderedRoleColors()).
 */
export async function readRoleColors(
  page: Page,
): Promise<{ readonly colors: Record<string, string>; readonly problems: string[] }> {
  return renderedRoleColors(await page.evaluate(roleColors, [...COLOR_ROLES]));
}

/** Reads tokenUse() from a settled page. */
export const readTokenUse = (page: Page, axis: GuardAxis): Promise<TokenUse> =>
  page.evaluate(tokenUse, AXIS_TOKENS[axis]);

/**
 * What a settled page shows of the Surface primitive inside its
 * composition's boundary: the viewport's size, and each Surface's box and
 * whether it's visible (checkVisibility() with opacity and visibility, and
 * not inside a closed details or a hidden ancestor). It runs in the page;
 * surfaceShare() and detectMaterial() read it.
 */
export function surfaceProbe(selector: string): SurfaceProbe {
  const boundary = document.querySelector('[data-variant]') ?? document.body;
  const elements = Array.from(boundary.querySelectorAll(selector)).map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible =
      element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) > 0;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible };
  });
  return { width: window.innerWidth, height: window.innerHeight, elements };
}

/** Reads surfaceProbe() from a settled page. */
export const readSurfaceProbe = (page: Page): Promise<SurfaceProbe> =>
  page.evaluate(surfaceProbe, SURFACE_SELECTOR);

/** Writes a sheet's HTML to `file` and screenshots the whole of it to `png`, in a page of its own. */
export async function writeSheet(
  page: Page,
  html: string,
  file: string,
  png: string,
): Promise<void> {
  writeFileSync(file, html);
  await page.goto(`file://${file}`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: png, fullPage: true });
}
