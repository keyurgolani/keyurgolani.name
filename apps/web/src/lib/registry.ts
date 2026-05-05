import type { VariantManifest, VariantModule } from '@portfolio/kit';
import { REGISTRY, MANIFESTS } from './registry.generated';
import type { RegistryEntry } from './registry.generated';

export type { RegistryEntry };
export { REGISTRY, MANIFESTS };

const BY_SLUG: Record<string, RegistryEntry> = REGISTRY;

export function findManifest(slug: string): VariantManifest | null {
  return BY_SLUG[slug]?.manifest ?? null;
}

export async function loadVariantModule(slug: string): Promise<VariantModule | null> {
  const entry = BY_SLUG[slug];
  if (!entry) return null;
  return await entry.load();
}

export function listManifests(): VariantManifest[] {
  return MANIFESTS;
}

export function defaultManifest(): VariantManifest {
  const editorial = BY_SLUG['editorial']?.manifest;
  if (editorial) return editorial;
  const first = MANIFESTS[0];
  if (!first) throw new Error('No variants registered');
  return first;
}

export function isExperimental(slug: string): boolean {
  return BY_SLUG[slug]?.experimental ?? false;
}
