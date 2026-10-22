'use client';

import { registerHostModules } from '@portfolio/kit/sections';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';
import { EXTENSION_RENDERERS } from './generated/registry.renderers';

// The package code the kit reaches in the browser (#5, Slices 3 and 6): the
// enhancement loaders <Enhancement> loads a variant's enhancements through,
// each its own import(), so each loads only once a page that renders it has
// hydrated; and each content extension's section renderers, the ones
// host-modules.ts registers on the server, so a render in the browser reaches
// the same package code as the server's. The host's pages render their
// sections on the server; render parity's createRoot render, #7's preview
// frame, and #9's in-browser render use both. The root layout renders
// <ClientHostModules />, so this module runs on every page before anything
// below it hydrates.

registerHostModules({
  extensionRenderers: EXTENSION_RENDERERS,
  enhancementLoaders: ENHANCEMENT_LOADERS,
});

/** Renders nothing: loading this module is what registers the maps. */
export function ClientHostModules() {
  return null;
}
