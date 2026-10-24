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

`pnpm install` resolves the workspace and installs all dependencies. The variant registry is built later, by `pnpm dev` and `pnpm build`, from the variants `@portfolio/web` depends on.

## Run the dev server

```sh
pnpm dev
```

Visit `http://127.0.0.1:3000`. You'll see the example portfolio in Editorial Evidence, the platform default composition (#13), which the example site selects: the practice thesis and the signature work first, the flagship works on smaller plates, and the archive behind a disclosure. A site that selects a variant this build doesn't install renders in the fallback composition instead, and the terminal logs a `variant.unavailable` warning.

`pnpm dev` runs the `read-only` profile from `config/`, with the settings in `apps/web/.env.development`. While `config/` holds neither document, it renders the bundled examples and logs a warning.

The dev server hot-reloads on:

- Changes to `config/portfolio.yml` and `config/site.yml` (on the next page load)
- Changes to any file under `apps/web/src/`
- Changes to any file under a registered variant's `src/`, such as `packages/fallback-composition/src/`, but its stylesheet: registry generation compiles that, so run `pnpm --filter @portfolio/web build:registry` after an edit to it, or restart `pnpm dev`
- Changes to any file under `packages/kit/src/` or `packages/schema/src/`, but the kit's `sections/styles.css`, which registry generation compiles into each variant's stylesheet

## Make it yours

### 1. Create `config/portfolio.yml` and `config/site.yml`

Start from the bones of the two examples:

```sh
cp portfolio.example.yml config/portfolio.yml
cp site.example.yml config/site.yml
# edit config/portfolio.yml
```

`portfolio.yml` holds the content, and `site.yml` how it looks and which sections show. Edit the content first. Start with `identity`, and its `name` above all: `pnpm dev` renders the sample's, but a production server refuses to start while `identity.name` is still `Anamika Devi`, the bundled sample's. Then `sections`. Save, then reload the page. `config/` is gitignored, so your content stays out of commits.

`portfolio.example.yml` exercises every section kind. Cherry-pick the ones you need; delete the rest.

### 2. Validate as you go

```sh
node skills/portfolio-author/scripts/validate.mjs config
```

It checks both documents. Each problem names the file, the line and column, and how to fix it. The schema is strict, and so is the server: a file that fails validation stops `pnpm dev` at startup, and a bad edit while it runs shows an error page (the terminal says where) until you fix it. Validate often.

### 3. Variants and appearance

`appearance.variant` in `config/site.yml` selects the variant, the composition that arranges the page. A variant is a package `@portfolio/web` depends on; one this build doesn't install renders as the fallback composition, with a warning. The rest of the appearance sits beside it, for the appearance system (#19) to resolve:

```yaml
appearance:
  variant: editorial-evidence
  designLanguage: platform-neutral
  colorScheme: warm
  typography: classic
  displayMode: dark # system | light | dark | high-contrast
motionPolicy: reduce # respect-os | reduce
```

`displayMode` is the mode a visit starts in, and `colorScheme`, `typography`, and `designLanguage` name the platform's packs: `warm-parchment`, `humanist-ui`, and `platform-neutral`. `visitorControls` in `site.yml` says which of them visitors may change for themselves, in the Appearance control on every page. [configuration.md](configuration.md#the-site-document) covers every field.

To see the bundled sample in any registered variant, run the dev server under the `demo` profile:

```sh
PORTFOLIO_PROFILE=demo PORTFOLIO_SOURCE_DIR= pnpm dev
```

Then open `http://127.0.0.1:3000/sample`, which renders the sample in its own site's selection, or `http://127.0.0.1:3000/sample?variant=<id>` for a registered variant. `fallback` or an id this build doesn't register is a 404.

### 4. Add personal assets

Place files under `apps/web/public/`. Reference them with absolute paths in `config/portfolio.yml`:

```yaml
identity:
  avatar: { src: '/me.jpg', alt: 'Author headshot' }
links:
  - { url: '/resume.pdf', platform: resume }
```

`/me.jpg` resolves to `apps/web/public/me.jpg`. The host doesn't fetch arbitrary URLs. Give each file at the top of `public/` a name with its extension, as here: a folder named like `images` could take a path a variant's view uses, and `pnpm test` fails on one.

## GitHub data

The `github` section renders a link to your GitHub profile. Repositories, languages, and the contribution calendar come with #10, which hands them to the variant in its render input; until then no page fetches GitHub. Don't set `GITHUB_TOKEN` for it: a `read-only` production server refuses to start with one.

## Build for production

```sh
pnpm build
PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \
  PORTFOLIO_SOURCE_DIR=../../config pnpm start
```

Production doesn't read `apps/web/.env.development`, so it needs the settings in its environment, and it refuses to start without your own `config/portfolio.yml` and `config/site.yml`. Or use the included Dockerfile. See [deployment.md](deployment.md).

## What to read next

- Every field and rule in both documents: [configuration.md](configuration.md)
- Authoring deeper portfolios: [authoring.md](authoring.md)
- Building a custom variant: [variants.md](variants.md)
- Understanding internals: [architecture.md](architecture.md)
