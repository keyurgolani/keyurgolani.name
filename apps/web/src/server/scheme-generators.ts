import type { SchemeContext, SchemeGenerators } from '@portfolio/core';
import {
  axisFallback,
  canonicalId,
  DerivedSchemeSchema,
  findPack,
  gateLanguage,
  NEUTRAL_LANGUAGE,
  storedTokens,
  VISITOR_TIERS,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import {
  runGenerator,
  SHIPPING_WASHES,
  washFailures,
  washProblem,
  type RenderedLanguage,
} from '@portfolio/appearance/generators';

// The build's scheme generators (#10, 10h), as #3's store takes them in
// UnitChecks.schemes: the generator each registered color scheme's manifest
// declares, @portfolio/appearance's runGenerator() to run it, and
// DerivedSchemeSchema to check what a draft holds or a revision froze. The
// store calls these; core itself doesn't depend on @portfolio/appearance.
// What a run stores leaves out the three roles K-2 added, which rendering
// works out again, so a scheme a revision froze before K-2 and the same
// scheme run now are one entry, and a draft save raises no change. A run
// whose own contrast report fails, such as a surface-lit no lighter step
// could light, is a problem naming its first failing pair, with advice to
// pick another seed or image: the save reports it, as a scheme diagnostic
// Studio shows, and stores nothing for it.
// A #20 generator's report also reads the shipping washes (LANG-5c r2b),
// but a save refuses a scheme for a wash only when a language the site
// renders with lays it: its designLanguage, and every one the build offers
// visitors when they may choose. Without a site, every language counts.
// Browser-safe and server-only-free, since portfolio-store bundles it.

// Every registered tier is a visitor tier today; the filter stays in case one isn't.
const VISITOR: ReadonlySet<string> = new Set(VISITOR_TIERS);

/** Each registry's languages as the gate reads them, by id, read once. */
const READ = new WeakMap<AppearanceRegistry, Map<string, readonly RenderedLanguage[]>>();

/**
 * What the gate reads from the language `id`. One it can't read fails
 * closed (LANG-5c r2's rule): it counts as laying every shipping wash.
 */
function readLanguage(appearance: AppearanceRegistry, id: string): readonly RenderedLanguage[] {
  let read = READ.get(appearance);
  if (!read) READ.set(appearance, (read = new Map()));
  const known = read.get(id);
  if (known) return known;
  const pack = findPack(appearance, 'designLanguage', id);
  const gate = pack ? gateLanguage(pack.manifest.tokens) : null;
  const languages: readonly RenderedLanguage[] = !pack
    ? []
    : gate?.ok
      ? [{ id, language: gate.language }]
      : SHIPPING_WASHES.map(({ textured, washes }) => ({
          id,
          language: { ...NEUTRAL_LANGUAGE, textured, washes },
        }));
  read.set(id, languages);
  return languages;
}

/**
 * The design languages a site renders with, as the gate reads them, the
 * one it renders first: the one it names, or the fallback when this build
 * has none by that id, and with visitors choosing, every language they're
 * offered. Without a site, every language this build has.
 */
function renderedLanguages(
  appearance: AppearanceRegistry,
  context: SchemeContext | undefined,
): { readonly chosen: string; readonly languages: readonly RenderedLanguage[] } {
  const packs = [...appearance.packs.designLanguage.values()];
  const named = context?.designLanguage
    ? canonicalId(appearance, 'designLanguage', context.designLanguage)
    : null;
  const chosen =
    named !== null && findPack(appearance, 'designLanguage', named)
      ? named
      : axisFallback('designLanguage');
  const others =
    !context || context.languageSelectable
      ? packs
          .filter(({ manifest }) => !context || VISITOR.has(manifest.tier))
          .map(({ manifest }) => manifest.id)
          .filter((id) => id !== chosen)
      : [];
  return {
    chosen,
    languages: [chosen, ...others].flatMap((id) => readLanguage(appearance, id)),
  };
}

export function schemeGenerators(
  appearance: AppearanceRegistry,
  generate: typeof runGenerator = runGenerator,
): SchemeGenerators {
  return Object.freeze({
    declared(schemeId: string) {
      const generator = findPack(appearance, 'colorScheme', schemeId)?.manifest.generator;
      return generator
        ? { id: generator.id, version: generator.version, input: generator.input }
        : undefined;
    },
    run(declared, input, context) {
      // runGenerator takes an asset by its id; one that reads the bytes is #20's to add.
      const run = generate(
        declared,
        'seedColor' in input ? { seedColor: input.seedColor } : { sourceAsset: input.sourceAsset },
      );
      if (!run.ok) return { ok: false, problem: run.problem };
      const kind = 'seedColor' in input ? 'seed color' : 'image';
      // A #20 report (one with a reading) reads the shipping washes too:
      // those pairs count only through washFailures(), for this site's
      // languages. A pair failing on a bare surface fails a bare reading too.
      const failing = run.result.contrastReport.pairs.find(
        (pair) => !pair.passes && pair.wash === undefined,
      );
      if (failing) {
        const ground = failing.ground ? ` on ${failing.ground}` : '';
        return {
          ok: false,
          problem: `${declared.id} made a scheme that fails its own contrast report, first ${failing.foreground}${ground} in ${failing.set}, so it isn't stored.`,
          remediation: `Pick another ${kind}, then save the draft, or select another color scheme.`,
        };
      }
      const rendered =
        run.result.reading === undefined ? null : renderedLanguages(appearance, context);
      const [washed] = rendered ? washFailures(run.result.tokens, rendered.languages) : [];
      if (washed) {
        // The site's own language, or one its visitors may choose instead.
        const own = washed.language === rendered!.chosen;
        return {
          ok: false,
          problem: `${declared.id} made a scheme that doesn't read under a design language ${own ? 'this site renders with' : "this site's visitors may choose"}. ${washProblem(washed)}, so it isn't stored.`,
          remediation: own
            ? `Pick another ${kind}, then save the draft, or select another color scheme or design language.`
            : `Pick another ${kind}, then save the draft, or select another color scheme, or lock the design language so visitors can't choose ${washed.language}.`,
        };
      }
      return { ok: true, generator: run.result.generator, tokens: storedTokens(run.result.tokens) };
    },
    check: (entry: unknown) => DerivedSchemeSchema.safeParse(entry).success,
  } satisfies SchemeGenerators);
}
