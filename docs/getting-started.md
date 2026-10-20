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

`pnpm dev` runs the `read-only` profile from `config/`, with the settings in `apps/web/.env.development`. While `config/` holds neither document, it renders the bundled examples and logs a warning.

The dev server hot-reloads on:

- Changes to `config/portfolio.yml` and `config/site.yml` (on the next page load)
- Changes to any file under `apps/web/src/`
- Changes to any file under `packages/variant-editorial/src/`
- Changes to any file under `packages/kit/src/` or `packages/schema/src/`

## Make it yours

### 1. Create `config/portfolio.yml` and `config/site.yml`

Start from the bones of the two examples:

```sh
cp portfolio.example.yml config/portfolio.yml
cp site.example.yml config/site.yml
# edit config/portfolio.yml
```

`portfolio.yml` holds the content, and `site.yml` how it looks and which sections show. Edit the content first. Start with `identity` and `sections`. Save, then reload the page. `config/` is gitignored, so your content stays out of commits.

`portfolio.example.yml` exercises every section kind. Cherry-pick the ones you need; delete the rest.

### 2. Validate as you go

```sh
node skills/portfolio-author/scripts/validate.mjs config
```

It checks both documents. Each problem names the file, the line and column, and how to fix it. The schema is strict, and so is the server: a file that fails validation stops `pnpm dev` at startup, and a bad edit while it runs shows an error page (the terminal says where) until you fix it. Validate often.

### 3. Variants and themes

`appearance.variant` in `config/site.yml` selects the active variant. The example's is `editorial`. Change the line and reload to switch. The rest of the appearance sits beside it:

```yaml
appearance:
  variant: editorial
  designLanguage: platform-neutral
  colorScheme: noir # editorial offers warm | noir | ink-and-paper
  typography: modernist # editorial offers classic | modernist
  displayMode: dark # system | light | dark
motionPolicy: reduce # respect-os | reduce
```

`displayMode` is the theme a visit starts in, and the toggle in the corner of the page lets visitors override it. The schemes/typography are baked into the YAML for now (per-visitor schemas/typography pickers are a future feature).

To see the bundled sample in any registered variant, run the dev server under the `demo` profile:

```sh
PORTFOLIO_PROFILE=demo PORTFOLIO_SOURCE_DIR= pnpm dev
```

Then open `http://localhost:3000/sample?variant=<slug>&scheme=<id>&typography=<id>`. `/sample` starts from the sample site's appearance and overrides only what its query names. An unknown variant is a 404; a scheme or preset the variant doesn't declare falls back to its default.

### 4. Add personal assets

Place files under `apps/web/public/`. Reference them with absolute paths in `config/portfolio.yml`:

```yaml
identity:
  avatar: { src: '/me.jpg', alt: 'Author headshot' }
links:
  - { url: '/resume.pdf', platform: resume }
```

`/me.jpg` resolves to `apps/web/public/me.jpg`. The host doesn't fetch arbitrary URLs.

## GitHub data

The `github` section pulls live data from GitHub's REST API without authentication (60 requests an hour per server address, cached for an hour). Public pages never send a token, so the contribution heatmap stays off and the pinned list is your top-starred repos. Don't set `GITHUB_TOKEN` for it: a `read-only` production server refuses to start with one.

## Build for production

```sh
pnpm build
PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \
  PORTFOLIO_SOURCE_DIR=../../config pnpm start
```

Production doesn't read `apps/web/.env.development`, so it needs the settings in its environment, and it refuses to start without your own `config/portfolio.yml` and `config/site.yml`. Or use the included Dockerfile. See [deployment.md](deployment.md).

## What to read next

- Authoring deeper portfolios: [authoring.md](authoring.md)
- Building a custom variant: [variants.md](variants.md)
- Understanding internals: [architecture.md](architecture.md)
