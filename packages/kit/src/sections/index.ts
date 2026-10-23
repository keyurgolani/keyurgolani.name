// @portfolio/kit/sections (#5, Slice 2; #10, slice 1): the shared, accessible
// renderer of every core section kind, the record and media pieces they are
// built from, and what a variant needs around them. None of it is a client
// module, nothing in it reads the clock, randomness, or the network, and it
// imports no Node module, so the host's server render, #7's preview frame,
// and #9's render in the browser give the same markup.

export { renderSection } from './render-section';
export type { RenderSectionOptions } from './render-section';
export { SHARED_RENDERERS } from './renderers';
export { CaseStudy } from './renderers/case-study';
export type { CaseStudyProps } from './renderers/case-study';
export { ChronologyItem } from './renderers/chronology';
export { EvidenceEntry } from './renderers/evidence';
export { WorkEntry } from './renderers/works';
export { MediaFigure, focalStyle } from './media';
export { placedMedia } from './placement';
export type {
  DerivedImage,
  ImageRendition,
  ImageState,
  MediaFigureProps,
  PlacedImage,
} from './media';
export {
  chronologyOf,
  evidenceByIds,
  evidenceOf,
  githubSnapshot,
  isArchived,
  isSignature,
  anchorSection,
  placedImage,
  recordAnchor,
  sectionShows,
  worksByIds,
  worksOf,
} from './view';
export type { Placement, ViewSource } from './view';
export {
  formatFigure,
  hrefFor,
  LinkText,
  present,
  renderContext,
  SectionHeader,
} from './primitives';
export type { RenderContext } from './primitives';
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
  VariantComponent,
} from './types';
