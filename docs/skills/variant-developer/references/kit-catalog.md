# @portfolio/kit catalog

> Every export from @portfolio/kit, grouped by topic, with a one-line
> "use this when..." per export. Loaded by the agent before each
> implementation cluster (Phase 2 Wave 2). CI keeps this in sync with
> packages/kit/src/index.ts via sync-checks.mjs (`pnpm check:skills`).

## Source of truth

`packages/kit/src/index.ts` is authoritative for the main barrel; the
sub-path entry points (`@portfolio/kit/<topic>`) are listed in
`packages/kit/package.json` `exports`. This catalog paraphrases.
If they disagree, the source wins.

## Format helpers (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `formatDate` | `(raw, opts?: {short?}) => string` | Rendering a single date with month + year (or short month). |
| `formatYear` | `(raw) => string` | Year-only display, with `'Present'` passthrough. |
| `formatPeriod` | `(period, opts?: {short?}) => string` | A start–end range from a `Period`. |
| `formatDuration` | `(period) => string` | Human duration string ("2 yrs 3 mos") for a `Period`. |
| `formatList` | `(items, conjunction?) => string` | Oxford-comma joined list ("a, b, and c"). |
| `formatTrackDuration` | `(seconds) => string` | mm:ss display for audio tracks. |
| `formatEpisodeDuration` | `(minutes) => string` | "45 min" / "1h 15m" for podcast episodes. |
| `slugify` | `(text) => string` | Producing a stable url-safe id from any string. |
| `ensureSectionId` | `(idOrTitle, fallback) => string` | Resolving the id to anchor a section to. |
| `formatStatValue` | `(value: string\|number) => string` | Stat tiles where the value can be either type. |
| `formatCompactNumber` | `(n) => string` | Compact star/contribution counts (1.2K, 3.4M). |
| `formatRelativeTime` | `(iso, now?) => string` | Terse relative-time string like `"3d ago"`, `"2mo ago"`. Use when rendering last-pushed-at timestamps on lists where compactness matters. Buckets: just now / Xm/h/d/w/mo/y ago. |
| `parseLooseDate` | `(raw) => ParsedDate \| null` | Dropping to the parser when you need fields, not a string. |

## Nav (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `deriveNavItems` | `(portfolio, options?: DeriveNavItemsOptions) => NavItem[]` | Building a TOC or sticky nav from `portfolio.sections`. |
| `NavItem` (type) | `{ label, href }` | Typing nav item arrays. |
| `DeriveNavItemsOptions` (type) | `{ limit?, excludeKinds?, labelFor? }` | Customising which kinds appear and how they're labeled. |

## Motion (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `useMotionPreference` | `(portfolioPref?) => 'reduce' \| 'full'` | Reading the resolved motion mode in a client component. |
| `shouldReduceMotion` | `(portfolioPref, osReduce) => boolean` | Synchronous server-side check or non-hook contexts. |
| `ResolvedMotion` (type) | `'reduce' \| 'full'` | Annotating motion-aware props. |

## Theme system (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `ThemeProvider` | React component `{ children, defaultPreference?, supportedThemes? }` | Wrapping the app root so `useTheme` works. |
| `useTheme` | `() => { preference, resolved, setPreference }` | Reading or changing the active theme inside a variant. |
| `THEME_INIT_SCRIPT` | string | Inline `<script>` in `app/layout.tsx` to avoid theme flash on first paint. |
| `resolveTheme` | `(preference, supported, systemMatch) => ResolvedTheme` | Resolving the active theme given a preference, a supported-themes list, and a system-preference callback; falls back to light/dark when bright/black are not listed. |
| `ResolvedTheme` (type) | `'light' \| 'dark' \| 'bright' \| 'black'` | Annotating resolved theme props. |

