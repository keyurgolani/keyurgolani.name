// What `pnpm catalog` reads (#20): the registry as build:registry reads it,
// writing nothing, the packs it left out with their manifests, and every
// Research record outside the fixture packages.

import {
  createAppearanceRegistry,
  validatePackManifest,
  type AppearanceMeta,
  type MetaPack,
  type PackManifest,
  type ResearchRecord,
} from '@portfolio/appearance';
import { catalogPacks, packPackages, researchRecords } from '@portfolio/appearance/node';
import { registryMeta, type RegistryDiagnostic } from '@portfolio/variant-contract/node';
import type { CatalogSources } from './catalog-query';
import { generateRegistry, renderOptions, REPO_ROOT } from './registry-options';

export interface ReadSources extends CatalogSources {
  /** Every registered pack, as the metadata module lists it. */
  readonly packs: readonly MetaPack[];
}

export async function readCatalogSources(
  env: Readonly<Record<string, string | undefined>>,
): Promise<
  | { readonly ok: true; readonly sources: ReadSources }
  | { readonly ok: false; readonly diagnostics: readonly RegistryDiagnostic[] }
> {
  const { result, excluded = [] } = await generateRegistry(env, { write: false });
  if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
  const data = registryMeta(result, renderOptions(env));
  const meta: AppearanceMeta = {
    VARIANTS: data.VARIANTS,
    PACKS: data.PACKS as readonly MetaPack[],
    PLATFORM_STYLESHEET: data.PLATFORM_STYLESHEET,
    EXCLUDED_PACKS: excluded,
  };
  const packages = packPackages(REPO_ROOT);
  const onDisk = catalogPacks(REPO_ROOT, packages);
  const research: { packageName: string; record: ResearchRecord }[] = [];
  for (const file of researchRecords(
    REPO_ROOT,
    packages.filter(({ fixture }) => !fixture),
  )) {
    if (file.record) research.push({ packageName: file.packageName, record: file.record });
  }
  return {
    ok: true,
    sources: {
      registry: createAppearanceRegistry(meta),
      excluded: excluded.map((pack) => {
        const found = onDisk.find(
          ({ id, packageName }) => id === pack.id && packageName === pack.packageName,
        );
        const checked = found?.manifest
          ? validatePackManifest(found.manifest, { kind: pack.kind, packageName: pack.packageName })
          : null;
        return { pack, manifest: checked?.ok ? (checked.manifest as PackManifest) : null };
      }),
      research,
      packs: meta.PACKS ?? [],
    },
  };
}
