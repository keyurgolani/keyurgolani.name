// @portfolio/appearance/react (#19, Slice 3): the presentation boundary, the
// client hooks the 'use client' primitives read it through, and the
// visitor's appearance control. It peers on React and imports no Node
// module and nothing from next/*. Nothing renders it until Slice 4 cuts the
// host over.

export {
  AppearanceDiagnostics,
  PresentationBoundary,
  type AppearanceDiagnosticsProps,
  type PresentationBoundaryProps,
} from './presentation-boundary';
export { useBoundary, useBoundaryId, type BoundaryContextValue } from './boundary-root';
