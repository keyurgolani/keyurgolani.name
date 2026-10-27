// Cross-tier contract hook — every spatial variant uses this.
export {
  useSpatialContract,
  type SpatialContractValues,
  type UseSpatialContractOptions,
} from './use-spatial-contract';

// Light-tier spatial primitives — no WebGL, no canvas, safe everywhere.
export { MagneticCursor } from './magnetic-cursor';
export { SpotlightMask } from './spotlight-mask';
export { HolographicPanel } from './holographic-panel';
export { AuroraGradient } from './aurora-gradient';
export { ParallaxLayer } from './parallax-layer';

// Medium-tier — single canvas / WebGL2 fragment shader / 2D canvas. No R3F.
export { ParticleField2D } from './particle-field-2d';
export { ScanlineOverlay } from './scanline-overlay';
export { WavePlaneCanvas } from './wave-plane-canvas';
