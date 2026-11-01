'use client';

// Through its own subpath, not the sections barrel, so the page's client
// chunk holds the registry and nothing else of the kit's (#6, Slice 2).
import { registerHostModules } from '@portfolio/kit/host-modules';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';
import { EXTENSION_RENDERERS } from './generated/registry.renderers';
import { SiteNavigationMenu } from './navigation-menu';

// The package code the kit reaches in the browser (#5, Slices 3 and 6): the
// enhancement loaders <Enhancement> loads a variant's enhancements through,
// each its own import(), so each loads only once a page that renders it has
// hydrated; and each content extension's section renderers, the ones
// host-modules.ts registers on the server, so a render in the browser reaches
// the same package code as the server's. The host's pages render their
// sections on the server; render parity's createRoot render, #7's preview
// frame, and #9's in-browser render use both. This module names every
// variant's enhancements, so only the routes that render whichever variant
// a request names hand it to ExperienceDocument: #7's preview frames and dev
// fixture route. A visitor page gets its experience segment's own module,
// which registry generation writes with that variant's enhancements alone
// (#6, Slice 2). Either one runs before anything below it hydrates, which
// puts every content extension's ./renderers in the browser, so it must be
// client-safe: a server-only import there breaks `next build`
// (docs/configuration.md).

// The host's Menu too, as host-modules.ts registers it: a composition's
// NavigationMenuSlot renders markup wherever it renders, unlike the visitor
// control, which renders nothing outside a visitor page, so a render in the
// browser draws the same Menu the server does (render parity, Slice 6).
registerHostModules({
  extensionRenderers: EXTENSION_RENDERERS,
  enhancementLoaders: ENHANCEMENT_LOADERS,
  navigationMenu: SiteNavigationMenu,
});

/** Renders nothing: loading this module is what registers the maps. */
export function ClientHostModules() {
  return null;
}
