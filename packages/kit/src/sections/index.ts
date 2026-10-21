// @portfolio/kit/sections (#5, Slice 2): the shared, accessible renderer of
// every core section kind, and what a variant needs around them. None of it is
// a client module, nothing in it reads the clock, randomness, or the network,
// and it imports no Node module, so the host's server render, #7's preview
// frame, and #9's render in the browser give the same markup.

export { renderSection } from './render-section';
export type { RenderSectionOptions } from './render-section';
export { SHARED_RENDERERS } from './renderers';
export { RichText } from './rich-text';
export { seededRandom } from './seeded-random';
export { VisitorControlSlot } from './visitor-control-slot';
export { registerHostModules } from './host-modules';
export type { HostModules, EnhancementComponent, EnhancementLoader } from './host-modules';
export type {
  BespokeRenderers,
  CoreRenderers,
  HeadingLevel,
  SectionOf,
  SectionRenderer,
  SectionRendererProps,
} from './types';
