'use client';

// Through its own subpath, not the sections barrel, so the page's client
// chunk holds the registry and nothing else of the kit's (#6, Slice 2).
import { registerHostModules } from '@portfolio/kit/host-modules';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';
import { EXTENSION_RENDERERS } from './generated/registry.renderers';

// The package code the kit reaches in the browser (#5, Slices 3 and 6): the
// enhancement loaders <Enhancement> loads a variant's enhancements through,
// each its own import(), so each loads only once a page that renders it has
// hydrated; and each content extension's section renderers, the ones
// host-modules.ts registers on the server, so a render in the browser reaches
// the same package code as the server's. The host's pages render their
// sections on the server; render parity's createRoot render, #7's preview
// frame, and #9's in-browser render use both. ExperienceDocument renders
// <ClientHostModules />, so this module runs on every page that shows a
// composition, a visitor's and a preview's, before anything below it
// hydrates. That puts every content extension's ./renderers in the browser
// on those pages, so it must be client-safe: a server-only import there
// breaks `next build` (docs/configuration.md).

registerHostModules({
  extensionRenderers: EXTENSION_RENDERERS,
  enhancementLoaders: ENHANCEMENT_LOADERS,
});

/** Renders nothing: loading this module is what registers the maps. */
export function ClientHostModules() {
  return null;
}
