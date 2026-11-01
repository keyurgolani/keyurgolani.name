import type { VariantRenderInput } from '@portfolio/variant-contract';

// The portfolio as a composition reads it, apart from the model, so the
// figures and the model both import it and not each other.

export type Portfolio = VariantRenderInput['portfolio'];
export type ViewSection = Portfolio['sections'][number];
