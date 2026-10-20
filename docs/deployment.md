# Deployment

The server runs one deployment profile, chosen by `PORTFOLIO_PROFILE` at startup:

- `read-only` serves your portfolio from a mounted directory, with no editing surface.
- `demo` serves the bundled sample pair, for a product demo, and asks crawlers to index nothing.
- `owner` adds Studio, drafts, and revisions to your portfolio. It doesn't start yet: it needs an authentication provider, and none ships.

Run it in a container (recommended) or on Node. The browser editor, the variant gallery, the variant preview pages, and their write APIs are gone in every profile, `pnpm dev` included. Edit `config/portfolio.yml` and `config/site.yml` instead: `pnpm dev` picks up each save, and a production server picks them up when it restarts. While `config/` holds neither, `pnpm dev` renders the bundled examples; a production server refuses to start. `pnpm dev` listens on every network interface; on a network you don't trust, run `pnpm dev --hostname 127.0.0.1`.

## Profiles

What each profile grants. `public` is anyone, `session` is a signed-in owner (no release can sign in yet), and `absent` means the profile has no page, route, or operation for it, so a request gets a 404. A unit test keeps this table in step with `apps/web/src/server/capabilities.ts`.

<!-- profile-matrix:start -->

| Capability       | What it covers                               | `owner`   | `demo`   | `read-only` |
| ---------------- | -------------------------------------------- | --------- | -------- | ----------- |
| `catalog.read`   | The portfolio's pages and metadata routes    | `public`  | `public` | `public`    |
| `feed.read`      | `/feed.xml`                                  | `public`  | `absent` | `public`    |
| `sample.read`    | `/sample`, the bundled sample in any variant | `absent`  | `public` | `absent`    |
| `reference.read` | The reference portfolio (not built yet)      | `absent`  | `public` | `absent`    |
| `sandbox.view`   | The demo Studio (not built yet)              | `absent`  | `public` | `absent`    |
| `health.read`    | `/api/health`                                | `public`  | `public` | `public`    |
| `ready.read`     | `/api/ready`                                 | `public`  | `public` | `public`    |
| `auth.session`   | Signing in and out                           | `public`  | `absent` | `absent`    |
| `source.read`    | The portfolio's source document              | `session` | `absent` | `absent`    |
| `draft.read`     | The draft                                    | `session` | `absent` | `absent`    |
| `history.read`   | Published revisions                          | `session` | `absent` | `absent`    |
| `draft.write`    | Draft edits, variant changes included        | `session` | `absent` | `absent`    |
| `config.import`  | Importing a portfolio                        | `session` | `absent` | `absent`    |
| `config.export`  | Exporting the portfolio                      | `session` | `absent` | `absent`    |
| `studio.view`    | Studio's pages                               | `session` | `absent` | `absent`    |
| `config.status`  | The redacted deployment summary              | `session` | `absent` | `absent`    |
| `publish`        | Publishing the draft                         | `session` | `absent` | `absent`    |
| `rollback`       | Going back to an earlier revision            | `session` | `absent` | `absent`    |
| `asset.write`    | Uploading assets                             | `session` | `absent` | `absent`    |
| `preview.grant`  | Preview links                                | `session` | `absent` | `absent`    |

<!-- profile-matrix:end -->

Every profile serves `/`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, `/api/health`, `/api/ready`, and `/api/studio/<operation>`. `owner` and `read-only` add `/feed.xml`, and `demo` adds `/sample`. Every Studio operation goes through `/api/studio/<operation>`, and one the profile lacks answers with the 404 envelope, `{"error":{"code":"not_available_in_profile",...}}`. There is no image optimizer: images load as they are, and `/_next/image` answers with the 404 page in every profile.

## Supported hosts

- `owner` needs a container with a persistent volume for its data directory.
- `read-only` and `demo` run in a container or on plain Node.
- Serverless hosts (Vercel, Netlify, and the like) aren't supported yet. Nothing verifies there that the server finds its source directory or stops on a bad setting.

## Docker (recommended for self-hosting)

The repo ships a `Dockerfile` and one Compose example per profile. They all build the same image; only the environment and the mounts differ.

| File                       | Profile     | Run it from |
| -------------------------- | ----------- | ----------- |
| `docker-compose.yml`       | `read-only` | the repo    |
| `deploy/compose.demo.yml`  | `demo`      | `deploy/`   |
| `deploy/compose.owner.yml` | `owner`     | `deploy/`   |

