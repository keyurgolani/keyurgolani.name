# Deployment

The server runs one deployment profile, chosen by `PORTFOLIO_PROFILE` at startup. This release serves `read-only`, the portfolio in a mounted directory with no editing surface, and `demo`, the bundled sample for a product demo. Run it in Docker (recommended) or on Node.

The browser editor, the variant gallery, the variant preview pages, and their write APIs are gone in every profile, `pnpm dev` included. Edit `config/portfolio.yml` instead: `pnpm dev` picks up each save, and a production server picks it up when it restarts. `pnpm dev` listens on every network interface; on a network you don't trust, run `pnpm dev --hostname 127.0.0.1`.

## Docker (recommended for self-hosting)

The repo ships a `Dockerfile` and `docker-compose.yml`.

```sh
cp portfolio.example.yml config/portfolio.yml   # then make it yours
echo 'PORTFOLIO_ORIGIN=https://jane.name' > .env
docker compose up --build
```

This builds a production image, mounts `config/` into the container read-only, and serves on port 3000 under the `read-only` profile. Edit `docker-compose.yml` to change the port or add a reverse proxy.

### What the image does

- Multi-stage build: deps → build → run.
- Installs only production dependencies in the runtime stage.
- Runs `pnpm build` to produce a Next.js standalone output. The build needs no deployment settings, and the image sets no `PORTFOLIO_*` defaults.
- Under `read-only` and `owner`, reads the portfolio from `PORTFOLIO_SOURCE_DIR`, the mounted `config/`, and never renders the bundled example in production.

### Startup checks

Before it takes a request, the server validates its settings and the portfolio. A problem stops it with exit code 1 and one `config.fatal` JSON line per problem on stdout. Each line names the setting, never its value, and for the portfolio adds the file, the JSON pointer, and the line and column. The server refuses to start on:

- a required setting that is missing or malformed;
- in production, a setting that doesn't apply to the profile, such as `GITHUB_TOKEN` under `read-only` (`pnpm dev` warns and ignores it);
- `PORTFOLIO_PATH` or `NEXT_PUBLIC_BASE_URL`, which `PORTFOLIO_SOURCE_DIR` and `PORTFOLIO_ORIGIN` replaced;
- a source directory that is missing or unreadable, that is a file rather than the directory holding it, that holds zero or several portfolio documents, or that holds a `portfolio.toml` (TOML is no longer read);
- a portfolio that isn't one plain YAML or JSON document (anchors, aliases, merge keys, tags, directives, and a second document are refused), that repeats a key in a mapping, that is over 1 MiB, nests more than 64 levels deep, or holds more than 10,000 entries in one mapping or list, that doesn't declare `schemaVersion: 2`, that fails the schema, or that gives two sections the same `id`;
- a key the schema doesn't define, anywhere but inside `extensions` (the message suggests the closest allowed key), or a `url`, `src`, or `*Url` value that isn't an `https`, `http`, `mailto`, or `tel` URL, a relative path, or a `#fragment` (image sources may also be raster `data:image` URLs);
- in production under `read-only` and `owner`, an origin on a reserved example domain, or the bundled sample's `identity.name`.

Data under an `extensions` key, or a section whose `kind` is `<npm package name>/<name>`, belongs to a content extension. This release registers none, so the server keeps that data as written, logs a `config.warning` with code `extension_unregistered` for each use, and never renders it.

`owner` doesn't start yet: it needs an authentication provider, and none ships.

### Updating the portfolio

The server reads `config/portfolio.yml` once, at startup. After you edit it, restart the container:

```sh
docker compose restart web
```

If the edit is invalid, the server logs its `config.fatal` lines and exits 1. `docker-compose.yml` sets `restart: unless-stopped`, so Docker restarts the container in a loop, and each restart logs the same `config.fatal` block again until you fix the file. `docker compose logs web` shows where the problem is. Once the file is fixed, the next restart serves the site, or run `docker compose restart web` to start it right away.

To add a variant package or pick up a new release, rebuild:

```sh
docker compose up --build
```

### Reverse proxy

For production behind Nginx, Caddy, or Traefik, point your proxy at `http://localhost:3000` (or whatever port you mapped) and terminate TLS there. The app builds every absolute URL from `PORTFOLIO_ORIGIN`; it never reads `Host` or `X-Forwarded-*` for one.

## Serverless hosts

Vercel, Netlify, and similar hosts aren't supported yet. Nothing verifies that the server finds its source directory or stops on a bad setting there. Use Docker or plain Node.

## Plain Node

```sh
pnpm install
pnpm build
PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \
  PORTFOLIO_SOURCE_DIR=../../config pnpm start
```

`pnpm start` runs from `apps/web`, so the relative source directory is the repo's `config/`. The host listens on `process.env.PORT` (defaults to 3000).

