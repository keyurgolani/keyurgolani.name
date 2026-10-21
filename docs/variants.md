# Building a variant

A variant is a workspace package that renders the portfolio. The host gives it `VariantProps`: the portfolio's public view, which leaves out hidden sections and unregistered extension data, and the site's color scheme, typography preset, and motion policy. Variants are real packages, not config, so they can pull in heavy dependencies, ship custom CSS, define their own primitives, and stay isolated from each other.

For an AI-assisted variant build, point an agent at [skills/variant-developer/SKILL.md](../skills/variant-developer/SKILL.md).

## Anatomy of a variant

```
packages/variant-<slug>/
├── package.json          name: @portfolio/variant-<slug>
├── tsconfig.json
├── src/
│   ├── index.ts          re-exports manifest + default React component
│   ├── manifest.ts       VariantManifest with slug, themes, schemes, kinds
│   ├── variant.tsx       default-exported React component
│   ├── section.tsx       dispatches Section → renderer per kind
│   ├── styles.css        scoped via [data-variant='<slug>']
│   ├── primitives/       shared internal components (theme toggle, etc.)
│   └── renderers/        one file per supported section kind
│       ├── hero.tsx
│       ├── lede.tsx
│       ├── experience.tsx
│       └── …
```

## Quick scaffold

```sh
pnpm new-variant my-slug
```

Copies `packages/variant-template/` to `packages/variant-my-slug/`, renames the package, and re-runs the registry build so the new variant is discoverable.

## The manifest contract

Every variant exports a `VariantManifest`:

```ts
export const manifest: VariantManifest = {
  slug: 'my-slug',
  name: 'My Slug',
  version: '0.1.0',
  aesthetic: 'editorial', // editorial | spatial | kinetic | popart | terminal | bento | narrative | custom
  motion: 'still', // still | subtle | animated | kinetic
  density: 'balanced', // minimal | balanced | dense
  typography: 'mixed', // serif | sans | mono | mixed
  performanceTier: 'light', // light | medium | heavy
  supportedKinds: ALL_SECTION_KINDS,
  themes: ['light', 'dark', 'bright', 'black'], // never list 'system' here
  colorSchemes: [
    {
      id: 'default',
      name: 'Default',
      themes: ['light', 'dark'],
      default: true,
      swatch: { paper: '#fff', ink: '#000', accent: '#0044ff' },
    },
  ],
  typographyPresets: [{ id: 'default', name: 'Default', default: true }],
  capabilities: { print: false, rss: false, multiPage: false },
};
```

The full per-field reference is at [`skills/variant-developer/references/manifest-contract.md`](../skills/variant-developer/references/manifest-contract.md).

### `themes`

Lists the concrete `data-theme` values your variant renders correctly via CSS. Mandatory minimum is `['light', 'dark']`. Add `'bright'` and `'black'` only if you've authored CSS blocks for those values; the audit script warns otherwise.

`'system'` is never listed in `themes`. It's a user preference / resolver, not a render target. Every variant supports `system` automatically (it picks `light` or `dark` per `prefers-color-scheme`).

### `colorSchemes` and `typographyPresets`

Named overrides applied via attribute selectors:

```css
[data-variant='my-slug'][data-color-scheme='warm'] { --accent: #b54a32; … }
[data-variant='my-slug'][data-typography='modernist'] { --font-display: 'Inter', sans-serif; … }
```

Ship more than one of each when your design admits it. The audit warns when only one is declared.

### `supportedKinds`

Lists every `kind` the variant declares it can render. The audit script verifies this contains every kind in `ALL_SECTION_KINDS`. The simplest correct value is `ALL_SECTION_KINDS` itself.

If you skip a kind in your dispatch, route it through `FallbackSection` from `@portfolio/kit`. That gives you a default rendering for kinds you haven't bespoke yet.

## The render path

```tsx
// src/variant.tsx
import {
  MotionPolicyProvider,
  resolveColorScheme,
  resolveTypographyPreset,
  type VariantProps,
} from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';

export default function MyVariant({
  portfolio,
  colorScheme,
  typography,
  motionPolicy = 'respect-os',
}: VariantProps) {
  const scheme = resolveColorScheme(manifest, colorScheme);
  const type = resolveTypographyPreset(manifest, typography);

  return (
    <MotionPolicyProvider policy={motionPolicy}>
      <div
        data-variant="my-slug"
        data-color-scheme={scheme ?? undefined}
        data-typography={type ?? undefined}
        data-motion-policy={motionPolicy}
      >
        <main id="main">
          {portfolio.sections.map((section) => (
            <SectionDispatch key={section.id} section={section} portfolio={portfolio} />
          ))}
        </main>
      </div>
    </MotionPolicyProvider>
  );
}
```

