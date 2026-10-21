'use client';

// @portfolio/kit/enhancements (#5, Slice 2): a variant's enhancements, loaded
// in the browser after the page is readable and never needed to read it. #6's
// EnhancementIsland wraps loadEnhancement() and decides when to load.

import type { ReactElement } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Enhancement, EnhancementBoundary } from './load';

/**
 * The enhancement `id` the rendering variant's manifest declares. It renders
 * nothing on the server and while the page hydrates, then lazy-loads the
 * module the host registered for it through registerHostModules(). If that
 * module fails to load or throws, the variant declares no such enhancement, or
 * globalThis.__portfolioFailEnhancements is set, it renders nothing and the
 * page stays as it was.
 */
export function loadEnhancement(input: VariantRenderInput, id: string): ReactElement {
  return (
    <EnhancementBoundary key={`${input.variant}/${id}`}>
      <Enhancement input={input} id={id} />
    </EnhancementBoundary>
  );
}
