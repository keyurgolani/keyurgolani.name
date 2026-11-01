import type { VariantManifest } from './manifest-schema';

/** One installed variant, as registry generation (Slice 3) lists it. */
export interface RegisteredVariant {
  readonly packageName: string;
  /** From the package's package.json. */
  readonly version: string;
  readonly manifest: VariantManifest;
}

/** Every variant this build registers. */
export type VariantRegistry = readonly RegisteredVariant[];

/** The registered variant with `id`, if there is one. */
export function findVariant(registry: VariantRegistry, id: string): RegisteredVariant | undefined {
  return registry.find((entry) => entry.manifest.id === id);
}