## Manifest helpers (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `resolveColorScheme` | `(manifest, override?, portfolioChoice?) => string \| null` | Resolving the active color-scheme id at render. |
| `resolveTypographyPreset` | `(manifest, override?, portfolioChoice?) => string \| null` | Same for typography presets. |
| `VariantManifest` / `VariantProps` / `VariantModule` (types) | — | Typing the manifest, render props, and module shape. |
| `Aesthetic`, `MotionIntensity`, `Density`, `TypographyCharacter`, `PerformanceTier`, `ColorScheme`, `TypographyPreset` (types) | — | Annotating manifest values; see `manifest-contract.md` for fields. |

## Fallback section (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `FallbackSection` | React component `{ section, portfolio }` | Routing a section kind through a generic typographic renderer. Use this in section dispatch when you don't have a bespoke renderer for a kind but still claim coverage. |

## Markdown (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `renderMarkdown` | `(source) => string` | Rendering block markdown to HTML for `dangerouslySetInnerHTML`. |
| `renderInlineMarkdown` | `(source) => string` | Inline markdown (e.g. inside a `<p>`), no block wrappers. |

## ClassName helper (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `cn` | `(...inputs: ClassValue[]) => string` | Joining conditional class names (alias of `clsx`). |
| `ClassValue` (type) | re-exported from `clsx` | Typing className accumulators. |

## Tokens (`@portfolio/kit`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `TOKENS` | `Readonly<Record<TokenKey, '--<name>'>>` | Looking up the CSS custom-property name for a host token (surface, ink, accent, rule, fontDisplay, etc.). |
| `tokenVar` | `(key: TokenKey) => 'var(--<name>)'` | Inlining a token in a style object. |
| `TokenKey` (type) | union of token keys | Restricting helper inputs to known tokens. |

## Re-exported schema types (`@portfolio/kit`)

`Portfolio`, `Section`, `SectionKind`, `ThemePreference`, `MotionPreference`, `Identity`, `Link`, `Image`, `Period` — re-exported for ergonomic imports inside variants without depending directly on `@portfolio/schema`.

## Pretext — text-measurement hooks (`@portfolio/kit`, also `@portfolio/kit/pretext`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `useFontsReady` | `() => boolean` | Gating a measurement until web fonts have loaded. |
| `useElementWidth` | `<T extends HTMLElement>() => readonly [ref, width]` | Reading an element's pixel width reactively. |
| `usePrepared` | `(input, options) => prepared` | Pre-computing layout artefacts (glyphs, metrics) once fonts are ready. |
| `useTextStats` | `(text) => TextStats` | Cheap counts (chars, words) for headings/leds. |
| `useTextHeight` | `(text, opts) => number` | Measuring rendered height for a string at a given style. |
| `useShrinkWrap` | `(opts) => ref` | Auto-shrinking display text to fit its container. |
| `useFlowAroundObstacle` | `(opts) => FlowLine[]` | Computing reflow lines around a floating shape (drop-cap, sidebar). |
| `useReadingTime` | `(text) => number \| null` | Estimating minutes-to-read for an article body. |
| `readingTimeFor` | `(text) => number \| null` | Same, but synchronous (use in server components). |
| `PreparedOptions`, `TextStats`, `Obstacle`, `FlowLine` (types) | — | Annotating arguments / results of the hooks above. |

## GitHub (`@portfolio/kit/github`)

> Server-side only. Importing from a client component fails at runtime.

| Export | Signature | Use when |
|--------|-----------|----------|
| `fetchGitHubData` | `(input: FetchGitHubDataInput) => Promise<GitHubData \| null>` | Server-fetching pinned repos + contribution calendar. Memoized per request, revalidated hourly. |
| `contributionLevelFor` | `(count: number) => 0\|1\|2\|3\|4` | Mapping a contribution count to a heatmap level when the source lacks one. |
| `languageColor` | `(name) => string \| null` | Resolving GitHub's brand color for a language label. |
| `GitHubData`, `PinnedRepo`, `ContributionDay`, `ContributionLevel`, `LanguageBreakdownEntry`, `FetchGitHubDataInput` (types) | — | Typing fetch results and renderer props. |

