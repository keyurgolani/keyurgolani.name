'use client';

// @portfolio/kit/enhancements (#5, Slice 2): a variant's enhancements, loaded
// in the browser after the page is readable and never needed to read it. #6's
// EnhancementIsland wraps <Enhancement> and decides when to load.

import type { VariantRenderInput } from '@portfolio/variant-contract';
import { EnhancementBoundary, MountedEnhancement } from './load';

export { EnhancementIsland, type EnhancementIslandProps } from './island';

export interface EnhancementProps {
  /** The render input, as the variant got it. */
  readonly input: VariantRenderInput;
  /** An enhancement id the rendering variant's manifest declares. */
  readonly id: string;
}

/**
 * The enhancement `id` the rendering variant's manifest declares. It's a
 * client component, so a variant's server component renders it like any
 * element, `<Enhancement input={input} id="orbit" />`, and its props cross to
 * the browser as JSON. On the server and while the page hydrates it renders
 * only its settle signal, an inert `<template data-enhancement-pending>`
 * (@portfolio/variant-contract/settle), then lazy-loads the module the host
 * registered for it through registerHostModules(), and drops the signal at
 * the task boundary after the enhancement's first commit, once it has
 * attached: a task boundary, not a frame and not a time. If that module fails to load or throws, the variant
 * declares no such enhancement, or globalThis.__portfolioFailEnhancements is
 * set, it renders nothing, its signal with it, and the page stays as it
 * was; it also takes its id off any hold the variant's own markup renders
 * for it (@portfolio/variant-contract/settle), as it does when the boundary
 * turns enhancements off.
 */
export function Enhancement({ input, id }: EnhancementProps) {
  return (
    <EnhancementBoundary key={`${input.variant}/${id}`} variant={input.variant} id={id}>
      <MountedEnhancement input={input} id={id} pending />
    </EnhancementBoundary>
  );
}
