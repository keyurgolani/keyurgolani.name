# Getting started

From clone to running site in a few minutes.

## Prerequisites

- Node.js 22 or later
- pnpm 10.33 or later (the repo pins `packageManager` exactly)
- Git

That's it for local development. Docker is optional and covered in [deployment.md](deployment.md).

## Clone and install

```sh
git clone https://github.com/keyurgolani/keyurgolani.name.git
cd keyurgolani.name
pnpm install
```

`pnpm install` resolves the workspace, installs all dependencies, and runs the postinstall step that builds the variant registry.

## Run the dev server

```sh
pnpm dev
```

Visit `http://localhost:3000`. You'll see the example portfolio rendered through the editorial variant.

The dev server hot-reloads on:

- Changes to `portfolio.yml`
- Changes to any file under `apps/web/src/`
- Changes to any file under `packages/variant-editorial/src/`
- Changes to any file under `packages/kit/src/` or `packages/schema/src/`

## Make it yours

### 1. Replace `portfolio.yml`

Open `portfolio.yml` and edit the content. Start with `identity` and `sections`. Save — the page reloads.

If you want a clean slate, copy the bones of `portfolio.example.yml`:

```sh
cp portfolio.example.yml portfolio.yml
# edit portfolio.yml
```

`portfolio.example.yml` exercises every section kind. Cherry-pick the ones you need; delete the rest.

### 2. Validate as you go

```sh
node skills/portfolio-author/scripts/validate.mjs portfolio.yml
```

Errors point to the YAML line and column. The schema is strict — typos in `kind` discriminants silently drop sections from rendering, so validate often.

### 3. Pick a variant

The `variant:` field at the top of `portfolio.yml` selects the active variant. The default is `editorial`. As more variants ship, you can preview them at `/variants` and switch with one line.

### 4. Tune theme, color scheme, typography

```yaml
theme: dark              # light | dark | bright | black | system
motionPreference: reduce # respect-os | reduce | full
colorScheme: noir        # editorial offers warm | noir | ink-and-paper
typography: modernist    # editorial offers classic | modernist
```

The toggle in the corner of the page lets visitors override the theme. The schemes/typography are baked into the YAML for now (per-visitor schemas/typography pickers are a future feature).

### 5. Add personal assets

Place files under `apps/web/public/`. Reference them with absolute paths in `portfolio.yml`:

```yaml
identity:
  avatar: { src: '/me.jpg', alt: 'Author headshot' }
links:
  - { url: '/resume.pdf', platform: resume }
```

`/me.jpg` resolves to `apps/web/public/me.jpg`. The host doesn't fetch arbitrary URLs.

## Optional: GitHub data

The `github` section pulls live data. It works without authentication (REST, 60 req/hr) but is much richer with a GitHub token:

```sh
echo "GITHUB_TOKEN=ghp_yourtokenhere" > .env
pnpm dev
```

A token unlocks the contribution heatmap, full pinned items with descriptions, and the recently-active list. Token-less mode falls back to top-starred owned repos for pinned and skips the heatmap.

## Build for production

```sh
pnpm build
pnpm start
```

Or use the included Dockerfile. See [deployment.md](deployment.md).

## What to read next

- Authoring deeper portfolios: [authoring.md](authoring.md)
- Building a custom variant: [variants.md](variants.md)
- Understanding internals: [architecture.md](architecture.md)
