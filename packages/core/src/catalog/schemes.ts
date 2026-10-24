// The scheme generators a build hands the store (#10, 10h), as types alone:
// UnitChecks names them, and every profile loads the unit, so this module
// holds no code. The store's use of them is in store/schemes.ts.

/** What a scheme's manifest declares: `generator`, in @portfolio/appearance's manifests. */
export interface GeneratorDeclaration {
  readonly id: string;
  readonly version: number;
  readonly input: 'seed-color' | 'asset';
}

/** What a generator reads: a seed color lowercased, or an asset's stored bytes. */
export type SchemeInput =
  { readonly seedColor: string } | { readonly sourceAsset: string; readonly bytes: Uint8Array };

export type SchemeRun =
  | {
      readonly ok: true;
      readonly generator: { readonly id: string; readonly version: number };
      readonly tokens: unknown;
    }
  | { readonly ok: false; readonly problem: string };

/** The build's generators, as the composition root and portfolio-store bind them. */
export interface SchemeGenerators {
  /**
   * The generator the registered scheme `schemeId` declares, or undefined for
   * a scheme with none, or one this build doesn't register.
   */
  declared(schemeId: string): GeneratorDeclaration | undefined;
  /** Runs `declared`'s generator on `input`. Never throws: a problem is the answer. */
  run(declared: GeneratorDeclaration, input: SchemeInput): SchemeRun;
  /** Whether `entry` is a whole derived scheme: @portfolio/appearance's DerivedSchemeSchema. */
  check(entry: unknown): boolean;
}
