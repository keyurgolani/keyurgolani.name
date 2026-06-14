# Portfolio Platform

A self-hostable, YAML-driven portfolio site with pluggable visual variants.

You write a single `portfolio.yml` describing who you are and what you've done. The platform validates it against a typed schema and renders it through your chosen variant — a styled React tree that decides typography, color, motion, and layout. Switching variants changes the look without touching content. Editing the YAML changes content without touching code.

```
portfolio.yml ── @portfolio/schema ── @portfolio/variant-* ── apps/web ── browser
                  (validate)            (render)              (host)
```

Designed for engineers, makers, photographers, writers, and academics who want to own their portfolio without learning a templating engine.

**Live demo:** [keyurgolani.name](https://keyurgolani.name)

<p align="center">
  <img src="docs/screenshots/01-home-hero-editorial.png" alt="Editorial variant" width="49%" />
  <img src="docs/screenshots/05-variant-kinetic-cosmos.png" alt="Kinetic Cosmos variant" width="49%" />
</p>

<p align="center"><em>The same <code>portfolio.yml</code> rendered through two variants — Editorial and Kinetic Cosmos. Switch the look without touching content.</em><br/>
📸 <strong><a href="SHOWCASE.md">See the full visual showcase »</a></strong></p>

## Quick start

```sh
pnpm install
pnpm dev
```

Visit `http://localhost:3000`. Edit `portfolio.yml` at the repo root and the page hot-reloads.

To run in Docker (production):

```sh
docker compose up --build
```

See [docs/getting-started.md](docs/getting-started.md) for the full walkthrough.

## What's in the box

- **28 section kinds** — hero, lede, experience, projects, skills, GitHub, gallery, testimonials, publications, talks, awards, and more. See [docs/features.md](docs/features.md).
- **5 theme modes** — `light`, `dark`, `bright` (paper-white), `black` (AMOLED), and `system` (follows OS).
- **Per-variant color schemes and typography presets** — editorial ships 3 schemes and 2 type pairings.
- **GitHub integration** — pinned repos, recently-active list, contribution heatmap, language breakdown. Uses GraphQL with a token, REST without.
- **Print stylesheet, RSS feed, structured data, OG image generation** — opt-in per variant via the `capabilities` flag.
- **Drift gates** keep the schema, kit catalog, and skill references in sync (`pnpm check:skills`).
- **AI-assisted authoring + variant development** via two skills under [skills/](skills/).

## Workspace layout

```
apps/
  web/                          Next.js host (routes, data loading, SEO)

packages/
  schema/                       Zod schemas, 28 section kinds, theme/motion enums
  kit/                          Shared utilities (theme provider, GitHub fetcher,
                                format helpers, SEO, spatial primitives)
  variant-editorial/            First variant: typographic editorial spread
  variant-template/             Scaffold for new variants

docs/
  architecture.md               How the pieces fit
  getting-started.md            Install, run, edit
  authoring.md                  Writing portfolio.yml
  variants.md                   Building a variant
  deployment.md                 Production deployment
  features.md                   Feature catalog

skills/                         AI agent skills
                                (portfolio-author, variant-developer)

portfolio.yml                   Your portfolio
portfolio.example.yml           Fully-populated example
```

## Documentation

| For | Read |
|---|---|
| First-time visitors | [docs/getting-started.md](docs/getting-started.md) |
| Authors writing portfolio.yml | [docs/authoring.md](docs/authoring.md) |
| Developers building variants | [docs/variants.md](docs/variants.md) |
| Architects understanding internals | [docs/architecture.md](docs/architecture.md) |
| Operators deploying to production | [docs/deployment.md](docs/deployment.md) |
| Looking for a feature | [docs/features.md](docs/features.md) |
| AI agents authoring portfolios | [skills/portfolio-author/](skills/portfolio-author/) |
| AI agents building variants | [skills/variant-developer/](skills/variant-developer/) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, and the drift gates that must stay green.

## License

[MIT](LICENSE).
