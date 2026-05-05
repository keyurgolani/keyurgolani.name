# Building a variant

A variant is a workspace package that takes a validated `Portfolio` object and renders it. Variants are real packages — not config — so they can pull in heavy dependencies, ship custom CSS, define their own primitives, and stay isolated from each other.

For an AI-assisted variant build, point an agent at [docs/skills/variant-developer/SKILL.md](skills/variant-developer/SKILL.md).

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
  aesthetic: 'editorial',          // editorial | spatial | kinetic | popart | terminal | bento | narrative | custom
  motion: 'still',                 // still | subtle | animated | kinetic
  density: 'balanced',             // minimal | balanced | dense
  typography: 'mixed',             // serif | sans | mono | mixed
  performanceTier: 'light',        // light | medium | heavy
  supportedKinds: ALL_SECTION_KINDS,
  themes: ['light', 'dark', 'bright', 'black'],  // never list 'system' here
  colorSchemes: [
    { id: 'default', name: 'Default', themes: ['light', 'dark'], default: true,
      swatch: { paper: '#fff', ink: '#000', accent: '#0044ff' } },
  ],
  typographyPresets: [
    { id: 'default', name: 'Default', default: true },
  ],
  capabilities: { print: false, rss: false, multiPage: false },
};
```

The full per-field reference is at [`docs/skills/variant-developer/references/manifest-contract.md`](skills/variant-developer/references/manifest-contract.md).

### `themes`

Lists the concrete `data-theme` values your variant renders correctly via CSS. Mandatory minimum is `['light', 'dark']`. Add `'bright'` and `'black'` only if you've authored CSS blocks for those values — the audit script warns otherwise.

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
import type { Portfolio } from '@portfolio/schema';
import { resolveColorScheme, resolveTypographyPreset } from '@portfolio/kit';
import { manifest } from './manifest';
import { SectionDispatch } from './section';

export default function MyVariant({
  portfolio,
  colorScheme,
  typography,
}: {
  portfolio: Portfolio;
  colorScheme?: string;
  typography?: string;
}) {
  const scheme = resolveColorScheme(manifest, colorScheme, portfolio.colorScheme);
  const type = resolveTypographyPreset(manifest, typography, portfolio.typography);

  return (
    <div
      data-variant="my-slug"
      data-color-scheme={scheme ?? undefined}
      data-typography={type ?? undefined}
    >
      <main>
        {portfolio.sections.map((section, i) => (
          <SectionDispatch key={section.id ?? `${section.kind}-${i}`} section={section} portfolio={portfolio} />
        ))}
      </main>
    </div>
  );
}
```

## Theme integration

The host wraps your variant in `<ThemeProvider>`. Theme resolution applies `data-theme="..."` to `<html>` based on the visitor's stored preference and your manifest's `themes` array.

For bright/black to actually render, the host must pass your `manifest.themes` into `<ThemeProvider supportedThemes={...}>`. In this repo today that's wired explicitly in `apps/web/src/app/layout.tsx`. When you register a new variant that supports bright/black, that file needs to look up the active variant's manifest (today it's hardcoded to editorial; multi-variant hosting will need a registry lookup).

Build your toggle UI in `src/primitives/theme-toggle.tsx`. Filter the rendered buttons against your `manifest.themes` so users only see modes you support; always render the `system` button. Editorial's toggle in `packages/variant-editorial/src/primitives/theme-toggle.tsx` is the reference implementation.

## Styling conventions

- **BEM-style classes:** `<slug>-<block>__<element>--<modifier>`. The `<slug>-` prefix prevents bleed across variants.
- **Scope every selector under `[data-variant='<slug>']`** so you don't accidentally style other variants.
- **Use CSS custom properties** for tokens (`--paper`, `--ink`, `--accent`, etc.) so color schemes and themes are token swaps, not selector explosions.
- **Define dark/bright/black blocks** as descendant selectors on `[data-theme='X'] [data-variant='<slug>']`.

The full conventions doc is at [`docs/skills/variant-developer/references/styling-conventions.md`](skills/variant-developer/references/styling-conventions.md).

## Audit your variant

```sh
node docs/skills/variant-developer/scripts/audit.mjs packages/variant-my-slug
```

Hard fails:
- `supportedKinds` is missing a kind from `ALL_SECTION_KINDS`.
- A renderer dispatch case is missing for a declared kind (and no `FallbackSection` routing).
- `themes` is missing `'light'` or `'dark'`.

Warnings:
- Only one color scheme declared (multiple is encouraged).
- Only one typography preset declared (same).
- `themes` claims `'bright'` or `'black'` but `styles.css` has no `[data-theme='X']` block.

The full audit checklist is at [`docs/skills/variant-developer/references/audit-checklist.md`](skills/variant-developer/references/audit-checklist.md).

## Visual companion

The variant-developer skill ships a visual companion at `docs/skills/variant-developer/scripts/visual-companion/`:

- **Mockup mode** (HTTP server + file watcher) for prototyping CSS without spinning up Next.js.
- **Preview mode** (Playwright matrix screenshots) for capturing every theme × scheme × typography combo.

Start mockup mode:

```sh
bash docs/skills/variant-developer/scripts/visual-companion/start.sh
```

Run preview matrix:

```sh
pnpm exec tsx docs/skills/variant-developer/scripts/visual-companion/preview-matrix.mjs <slug>
```

Output lands in `.variant-preview/<slug>/` (gitignored).

## What to read next

- AI-assisted variant building: [`docs/skills/variant-developer/SKILL.md`](skills/variant-developer/SKILL.md)
- System internals: [architecture.md](architecture.md)
- Available section kinds: [authoring.md](authoring.md)
