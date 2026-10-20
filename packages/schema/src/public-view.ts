import {
  createExtensionRegistry,
  type ContentExtension,
  type ExtensionRegistry,
} from './extensions';
import { parseExtensionKind } from './ids';
import { isPlainObject } from './json';
import type { Portfolio } from './portfolio';
import type { Site } from './site';

// What visitors may see of a publication unit (#4, item 16). Variants, the
// JSON-LD, the feed, and the Open Graph image read only this view.

/** A portfolio and site document that both parsed. */
export interface ParsedPair {
  readonly portfolio: Portfolio;
  readonly site: Site;
}

declare const PUBLIC: unique symbol;

/**
 * A document as visitors may see it. Only toPublicView() makes one, so a
 * renderer that takes it can't be handed a parsed document directly. The
 * brand is a type alone; nothing at run time carries it.
 */
export type Public<T> = T & { readonly [PUBLIC]: true };

/** The portfolio a renderer takes: no hidden section and no unregistered extension data. */
export type PublicPortfolio = Public<Portfolio>;

/** The pair with hidden sections and unregistered extension data taken out. */
export interface PublicView {
  readonly portfolio: PublicPortfolio;
  readonly site: Public<Site>;
}

export interface PublicViewContext {
  /** The content extensions this build registers. Data from any other is dropped. */
  readonly extensions?: readonly ContentExtension[];
}

/**
 * Drops every section `site.sections.<id>.hidden` hides, every section of an
 * unregistered extension, and every `extensions` entry an unregistered
 * extension owns, in both documents. The pair itself is left as it was.
 */
export function toPublicView(pair: ParsedPair, context: PublicViewContext = {}): PublicView {
  const registry = createExtensionRegistry(context.extensions ?? []);
  const hidden = new Set(
    Object.entries(pair.site.sections ?? {})
      .filter(([, settings]) => settings.hidden === true)
      .map(([id]) => id),
  );
  const sections = pair.portfolio.sections.filter((section) => {
    if (hidden.has(section.id)) return false;
    const extension = parseExtensionKind(section.kind);
    return !extension || registry.extension(extension.namespace) !== undefined;
  });
  return {
    portfolio: withoutUnregistered({ ...pair.portfolio, sections }, registry) as PublicPortfolio,
    site: withoutUnregistered(pair.site, registry) as Public<Site>,
  };
}

/**
 * A copy without the `extensions` entries no registered extension owns. It
 * never looks inside extension data or `variantControls.<id>.values`, which
 * hold whatever keys their owners chose.
 */
function withoutUnregistered<T>(value: T, registry: ExtensionRegistry): T {
  const walk = (node: unknown, path: readonly (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((child, index) => walk(child, [...path, index]));
    if (!isPlainObject(node)) return node;
    const extensionSection = typeof node.kind === 'string' && parseExtensionKind(node.kind);
    const control = path.length === 2 && path[0] === 'variantControls';
    const entries: Array<[string, unknown]> = [];
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' && isPlainObject(child)) {
        const kept = Object.entries(child).filter(([namespace]) => registry.extension(namespace));
        if (kept.length > 0) entries.push([key, Object.fromEntries(kept)]);
      } else if ((extensionSection && key === 'data') || (control && key === 'values')) {
        entries.push([key, child]);
      } else {
        entries.push([key, walk(child, [...path, key])]);
      }
    }
    // fromEntries, so an own __proto__ key stays a key.
    return Object.fromEntries(entries);
  };
  return walk(value, []) as T;
}
