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

/** The pair with hidden sections and unregistered extension data taken out. */
export type PublicView = ParsedPair;

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
    portfolio: withoutUnregistered({ ...pair.portfolio, sections }, registry),
    site: withoutUnregistered(pair.site, registry),
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
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' && isPlainObject(child)) {
        const kept = Object.entries(child).filter(([namespace]) => registry.extension(namespace));
        if (kept.length > 0) copy[key] = Object.fromEntries(kept);
      } else if ((extensionSection && key === 'data') || (control && key === 'values')) {
        copy[key] = child;
      } else {
        copy[key] = walk(child, [...path, key]);
      }
    }
    return copy;
  };
  return walk(value, []) as T;
}