### Demo

`demo` renders the bundled sample, `portfolio.example.yml`, and reads no source directory; setting `PORTFOLIO_SOURCE_DIR` stops a production server. Its origin is the demo hostname:

```sh
PORTFOLIO_PROFILE=demo PORTFOLIO_ORIGIN=https://demo.jane.name pnpm start
```

`/` shows the sample in the default variant, and `/sample?variant=<slug>&scheme=<id>&typography=<id>` in any registered variant, color scheme, and typography preset. An unknown variant is a 404, and an unknown scheme or preset falls back to the variant's default. Until the demo's indexing rules are settled, every response sends `X-Robots-Tag: noindex`, `robots.txt` disallows everything, the sitemap is empty, and there is no feed. Every Studio operation answers with the 404 envelope.

For a process manager (PM2, systemd, etc.), wrap `pnpm start` with the same environment. The Next.js standalone output makes the container surface minimal — you don't need to ship `node_modules` to your runtime if you copy `apps/web/.next/standalone/` and the public assets.

## Environment variables

The server reads these from its environment only. Every key also accepts `<KEY>_FILE`, the path of a file holding the value (such as a Docker secret); set one or the other. An empty value counts as unset. `.env.example` lists them all.

| Variable                       | Profiles         | Purpose                                                                           |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE`            | all              | Required. Exactly `owner`, `demo`, or `read-only`.                                |
| `PORTFOLIO_ORIGIN`             | all              | Required. The origin visitors use, such as `https://jane.name`: no path or slash. |
| `PORTFOLIO_SOURCE_DIR`         | owner, read-only | Directory holding exactly one `portfolio.{yml,yaml,json}`, not the file.          |
| `PORTFOLIO_TRUSTED_PROXY_HOPS` | all              | How many trusted proxies append to `X-Forwarded-For`. Whole number, default `0`.  |
| `PORTFOLIO_PREVIEW_ORIGIN`     | owner, demo      | Optional preview origin, different from `PORTFOLIO_ORIGIN`.                       |
| `PORTFOLIO_DATA_DIR`           | owner            | Reserved: the writable data directory.                                            |
| `PORTFOLIO_AUTH_PASSWORD_HASH` | owner            | Reserved: the Studio password hash.                                               |
| `GITHUB_TOKEN`                 | owner            | Reserved. Public GitHub sections use unauthenticated REST and never send a token. |
| `PORT`                         | all              | Port the host binds to. Default `3000`.                                           |
| `PORTFOLIO_PATH`               | none: refused    | Replaced by `PORTFOLIO_SOURCE_DIR`. Setting it stops the server.                  |
| `NEXT_PUBLIC_BASE_URL`         | none: refused    | Replaced by `PORTFOLIO_ORIGIN`. Setting it stops the server.                      |

A key outside its profile's list stops a production server; `pnpm dev` warns and ignores it. `.env` files are gitignored. `pnpm dev` reads `apps/web/.env.development`, which runs `read-only` from `config/`.

## Caching

The host uses Next.js fetch revalidation:

- **GitHub data:** 1 hour (`revalidate: 3600`). The `cache()` wrapper memoizes within a request.
- **Metadata:** rendered per request (`robots.txt`, `sitemap.xml`, the Open Graph image, and the feed), from the portfolio loaded at startup and `PORTFOLIO_ORIGIN`.
- **Variant CSS:** served as static assets.

To force a refresh, redeploy or clear the Next.js cache:

```sh
rm -rf apps/web/.next/cache
```

## CDN

The Next.js app ships static assets under `_next/static/...`. Any CDN that respects `Cache-Control` headers will work. The Dockerfile doesn't bundle a CDN; that's the operator's choice.

## Checks before going live

- `pnpm typecheck` exits 0
- `pnpm check:skills` exits 0
- `node skills/portfolio-author/scripts/validate.mjs config/portfolio.yml` exits 0
- `pnpm build` exits 0
- The dev server renders correctly in light, dark, bright, black, and system themes
- `/feed.xml`, `/robots.txt`, `/sitemap.xml` all 200, with URLs on your `PORTFOLIO_ORIGIN`
- With the production build running, `node apps/web/scripts/check-containment.mjs http://127.0.0.1:3000 --direct --expect-name "<your identity.name>" --expect-origin "<your PORTFOLIO_ORIGIN>"` exits 0. Drop `--direct` when the URL goes through your reverse proxy.

## Updating

To pull upstream changes:

```sh
git fetch origin
git rebase origin/main
pnpm install
pnpm typecheck
docker compose up --build
```

The platform follows semver: a major bump may change the schema in incompatible ways. Read the release notes before upgrading across majors.