Render each section with its `id` as the DOM id: it's the anchor navigation and links point to. A section whose `kind` comes from a content extension (`isExtensionSection` from `@portfolio/schema/ids`) renders nothing for now.

## Theme integration

The host wraps your variant in `<ThemeProvider>`, fed your manifest's `themes` and the site's display mode as the starting preference (`apps/web/src/lib/variant-tree.tsx`). Theme resolution applies `data-theme="..."` to `<html>` from the visitor's stored preference, else that starting one, within your `themes`. Nothing needs wiring per variant.

Build your toggle UI in `src/primitives/theme-toggle.tsx`. Filter the rendered buttons against your `manifest.themes` so users only see modes you support; always render the `system` button. Editorial's toggle in `packages/variant-editorial/src/primitives/theme-toggle.tsx` is the reference implementation.

## Motion

`VariantProps.motionPolicy` is the site's policy: `respect-os` follows the visitor's `prefers-reduced-motion`, and `reduce` always reduces motion. Wrap the page in `MotionPolicyProvider` with it, as above, so every `useMotionPreference()` below reads it, and reduce your CSS motion under `[data-motion-policy='reduce']` as you do under `prefers-reduced-motion`. A component can add a reduce of its own, but nothing can undo the site's.

CSS rules don't reach motion that scripts run. Gate a canvas loop, an entrance, or an animation that repeats on `useMotionPreference()`, and scroll with `behavior: 'auto'` under reduce. A variant built on framer-motion also wraps its root in `MotionConfig`, `reducedMotion: 'always'` under the site's `reduce` and `'user'` otherwise, as Kinetic Cosmos's `primitives/motion-config.tsx` does. That skips transform and layout animations, but opacity still animates, so the gates stay. [`common-bugs.md`](../skills/variant-developer/references/common-bugs.md) section 8 has the details.

## Styling conventions

- **BEM-style classes:** `<slug>-<block>__<element>--<modifier>`. The `<slug>-` prefix prevents bleed across variants.
- **Scope every selector under `[data-variant='<slug>']`** so you don't accidentally style other variants.
- **Use CSS custom properties** for tokens (`--paper`, `--ink`, `--accent`, etc.) so color schemes and themes are token swaps, not selector explosions.
- **Define dark/bright/black blocks** as descendant selectors on `[data-theme='X'] [data-variant='<slug>']`.

The full conventions doc is at [`skills/variant-developer/references/styling-conventions.md`](../skills/variant-developer/references/styling-conventions.md).

## Audit your variant

```sh
node skills/variant-developer/scripts/audit.mjs packages/variant-my-slug
```

Hard fails:

- `supportedKinds` is missing a kind from `ALL_SECTION_KINDS`.
- A renderer dispatch case is missing for a declared kind (and no `FallbackSection` routing).
- `themes` is missing `'light'` or `'dark'`.

Warnings:

- Only one color scheme declared (multiple is encouraged).
- Only one typography preset declared (same).
- `themes` claims `'bright'` or `'black'` but `styles.css` has no `[data-theme='X']` block.

The full audit checklist is at [`skills/variant-developer/references/audit-checklist.md`](../skills/variant-developer/references/audit-checklist.md).

## Visual companion

The variant-developer skill ships a visual companion at `skills/variant-developer/scripts/visual-companion/`:

- **Mockup mode** (HTTP server + file watcher) for prototyping CSS without spinning up Next.js.
- **Preview mode** (Playwright matrix screenshots) for capturing every theme of `/sample?variant=<slug>`, with the dev server `start.sh --mode preview` runs under `PORTFOLIO_PROFILE=demo`.

Start mockup mode:

```sh
bash skills/variant-developer/scripts/visual-companion/start.sh
```

Run preview matrix:

```sh
bash skills/variant-developer/scripts/visual-companion/start.sh --mode preview --variant <slug> --matrix
```

Output lands in `.variant-preview/<slug>/` (gitignored).

## What to read next

- AI-assisted variant building: [`skills/variant-developer/SKILL.md`](../skills/variant-developer/SKILL.md)
- System internals: [architecture.md](architecture.md)
- Available section kinds: [authoring.md](authoring.md)
- Both documents, field by field: [configuration.md](configuration.md)
