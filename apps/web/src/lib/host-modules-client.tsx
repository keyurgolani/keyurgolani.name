'use client';

import { registerHostModules } from '@portfolio/kit/sections';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';
import { EXTENSION_RENDERERS } from './generated/registry.extensions';

// host-modules.ts's maps, registered in the browser (#5, Slice 3), where
// <Enhancement> loads a variant's enhancement modules. The root layout
// renders <ClientHostModules />, so this module runs on every page before
// anything below it hydrates.

registerHostModules({
  extensionRenderers: EXTENSION_RENDERERS,
  enhancementLoaders: ENHANCEMENT_LOADERS,
});

/** Renders nothing: loading this module is what registers the maps. */
export function ClientHostModules() {
  return null;
}