## SEO / feed (`@portfolio/kit/seo`)

| Export | Signature | Use when |
|--------|-----------|----------|
| `collectFeedEntries` | `(portfolio, opts?: BuildFeedOptions) => FeedEntry[]` | Building a unified writings/publications/episodes feed. |
| `renderRssFeed` | `(portfolio, opts?: RenderRssOptions) => string` | Producing the RSS 2.0 XML body for `/feed.xml` route handlers. |
| `buildStructuredData` | `(portfolio) => JsonLd[]` | Emitting Schema.org Person / ProfilePage / WebSite JSON-LD in `<head>`. |
| `FeedEntry`, `BuildFeedOptions`, `RenderRssOptions`, `JsonLd` (types) | — | Typing inputs and outputs of the helpers above. |

## Spatial (2D / canvas) primitives (`@portfolio/kit/spatial`)

> Only useful when manifest.performanceTier is `medium` or higher (or `light` for the no-canvas primitives like ParallaxLayer / HolographicPanel).

| Export | Signature | Use when |
|--------|-----------|----------|
| `useSpatialContract` | `(opts?: UseSpatialContractOptions) => SpatialContractValues` | Single hook that resolves motion + perf budget for spatial primitives. Every spatial variant should go through this. |
| `MagneticCursor` | component `{ motionPreference?, dotSize?, haloSize?, color?, haloDamping?, hideSystemCursor? }` | Custom cursor with springy halo (light tier). |
| `SpotlightMask` | component `{ motionPreference?, radius?, intensity?, damping?, shade?, reducedFallback? }` | Cursor-tracked dark overlay with a hole revealing content. |
| `HolographicPanel` | component `{ children, tone?, scanlines?, glow?, blur?, borderWeight? }` | Glassmorphic / pearl panel container (light tier). |
| `AuroraGradient` | component `{ colors?, speed?, blend?, opacity?, position?, zIndex?, grain?, motionPreference? }` | Animated multi-stop gradient backdrop. |
| `ParallaxLayer` | component `{ children, scrollSpeed?, mouseInfluence?, depth?, motionPreference?, ... }` | Single-layer scroll/pointer parallax wrapper. |
| `ParticleField2D` | component `{ density?, maxParticles?, particleSize?, lineColor?, connectDistance?, cursorRadius?, ... }` | 2D-canvas particle network (medium tier). |
| `ScanlineOverlay` | component `{ scanlineColor?, scanlineSpacing?, scrollSpeed?, chromaticAberration?, vignette?, tint?, ... }` | CRT scanline + chromatic-aberration overlay (medium tier). |
| `WavePlaneCanvas` | component `{ colorA?, colorB?, colorC?, speed?, amplitude?, frequency?, zIndex? }` | WebGL2 fragment-shader animated plane (medium tier). |
| `SpatialContractValues`, `UseSpatialContractOptions` (types) | — | Annotating contract consumers. |

## Spatial R3F — react-three-fiber primitives (`@portfolio/kit/spatial-r3f`)

> HEAVY. Only import when manifest.performanceTier is `heavy` AND the
> variant is intentionally WebGL-aware. Mobile fallbacks required. These
> live behind a separate sub-path so light-tier variants never pull in
> three / @react-three/fiber.

| Export | Signature | Use when |
|--------|-----------|----------|
| `SpatialCanvas` | component, extends `CanvasProps` | Root R3F `<Canvas>` with sane defaults + EnvironmentBoundary. |
| `TransmissionGem` | component | Dispersion-shader gem mesh — the "hero object" primitive. |
| `PostprocessChain` | component | Bloom + chromatic-aberration + vignette post stack. |
| `EnvironmentBoundary` | error boundary class | Catches WebGL context loss and renders a 2D fallback. Wrap any R3F tree. |
| `ScrollCameraRig` | component | Scroll-tied camera rig that drives child meshes. |
| `FloatingCard` | component | Plane mesh that floats with subtle drift; useful for nav/CTA tiles. |