Each one publishes the server on `127.0.0.1` only, on port `3000` unless `PORT` is set, for the TLS-terminating proxy in front of it (see [Reverse proxy and HTTPS](#reverse-proxy-and-https)). Each reads `PORTFOLIO_ORIGIN` from the `.env` beside it and refuses to start without one.

### `read-only`

```sh
cp portfolio.example.yml config/portfolio.yml   # then make it yours
cp site.example.yml config/site.yml             # its appearance and which sections show
echo 'PORTFOLIO_ORIGIN=https://jane.name' > .env
docker compose up --build
```

This mounts `config/` read-only at `/config` and `assets/` at the site's `/assets/`. Nothing in the container is writable but a tmpfs at Next.js's cache, `/app/apps/web/.next/cache`.

### `demo`

```sh
cd deploy
echo 'PORTFOLIO_ORIGIN=https://demo.jane.name' > .env
docker compose -f compose.demo.yml up --build
```

`demo` renders the bundled sample pair and mounts nothing, on the same read-only root and cache tmpfs as `read-only`.

### `owner`

`deploy/compose.owner.yml` mounts `../config` and `../assets` as `read-only` does, and keeps drafts and revisions in the `portfolio-data` volume at `/var/lib/portfolio` (`PORTFOLIO_DATA_DIR`). The image creates that directory for the server's user (uid 1001, mode `0700`), so a new volume starts out writable by the server and no one else. Run one server per volume: the fixed container name stops `docker compose up --scale`. Back the volume up.

It refuses to start until a release ships an authentication provider.

### What the image does

- Multi-stage build: deps, build, then run.
- Installs only production dependencies in the runtime stage.
- Runs `pnpm build` to produce a Next.js standalone output. The build needs no deployment settings, and the image sets no `PORTFOLIO_*` defaults: a setting outside the profile's column stops a production server, so a default would stop `demo`.
- Under `read-only` and `owner`, reads the portfolio and site documents from `PORTFOLIO_SOURCE_DIR`, the mounted `config/`, and never renders the bundled examples in production.
- Its `HEALTHCHECK` asks `/api/health`.

### Updating the portfolio

The server reads `config/portfolio.yml` and `config/site.yml` once, at startup. After you edit either, restart the container:

```sh
docker compose restart web
```

If the edit is invalid, the server logs its `config.fatal` lines and exits 1. The examples set `restart: unless-stopped`, so Docker restarts the container in a loop, and each restart logs the same `config.fatal` block again until you fix the file. `docker compose logs web` shows where the problem is. Once the file is fixed, the next restart serves the site, or run `docker compose restart web` to start it right away.

To add a variant package or pick up a new release, rebuild:

```sh
docker compose up --build
```

### Migrating from the one-file format

Earlier releases read one unversioned `portfolio.yml` that held the content and the appearance together. This release splits it into a portfolio document and a site document, both at `schemaVersion: 2`, and refuses the old file. `pnpm config:migrate` converts it, and changes nothing until you ask it to:

```sh
pnpm config:migrate config/portfolio.yml
```

It prints each field it moves and each value it fills in, the values it needs from you with the ids this build accepts, the section ids it gives, the old file's comments it can't keep, the new documents' diagnostics, a diff of the new portfolio document, and the whole site document. The color scheme and typography always need a value: no old id carries over. Until you give them, the diagnostics come from a check with placeholders in their place, so content problems show on the first run. Give each value with `--set`, drop the keys the old schema ignored with `--drop-unknown` (or remove them from the file), pass the site's real public origin with `--origin` to check the links against it, then write both documents into a directory:

```sh
pnpm config:migrate config/portfolio.yml \
  --set site.appearance.colorScheme=warm --set site.appearance.typography=classic \
  --drop-unknown --origin https://example.com --write --out config/new
```

It never writes over a file and never changes the old one, so move the new `portfolio.yml` and `site.yml` into `config/` yourself. A JSON file becomes `portfolio.json` and `site.json`. The old `meta.url` has no place in either document. The migration prints its origin as a starting point for `PORTFOLIO_ORIGIN`, but never checks links against it, since it often names an old domain. Section ids come from the anchors the old navigation linked to, the linked sections first, and the report names each section whose anchor changes. `--set portfolio.sections.<n>.id=<id>` keeps any other. A `locale`, `direction`, or section `lang` the old file already has carries over. A `portfolio.toml` has to become YAML or JSON first.

If the old file holds anything shaped like a secret (a GitHub token, a private key, a password hash, an AWS key ID), in a field, a key, or a comment, the report says where and what kind, and shows no value, diff, or document until you remove it. Revoke it too.

It exits 0 when the file is already current or nothing stopped the migration, 2 when it needs a value, a decision on unknown keys, or a fix for a problem the new documents would have, and 1 for anything else. `--summary` leaves every value from the documents out of the report, so it can go to a log.

On a host without Node, run it in the image's build stage, with the old file's directory mounted. It needs no network:

```sh
docker build --target builder -t portfolio-builder .
docker run --rm --network none -v "$PWD/config:/config" portfolio-builder \
  pnpm config:migrate /config/portfolio.yml
```

Add the `--set`, `--drop-unknown`, and `--write --out /config/new` arguments to the second command to write the documents. They're written as root; `chown` them afterwards if the host needs another owner.

### Reverse proxy and HTTPS

Put Nginx, Caddy, or Traefik in front, pointed at `http://127.0.0.1:3000` (or the port you set), and terminate TLS there. The app builds every absolute URL from `PORTFOLIO_ORIGIN`; it never reads `Host` or `X-Forwarded-*` for one. Set `PORTFOLIO_TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`.

That address is for a proxy on the host. A proxy in another container can't reach a port published on the host's `127.0.0.1`: put the proxy and the app on one Docker network, point the proxy at the app's service name (`http://web:3000` in these examples), and drop the `ports:` entry if nothing on the host needs it.

The proxy knows the site is on HTTPS, so it sends `Strict-Transport-Security`. In a Caddy site block, for example:

```
header Strict-Transport-Security "max-age=31536000"
```

Add `includeSubDomains` only when every subdomain serves HTTPS.

## Startup checks

Before it takes a request, the server validates its settings and the two documents. A problem stops it with exit code 1 and one `config.fatal` JSON line per problem on stdout. Each line names the setting, never its value, and for a document adds the diagnostic code, the file, the JSON pointer, the line and column, and what to do about it. [configuration.md](configuration.md#validation) explains every code.

| The server finds                                                                                                                                                                                            | Profiles         | It                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE` missing, or not exactly `owner`, `demo`, or `read-only`                                                                                                                                 | all              | refuses to start                                                                                    |
| `PORTFOLIO_ORIGIN` missing, not a bare origin, or `http` for an `owner` host that isn't loopback                                                                                                            | all              | refuses to start                                                                                    |
| A key and its `_FILE` both set, or an unreadable `_FILE`                                                                                                                                                    | all              | refuses to start                                                                                    |
| Proxy hops that aren't a whole number, or a preview origin that is invalid or `PORTFOLIO_ORIGIN`                                                                                                            | all              | refuses to start                                                                                    |
| `PORTFOLIO_PATH` or `NEXT_PUBLIC_BASE_URL`                                                                                                                                                                  | all              | refuses to start, naming the setting that replaced it                                               |
| A setting outside the profile's column, such as `GITHUB_TOKEN` under `read-only`                                                                                                                            | all              | refuses to start in production; `pnpm dev` warns and ignores it                                     |
| A source directory that is missing, unreadable, or a file rather than the directory holding it                                                                                                              | owner, read-only | refuses to start                                                                                    |
| A source directory without `portfolio.yml` or `site.yml` (`source.missing`), with one in two formats (`source.duplicate`), or with one the server can't read (`source.unreadable`)                          | owner, read-only | refuses to start; with neither document, `pnpm dev` renders the bundled examples and warns          |
| A portfolio in the old one-file format, or a `portfolio.toml`                                                                                                                                               | owner, read-only | refuses to start with one `legacy.document` line; [migrate it](#migrating-from-the-one-file-format) |
| A document that isn't one plain YAML or JSON document                                                                                                                                                       | owner, read-only | refuses to start                                                                                    |
| A document over 1 MiB, nested more than 64 levels, or with over 10,000 entries in a mapping or list                                                                                                         | owner, read-only | refuses to start                                                                                    |
| A document without `schemaVersion: 2` or that fails its schema, or a portfolio with two sections on one `id`                                                                                                | owner, read-only | refuses to start                                                                                    |
| A key the schema doesn't define, outside `extensions`                                                                                                                                                       | owner, read-only | refuses to start, suggesting the closest allowed key                                                |
| A `url`, `src`, or `*Url` that isn't `https`, `http`, `mailto`, `tel`, relative, or a `#fragment`                                                                                                           | owner, read-only | refuses to start                                                                                    |
| A site document with an appearance id this build doesn't register (`appearance.unknown`), a section the portfolio doesn't have (`ref.missing`), or a deployment setting (`site.deployment-setting`)         | owner, read-only | refuses to start                                                                                    |
| A pair with no visible section (`content.empty`), a `#fragment` link to no visible section (`anchor.broken`), one metric with two values (`metric.conflict`), or a secret-shaped string (`secret.detected`) | owner, read-only | refuses to start                                                                                    |
| An origin on a reserved example domain, or the bundled sample's `identity.name`                                                                                                                             | owner, read-only | refuses to start in production; `pnpm dev` warns                                                    |
| No authentication provider                                                                                                                                                                                  | owner            | refuses to start: configure sign-in or choose `read-only`                                           |
| A bundled sample pair that is missing, can't be read, or doesn't validate, so the build is broken                                                                                                           | demo             | refuses to start                                                                                    |

The old one-file format has no `schemaVersion` and has `identity`, `sections`, `variant`, `theme`, `motionPreference`, `colorScheme`, or `typography` at the top. Its one `legacy.document` line names each old field and where it goes now, and nothing else is reported; a `portfolio.toml` can only be that format. A plain YAML document has no anchors, aliases, merge keys, tags, directives, repeated keys, or second document. The reserved example domains are `example.com`, `.net`, and `.org` with their subdomains, `.example`, and `.invalid`. Image sources may also be raster `data:image` URLs.

Data under an `extensions` key, or a section whose `kind` is `<npm package name>/<name>`, belongs to a content extension. This release registers none, so the server keeps that data as written, logs a `config.warning` with code `extension.unregistered` for each use, and never renders it. It also starts, with a `config.warning`, on a link to a sample address such as a `.test` host (`origin.sample`), a link to a host that differs from the origin's only in its last label (`origin.stale`), and a metric repeated across sections (`metric.duplicate`).

## Health and readiness

`GET /api/health` is liveness. It does no I/O and answers 200 with `{"status":"ok","profile":"read-only"}` while the server runs. The image `HEALTHCHECK` uses it.

`GET /api/ready` is readiness, for a load balancer or an orchestrator. Next holds requests until startup finishes, so a client usually just waits; one that reaches the app before then gets 503 with `{"status":"starting"}`. After startup it answers:

```json
{
  "status": "ready",
  "profile": "read-only",
  "capabilities": [{ "id": "catalog.read", "access": "public" }],
  "checks": [
    { "id": "catalog", "status": "ok" },
    { "id": "packs", "status": "ok" },
    { "id": "owner-modules", "status": "ok" }
  ]
}
```

`capabilities` lists every capability the profile grants. The checks are `catalog` (the document pair loads), `packs` (the site's variant loads), and, under `demo` and `read-only`, `owner-modules` (no Studio, storage, or sign-in code has loaded). A failed check makes it 503 with `"status": "unavailable"`. When a startup requirement fell back to a degraded mode, it's 200 with `"status": "degraded"`. Neither endpoint returns a path, a value, or portfolio content, and both send `Cache-Control: no-store`.

## Logs

The app writes its log as one JSON object per line on stdout, with `ts`, `level`, and `event`, and only these other fields: `requestId`, `profile`, `route` (the route pattern, never the URL), `operation`, `capability`, `status`, `code`, `key`, and `digest`. `config.fatal` and `config.warning` add `file` (relative to the source directory), `document`, `path`, `line`, `column`, `stableId`, `message`, and `remediation`. No line of the app's carries a request body, a cookie, `Authorization`, a raw URL, or a secret value.

Next writes its own lines to the same streams, as plain text: its startup banner on stdout (`▲ Next.js`, the address, `✓ Ready`), and on stderr, the message and stack of each error it catches, next to the app's `request.error` line, and a line naming the request URL when a request handler crashes. Those can name server paths and request URLs. None of them is JSON, so a log pipeline keeps the app's lines by parsing each line as a JSON object.

| Event               | When                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `config.fatal`      | A startup check failed. The server exits 1 after the last one.                                                                |
| `config.warning`    | A startup check found something to fix that doesn't stop the server.                                                          |
| `deployment.config` | Once, at startup: the redacted settings summary.                                                                              |
| `request.error`     | A page or route failed. `digest` is the reference code the error page shows the visitor.                                      |
| `operation.failed`  | A Studio operation failed. Its response carries the same `requestId`.                                                         |
| `feed.failed`       | `/feed.xml` couldn't be built: `code` is `catalog_unavailable` or `render_failed`. Its response carries the same `requestId`. |

`deployment.config` adds `origin`, `previewOrigin`, `proxyHops`, `capabilities`, `adapters` (which catalog the profile reads), and `secrets`, each secret only as `set` or `unset`. The owner-session `config.status` operation returns the same summary; no anonymous route does.

## Response headers

Every response the app sends carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy: frame-ancestors 'none'`, so no other site can frame the pages, and a fresh `X-Request-Id`. Under `demo`, each adds `X-Robots-Tag: noindex`. Next's redirect for a trailing slash has none of them: Next answers `/sample/` with a 308 to `/sample`, whose body is only that path, before the app sees the request. `Strict-Transport-Security` belongs at the TLS proxy (see [Reverse proxy and HTTPS](#reverse-proxy-and-https)).

## Plain Node

```sh
pnpm install
pnpm build
PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \
  PORTFOLIO_SOURCE_DIR=../../config pnpm start
```

`pnpm start` runs from `apps/web`, so the relative source directory is the repo's `config/`. The host listens on `process.env.PORT` (defaults to 3000).

For a process manager (PM2, systemd, etc.), wrap `pnpm start` with the same environment. You don't need to ship `node_modules` to your runtime if you copy `apps/web/.next/standalone/` and the public assets.

### Demo

`demo` renders the bundled sample, `portfolio.example.yml` and `site.example.yml`, and reads no source directory; setting `PORTFOLIO_SOURCE_DIR` stops a production server. Its origin is the demo hostname:

```sh
PORTFOLIO_PROFILE=demo PORTFOLIO_ORIGIN=https://demo.jane.name pnpm start
```

`/` shows the sample in the sample site's appearance, and `/sample?variant=<slug>&scheme=<id>&typography=<id>` in any registered variant, color scheme, and typography preset. `/sample` overrides only what its query names and keeps the rest of the sample site's appearance. An unknown variant is a 404, and a scheme or preset the variant doesn't declare falls back to the variant's default. The sample's `github` section doesn't render, since it would fetch a live account. Until the demo's indexing rules are settled, every response the app sends has `X-Robots-Tag: noindex`, `robots.txt` disallows everything, the sitemap is empty, and there is no feed. Every Studio operation answers with the 404 envelope.

## Environment variables

The server reads these from its environment only. Every key also accepts `<KEY>_FILE`, the path of a file holding the value (such as a Docker secret); set one or the other. An empty value counts as unset. `.env.example` lists them all.

| Variable                       | Profiles         | Purpose                                                                           |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE`            | all              | Required. Exactly `owner`, `demo`, or `read-only`.                                |
| `PORTFOLIO_ORIGIN`             | all              | Required. The origin visitors use, such as `https://jane.name`: no path or slash. |
| `PORTFOLIO_SOURCE_DIR`         | owner, read-only | Directory holding one `portfolio.{yml,yaml,json}` and one `site.{yml,yaml,json}`. |
| `PORTFOLIO_TRUSTED_PROXY_HOPS` | all              | How many trusted proxies append to `X-Forwarded-For`. Whole number, default `0`.  |
| `PORTFOLIO_PREVIEW_ORIGIN`     | owner, demo      | Optional preview origin, different from `PORTFOLIO_ORIGIN`.                       |
| `PORTFOLIO_DATA_DIR`           | owner            | The writable data directory: `/var/lib/portfolio` in the owner example.           |
| `PORTFOLIO_AUTH_PASSWORD_HASH` | owner            | Reserved: the Studio password hash.                                               |
| `GITHUB_TOKEN`                 | owner            | Reserved. Public GitHub sections use unauthenticated REST and never send a token. |
| `PORT`                         | all              | Port the host binds to. Default `3000`.                                           |
| `PORTFOLIO_PATH`               | none: refused    | Replaced by `PORTFOLIO_SOURCE_DIR`. Setting it stops the server.                  |
| `NEXT_PUBLIC_BASE_URL`         | none: refused    | Replaced by `PORTFOLIO_ORIGIN`. Setting it stops the server.                      |

A key outside its profile's list stops a production server; `pnpm dev` warns and ignores it. `.env` files are gitignored. `pnpm dev` reads `apps/web/.env.development`, which runs `read-only` from `config/`.

## Caching

The host uses Next.js fetch revalidation:

- **GitHub data:** 1 hour (`revalidate: 3600`), and each request gives up after 3 seconds. The `cache()` wrapper memoizes within a request.
- **Metadata:** rendered per request (`robots.txt`, `sitemap.xml`, the Open Graph image, and the feed), from the documents loaded at startup and `PORTFOLIO_ORIGIN`. `features.feed: false` in the site document turns the feed off.
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
- `node skills/portfolio-author/scripts/validate.mjs config` exits 0
- `pnpm build` exits 0
- The dev server renders correctly in light, dark, bright, black, and system themes
- `/feed.xml`, `/robots.txt`, `/sitemap.xml` all 200, with URLs on your `PORTFOLIO_ORIGIN`
- `/api/ready` answers 200 with `"status": "ready"`
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
