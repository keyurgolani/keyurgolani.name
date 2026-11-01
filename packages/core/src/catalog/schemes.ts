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
  | {
      readonly ok: false;
      readonly problem: string;
      /** What the owner can do about it, where the store's own advice doesn't fit. */
      readonly remediation?: string;
    };

/**
 * The design languages a site renders its generated schemes with (LANG-5c
 * r2b), as its document says: its designLanguage, and whether visitors may
 * choose another, so every one the build offers them renders it too.
 */
export interface SchemeContext {
  /** The site's appearance.designLanguage, or null when it names none. */
  readonly designLanguage: string | null;
  readonly languageSelectable: boolean;
}

/** The build's generators, as the composition root and portfolio-store bind them. */
export interface SchemeGenerators {
  /**
   * The generator the registered scheme `schemeId` declares, or undefined for
   * a scheme with none, or one this build doesn't register.
   */
  declared(schemeId: string): GeneratorDeclaration | undefined;
  /**
   * Runs `declared`'s generator on `input`, gated for the languages
   * `context` renders with, or every one the build has without it. Never
   * throws: a problem is the answer.
   */
  run(declared: GeneratorDeclaration, input: SchemeInput, context?: SchemeContext): SchemeRun;
  /** Whether `entry` is a whole derived scheme: @portfolio/appearance's DerivedSchemeSchema. */
  check(entry: unknown): boolean;
}
