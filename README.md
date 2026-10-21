# Portfolio Platform

An open-source, self-hostable portfolio platform with pluggable visual variants.

You write two documents. `portfolio.yml` says who you are and what you've done, and `site.yml` says how the site presents it: the variant, color scheme, typography, display mode, motion, and which sections show. The platform validates them as a pair and renders the portfolio through the site's variant, a styled React tree that decides layout, color, type, and motion. Changing `site.yml` changes the look without touching content, and editing `portfolio.yml` changes content without touching code. Deployment settings and secrets stay in the environment.

```
portfolio.yml + site.yml ── @portfolio/schema ── apps/web ── @portfolio/variant-* ── browser
                             (validate)           (host)       (render)
```

Designed for engineers, makers, photographers, writers, musicians, designers, consultants, and academics who want to own their portfolio without learning a templating engine. The content model doesn't assume a profession, and a profession package can add its own fields and sections.

**Live demo:** [keyurgolani.name](https://keyurgolani.name)

<p align="center">
  <img src="docs/screenshots/01-home-hero-editorial.png" alt="Editorial variant" width="49%" />
  <img src="docs/screenshots/05-variant-kinetic-cosmos.png" alt="Kinetic Cosmos variant" width="49%" />
</p>

<p align="center"><em>The same <code>portfolio.yml</code> rendered through two variants, Editorial and Kinetic Cosmos. Switch the look without touching content.</em><br/>
<strong><a href="SHOWCASE.md">See the full visual showcase »</a></strong></p>

## Quick start

```sh
pnpm install
pnpm dev
```

Visit `http://localhost:3000`. With neither document in `config/` yet, it renders the bundled examples. Copy `portfolio.example.yml` to `config/portfolio.yml` and `site.example.yml` to `config/site.yml`, and edit them; the page picks up each save.

To run in Docker (production), with both documents in `config/` and `PORTFOLIO_ORIGIN` set in `.env`:

```sh
docker compose up --build
```

See [docs/getting-started.md](docs/getting-started.md) for the full walkthrough.

## What's in the box

- **28 section kinds**: hero, lede, experience, projects, skills, GitHub, gallery, discography, episodes, testimonials, publications, talks, awards, and more. See [docs/features.md](docs/features.md).
- **Content extensions**: namespaced fields and section kinds from a profession package, checked when the build registers it and kept out of visitors' view when it doesn't.
- **Appearance in the site document**: the variant, color scheme, typography preset, and the display mode a visit starts in. Independent axes and per-axis visitor controls land with #19 (appearance axes): today `designLanguage` is only recorded, the scheme and typography ids are the variant's own, and `visitorControls` isn't applied.
- **Theme toggle** with `light`, `dark`, `bright` (paper-white), `black` (AMOLED), and `system` (follows the OS).
- **Per-variant color schemes and typography presets**: Editorial ships 3 schemes and 2 type pairings.
- **Validation that says where**: every problem in either document comes with its code, file, line and column, and fix, from `pnpm config:validate` or the server at startup. A missing, doubled, or unreadable document is about the file, so its record has no line or column.
- **GitHub integration**: top repos, a recently active list, and a language breakdown, from GitHub's public REST API. Public pages never send a token.
- **Print stylesheet, feed, structured data, and Open Graph images.**
- **Drift gates** keep the schema, kit catalog, and skill references in sync (`pnpm check:skills`).
- **AI-assisted authoring and variant development** via two skills under [skills/](skills/).

## Workspace layout

```
apps/
  web/                          Next.js host (routes, data loading, SEO)

packages/
  schema/                       The portfolio and site schemas, validation,
                                extensions, and the one-time migration
  kit/                          Shared utilities (theme provider, GitHub fetcher,
                                format helpers, SEO, spatial primitives)
  variant-editorial/            First variant: typographic editorial spread
  variant-kinetic-cosmos/       Second variant: gradient nebula, particles, career timeline
  variant-template/             Scaffold for new variants

docs/
  architecture.md               How the pieces fit
  getting-started.md            Install, run, edit
  configuration.md              Both documents, field by field
  authoring.md                  Writing a good portfolio
  variants.md                   Building a variant
  deployment.md                 Production deployment
  features.md                   Feature catalog

skills/                         AI agent skills
                                (portfolio-author, variant-developer)

config/                         Your portfolio.yml and site.yml (gitignored)
portfolio.example.yml           Fully populated example portfolio
site.example.yml                Example site document
```

## Documentation

| For                                | Read                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| First-time visitors                | [docs/getting-started.md](docs/getting-started.md)     |
| Authors writing the documents      | [docs/authoring.md](docs/authoring.md)                 |
| Every field and diagnostic code    | [docs/configuration.md](docs/configuration.md)         |
| Developers building variants       | [docs/variants.md](docs/variants.md)                   |
| Architects understanding internals | [docs/architecture.md](docs/architecture.md)           |
| Operators deploying to production  | [docs/deployment.md](docs/deployment.md)               |
| Looking for a feature              | [docs/features.md](docs/features.md)                   |
| AI agents authoring portfolios     | [skills/portfolio-author/](skills/portfolio-author/)   |
| AI agents building variants        | [skills/variant-developer/](skills/variant-developer/) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, and the [checks](CONTRIBUTING.md#checks) that must stay green.

## License

[MIT](LICENSE).
