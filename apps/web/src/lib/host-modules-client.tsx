'use client';

import { registerHostModules } from '@portfolio/kit/sections';
import { ENHANCEMENT_LOADERS } from './generated/registry.enhancements';

// The enhancement loaders host-modules.ts registers, registered in the
// browser (#5, Slice 3), where <Enhancement> loads a variant's enhancement
// modules. Sections render on the server, so the client gets no extension
// renderers: only what it renders itself. The root layout renders
// <ClientHostModules />, so this module runs on every page before anything
// below it hydrates.

registerHostModules({ enhancementLoaders: ENHANCEMENT_LOADERS });

/** Renders nothing: loading this module is what registers the loaders. */
export function ClientHostModules() {
  return null;
}
