import type { ComponentType, ReactNode } from 'react';
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
   * appearance control, which renders nothing where the page has no control
   * to show, as in a preview. `inMenu` is the copy a NavigationMenuSlot
   * hands the host's Menu, which renders while the Menu holds the control.
   */
  readonly visitorControl?: ComponentType<{ readonly inMenu?: boolean }>;
  /**
   * What fills every NavigationMenuSlot (stream A, global rule 7): the
   * host's Menu, a modal dialog of the links it's given that closes when one
   * is followed. Without one, the slot is a plain link to `href`.
   */
  readonly navigationMenu?: ComponentType<HostNavigationMenuProps>;
}

/** What the host's Menu gets: the slot's props, and the visitor's control to move in when asked. */
export interface HostNavigationMenuProps extends NavigationMenuProps {
  /**
   * The registered visitor control, as an element the Menu renders at its
   * end while it holds the control. None when the composition doesn't ask
   * (`visitorControl`) or the host registers no control.
   */
  readonly control?: ReactNode;
}

/** What a NavigationMenuSlot passes the host's Menu. Plain data and server-rendered links only. */
export interface NavigationMenuProps {
  /**
   * The menu's local id: lowercase words joined by single hyphens, one no
   * content id takes. The host's Menu adds the boundary's prefix.
   */
  readonly id: string;
  /** What the Menu's button says, and the dialog's title, such as "Menu". */
  readonly label: string;
  /** The label's language, when it isn't the page's, such as `en` for the kit's own words. */
  readonly lang?: string;
  /**
   * A real link to the same places on the page, such as `#<prefix>index`
   * for the composition's own index: the slot is this link when the host
   * registers no Menu, and the Menu falls back to it where scripts don't run.
   */
  readonly href: string;
  /** The Menu's content: real links to places on the page, in the composition's own markup. */
  readonly children: ReactNode;
  /**
   * Move the visitor's appearance control into the Menu, at its end, while
   * `media` matches: the media query under which the composition shows its
   * Menu instead of its destinations, such as `(width < 48rem)`. Its
   * VisitorControlSlot then renders nothing, so the chrome is the name and
   * the Menu. Where scripts don't run, the control stays in the slot.
   */
  readonly visitorControl?: { readonly media: string };
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
    ...(modules.navigationMenu ? { navigationMenu: modules.navigationMenu } : {}),
  };
}

/** What the host registered. Kit modules read it; nothing else should. */
export function hostModules(): HostModules {
  return registered;
}
