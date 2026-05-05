# Deployment

Three options: Docker (default), Vercel/Netlify (zero-config), or Node anywhere.

## Docker (recommended for self-hosting)

The repo ships a `Dockerfile` and `docker-compose.yml`.

```sh
docker compose up --build
```

By default this builds a production image, mounts your local `portfolio.yml` into the container, and serves on port 3000. Edit `docker-compose.yml` to change the port or add a reverse proxy.

### What the image does

- Multi-stage build: deps → build → run.
- Installs only production dependencies in the runtime stage.
- Runs `pnpm build` to produce a Next.js standalone output.
- Bind-mounts `portfolio.yml` so you can edit it on the host without rebuilding.

### Updating the portfolio without rebuilding

Because `portfolio.yml` is bind-mounted, edits on the host are picked up by the container on next request — no rebuild needed.

To swap variants or schema versions, you do need to rebuild:

```sh
docker compose up --build
```

### Reverse proxy

For production behind Nginx, Caddy, or Traefik, point your proxy at `http://localhost:3000` (or whatever port you mapped). The Next.js host respects `X-Forwarded-*` headers when behind a proxy.

## Vercel

Zero-config deploy:

```sh
pnpm dlx vercel
```

Vercel detects the Next.js app under `apps/web/` because of the workspace setup. You'll need to:

1. Set the root directory to `apps/web/`.
2. Set the build command to `cd ../.. && pnpm build`.
3. Set the install command to `cd ../.. && pnpm install`.
4. Add `GITHUB_TOKEN` as an environment variable (optional but recommended).

Or use the included `vercel.json` if one is added later.

## Netlify

Similar to Vercel:

1. Set the base directory to `apps/web/`.
2. Build command: `cd ../.. && pnpm build`.
3. Publish directory: `apps/web/.next/`.
4. Add `GITHUB_TOKEN` as an environment variable.

## Plain Node

```sh
pnpm install
pnpm build
NODE_ENV=production pnpm start
```

The host listens on `process.env.PORT` (defaults to 3000).

For a process manager (PM2, systemd, etc.), wrap `pnpm start`. The Next.js standalone output makes the container surface minimal — you don't need to ship `node_modules` to your runtime if you copy `apps/web/.next/standalone/` and the public assets.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `GITHUB_TOKEN` | GitHub GraphQL token for richer GitHub data (5000 req/hr, contribution heatmap, full pinned items) | unset (REST fallback at 60 req/hr) |
| `PORT` | Port the host binds to | `3000` |
| `NEXT_PUBLIC_BASE_URL` | Canonical URL for OG/SEO | inferred from request |

`.env` files are gitignored. Use `.env.example` as a template.

## Caching

The host uses Next.js fetch revalidation:

- **GitHub data:** 1 hour (`revalidate: 3600`). The `cache()` wrapper memoizes within a request.
- **Static metadata:** built at build time.
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
- `node skills/portfolio-author/scripts/validate.mjs portfolio.yml` exits 0
- `pnpm build` exits 0
- The dev server renders correctly in light, dark, bright, black, and system themes
- `/feed.xml`, `/robots.txt`, `/sitemap.xml` all 200 if your variant declares those capabilities

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
