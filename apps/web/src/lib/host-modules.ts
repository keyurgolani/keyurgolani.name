import { registerHostModules } from '@portfolio/kit/sections';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';
import { EXTENSION_RENDERERS } from './generated/registry.extensions';

// The package code the kit reaches, registered on the server (#5, Slice 3):
// each content extension's section renderers and each variant's enhancement
// loaders. Importing this module registers them; render-composition.tsx does,
// before any variant renders. host-modules-client.tsx registers the same two
// maps in the browser.

registerHostModules({
  extensionRenderers: EXTENSION_RENDERERS,
  enhancementLoaders: ENHANCEMENT_LOADERS,
});
