// @portfolio/kit/sections (#5, Slice 2; #10, slice 1): the shared, accessible
// renderer of every core section kind, the record and media pieces they are
// built from, what a variant needs around them, and the outlines a
// composition's own navigation, case-study page, and footer read (stream E).
// None of it is a client module, nothing in it reads the clock, randomness,
// or the network, and it imports no Node module, so the host's server
// render, #7's preview frame, and #9's render in the browser give the same
// markup.

export {
  anchorOf,
  frameAttributes,
  renderSection,
  sectionRenders,
  SHARED_SECTIONS,
  SharedFrame,
} from './render-section';
export type { RenderSectionOptions } from './render-section';
export {
  CASE_STUDY_FIELDS,
  caseStudyOutline,
  footerOutline,
  KIND_FAMILIES,
  pageOutline,
  sameTarget,
} from './outline';
export type {
  CaseStudyField,
  CaseStudyOutline,
  CaseStudyPart,
  FooterCta,
  FooterLink,
  FooterOutline,
  OutlineFamily,
  OutlineItem,
  OutlineSection,
  OutlineWork,
  OutlineMedium,
  OutlineEvidenceType,
  PageOutline,
  RelatedWork,
} from './outline';
export { rhythmFrame, sectionRhythms } from './rhythm';
export type { SectionRhythm } from './rhythm';
export { NavigationMenuSlot } from './navigation-menu-slot';
export {
  CANONICAL_DESTINATIONS,
  canonicalDestination,
  checkDestinationOverrides,
  checkGrouping,
  defaultDestination,
  defineNavigationOverrides,
  DESTINATION_LABELS,
  DESTINATIONS,
  navigationModel,
  sectionClass,
} from './navigation';
export type {
  Destination,
  DestinationId,
  DestinationLabel,
  DestinationOverrideMap,
  DestinationOverrides,
  GroupContext,
  GroupingOptions,
  NavigationModel,
  NavigationOptions,
  SectionClass,
  SectionGroup,
} from './navigation';
export { composePages } from './pages';
export type {
  CaseStudyComposition,
  CaseStudyPageProps,
  HomeComposition,
  HomePageProps,
  ViewNotice,
  ViewPage,
  ViewPageProps,
  ViewsComposition,
} from './pages';
export { SHARED_RENDERERS } from './renderers';
export { CaseStudy } from './renderers/case-study';
export type { CaseStudyProps } from './renderers/case-study';
export { ChronologyItem } from './renderers/chronology';
export { EvidenceEntry } from './renderers/evidence';
export { WorkEntry } from './renderers/works';
export { BACKDROP_WIDTH, MediaBackdrop, MediaFigure, backdropOf, focalStyle } from './media';
export { placedMedia } from './placement';
export {
  asSentence,
  citesWhole,
  endsSentence,
  shownPlace,
  withoutTrailingPeriod,
} from './evidence-facts';
export type {
  Backdrop,
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
  isRoutedWork,
  isSignature,
  anchorSection,
  placedImage,
  recordAnchor,
  routedWork,
  sectionShows,
  worksByIds,
  worksOf,
} from './view';
export type { Placement, RoutedWork, ViewSource } from './view';
export {
  DateText,
  deeper,
  distinctHostLabels,
  formatFigure,
  formatMinutes,
  formatNames,
  Heading,
  hostLabelled,
  hrefFor,
  LabeledDate,
  LinkText,
  MaybeLink,
  PeriodText,
  present,
  renderContext,
  safeHref,
  SectionHeader,
  Ui,
} from './primitives';
export type { RenderContext } from './primitives';
export { RichText } from './rich-text';
export { seededRandom } from './seeded-random';
export { VisitorControlSlot } from './visitor-control-slot';
export { registerHostModules } from './host-modules';
export type {
  HostModules,
  EnhancementComponent,
  EnhancementLoader,
  NavigationMenuProps,
} from './host-modules';
export type {
  BespokeRenderers,
  CoreRenderers,
  FrameAttributes,
  HeadingLevel,
  SectionComposition,
  SectionFrame,
  SectionFrameProps,
  SectionOf,
  SectionRenderer,
  SectionRendererProps,
  VariantComponent,
} from './types';
