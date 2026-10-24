import type { SchemeGenerators } from '@portfolio/core';
import { DerivedSchemeSchema, findPack, type AppearanceRegistry } from '@portfolio/appearance';
import { runGenerator } from '@portfolio/appearance/generators';

// The build's scheme generators (#10, 10h), as #3's store takes them in
// UnitChecks.schemes: the generator each registered color scheme's manifest
// declares, @portfolio/appearance's runGenerator() to run it, and
// DerivedSchemeSchema to check what a draft holds or a revision froze. The
// store calls these; core itself doesn't depend on @portfolio/appearance.
// Browser-safe and server-only-free, since portfolio-store bundles it.

export function schemeGenerators(appearance: AppearanceRegistry): SchemeGenerators {
  return Object.freeze({
    declared(schemeId: string) {
      const generator = findPack(appearance, 'colorScheme', schemeId)?.manifest.generator;
      return generator
        ? { id: generator.id, version: generator.version, input: generator.input }
        : undefined;
    },
    run(declared, input) {
      // runGenerator takes an asset by its id; one that reads the bytes is #20's to add.
      const run = runGenerator(
        declared,
        'seedColor' in input ? { seedColor: input.seedColor } : { sourceAsset: input.sourceAsset },
      );
      return run.ok
        ? { ok: true, generator: run.result.generator, tokens: run.result.tokens }
        : { ok: false, problem: run.problem };
    },
    check: (entry: unknown) => DerivedSchemeSchema.safeParse(entry).success,
  } satisfies SchemeGenerators);
}
