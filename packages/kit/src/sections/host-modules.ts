import type { ComponentType } from 'react';
import type { ExtensionSection } from '@portfolio/schema';
import { parseExtensionKind } from '@portfolio/schema/ids';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { SectionRenderer } from './types';

// The kit can't import the host, so the host hands it the package code it
// reaches: content extensions' renderers and variants' enhancement modules
// (#5, Slice 2). The host, #7's frame, and the parity renders each call
// registerHostModules() once from a server module, with the renderers, and
// once from a client module, with both (Slices 3 and 6): <Enhancement> loads
// nothing on the server, and a server module that named the loaders would
// ship every enhancement with the page. A second call replaces the first.

/** What an enhancement module default-exports. */
export type EnhancementComponent = ComponentType<{ readonly input: VariantRenderInput }>;

/** Loads one enhancement module, as `() => import('<package>/enhancements/<id>')`. */
export type EnhancementLoader = () => Promise<{ readonly default: EnhancementComponent }>;

export interface HostModules {
  /** Each registered content extension's renderers, keyed by section kind: `<namespace>/<name>`. */
  readonly extensionRenderers?: Readonly<Record<string, SectionRenderer<ExtensionSection>>>;
  /** Each declared enhancement's loader, keyed `<variant id>/<enhancement id>`. */
  readonly enhancementLoaders?: Readonly<Record<string, EnhancementLoader>>;
  /**
   * What fills every VisitorControlSlot (#19, Slice 4): the host's visitor
   * appearance control, which takes no props and renders nothing where the
   * page has no control to show, as in a preview.
   */
  readonly visitorControl?: ComponentType;
}

const ENHANCEMENT_KEY = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

let registered: HostModules = {};

/** Hands the kit the package code renderSection() and <Enhancement> reach. */
export function registerHostModules(modules: HostModules): void {
  for (const kind of Object.keys(modules.extensionRenderers ?? {})) {
    if (!parseExtensionKind(kind)) {
      throw new TypeError(`${kind} isn't an extension section kind, <namespace>/<name>.`);
    }
  }
  for (const key of Object.keys(modules.enhancementLoaders ?? {})) {
    if (!ENHANCEMENT_KEY.test(key)) {
      throw new TypeError(`${key} isn't an enhancement key, <variant id>/<enhancement id>.`);
    }
  }
  registered = {
    extensionRenderers: { ...modules.extensionRenderers },
    enhancementLoaders: { ...modules.enhancementLoaders },
    ...(modules.visitorControl ? { visitorControl: modules.visitorControl } : {}),
  };
}

/** What the host registered. Kit modules read it; nothing else should. */
export function hostModules(): HostModules {
  return registered;
}
