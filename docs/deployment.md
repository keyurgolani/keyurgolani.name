# Deployment

The server runs one deployment profile, chosen by `PORTFOLIO_PROFILE` at startup:

- `read-only` serves your portfolio from a mounted directory, with no editing surface.
- `demo` serves the bundled sample pair, for a product demo, and asks crawlers to index nothing.
- `owner` adds Studio, drafts, and revisions to your portfolio, behind a sign-in with your password. It starts once the password's hash and a data directory pass their checks ([Owner authentication](#owner-authentication)).

Run it in a container (recommended) or on Node. The browser editor, the variant gallery, the variant preview pages, and their write APIs are gone in every profile, `pnpm dev` included. Edit `config/portfolio.yml` and `config/site.yml` instead: `pnpm dev` picks up each save, and a `read-only` server picks them up when it restarts. Under `owner`, the first start imports the mounted files, and from then on they're import input: an edit goes live only through `portfolio-store import` or a Studio publish ([The revision store](#the-revision-store)). While `config/` holds neither, `pnpm dev` renders the bundled examples; a production server refuses to start. `pnpm dev` and `pnpm start` listen on `127.0.0.1` only.

## Profiles

What each profile grants. `public` is anyone, `session` is a signed-in owner, and `absent` means the profile has no page, route, or operation for it, so a request gets a 404. A unit test keeps this table in step with `apps/web/src/server/capabilities.ts`.

<!-- profile-matrix:start -->

| Capability              | What it covers                                             | `owner`   | `demo`   | `read-only` |
| ----------------------- | ---------------------------------------------------------- | --------- | -------- | ----------- |
| `catalog.read`          | The portfolio's pages and metadata routes                  | `public`  | `public` | `public`    |
| `feed.read`             | `/feed.xml`                                                | `public`  | `absent` | `public`    |
| `sample.read`           | `/sample`, the bundled sample in any variant               | `absent`  | `public` | `absent`    |
| `reference.read`        | The reference portfolio (not built yet)                    | `absent`  | `public` | `absent`    |
| `sandbox.view`          | The demo Studio (not built yet)                            | `absent`  | `public` | `absent`    |
| `health.read`           | `/api/health`                                              | `public`  | `public` | `public`    |
| `ready.read`            | `/api/ready`                                               | `public`  | `public` | `public`    |
| `appearance.preference` | `POST /api/appearance`, the visitor's appearance cookie    | `public`  | `absent` | `public`    |
| `auth.session`          | Signing in and out                                         | `public`  | `absent` | `absent`    |
| `source.read`           | The portfolio's source document                            | `session` | `absent` | `absent`    |
| `draft.read`            | The draft                                                  | `session` | `absent` | `absent`    |
| `history.read`          | Published revisions                                        | `session` | `absent` | `absent`    |
| `draft.write`           | Draft edits, variant changes included                      | `session` | `absent` | `absent`    |
| `config.import`         | Importing a portfolio                                      | `session` | `absent` | `absent`    |
| `config.export`         | Exporting the portfolio                                    | `session` | `absent` | `absent`    |
| `studio.view`           | Studio's pages                                             | `session` | `absent` | `absent`    |
| `config.status`         | The redacted deployment summary                            | `session` | `absent` | `absent`    |
| `publish`               | Publishing the draft                                       | `session` | `absent` | `absent`    |
| `rollback`              | Going back to an earlier revision                          | `session` | `absent` | `absent`    |
| `asset.write`           | Uploading assets                                           | `session` | `absent` | `absent`    |
| `media.ingest`          | Deriving image renditions when a draft is saved            | `session` | `absent` | `absent`    |
| `media.fetchRemote`     | Fetching an https image source for a draft                 | `session` | `absent` | `absent`    |
| `source.refresh`        | Refreshing the draft's GitHub sections with GITHUB_TOKEN   | `session` | `absent` | `absent`    |
| `preview.grant`         | Preview frames, each by its own grant                      | `session` | `absent` | `absent`    |
| `appearance.fixtures`   | `/_fixtures/appearance`, in `APPEARANCE_FIXTURES=1` builds | `public`  | `public` | `public`    |
| `catalog.fixtures`      | `/studio/_catalog-fixture`, in `BUDGET_FIXTURES` builds    | `session` | `absent` | `absent`    |

<!-- profile-matrix:end -->

Every profile serves `/`, `/robots.txt`, `/sitemap.xml`, the share image at `/opengraph-image-12o0cb` (Next adds a suffix to a metadata route inside a route group, here the site's), `/api/health`, `/api/ready`, `/api/studio/<operation>`, and the image renditions under `/media/` ([Media](#media)). `owner` and `read-only` add `POST /api/appearance`, which sets the visitor's appearance cookie and takes no other method, `/feed.xml`, `/work/<slug>` (a public case study a visible section reaches; any other slug is the 404 page), and the path views of the site's variant below `/` and below `/work/<slug>`. `owner` also serves `/preview/<grant>/` and `/preview-assets/<grant>/`, only to a frame whose preview grant is active ([Preview grants](#preview-grants)). `demo` adds `/sample` and the same routes below it. Every Studio operation goes through `/api/studio/<operation>`, and one the profile lacks answers with the 404 envelope, `{"error":{"code":"not_available_in_profile",...}}`. There is no image optimizer: images load as they are, and `/_next/image` answers with the 404 page in every profile. A build made with `APPEARANCE_FIXTURES=1`, which is for tests, adds `/_fixtures/appearance` to every profile, as the `appearance.fixtures` row shows. Any other build grants that capability in no profile, so the path answers as an unknown one does. A build made with `BUDGET_FIXTURES`, also for tests, adds `/studio/_catalog-fixture` (#6), the catalog plates' fixture page, to `owner` alone, behind a session, as the `catalog.fixtures` row shows; under `demo` and `read-only` it answers as any unknown Studio path does, and any other build neither serves it nor ships its code. Setting the variable when the server starts only logs a warning.

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

This mounts `config/` read-only at `/config`, and `assets/` read-only at `/media`, the media root (`PORTFOLIO_MEDIA_ROOT`) the portfolio's media sources resolve under ([Media](#media)). Nothing mounts into the app's `public/`: images serve as renditions from `/media` ([Media](#media)), and `/assets/<file>` is a 404 in every profile. Nothing in the container is writable but a tmpfs at Next.js's cache, `/app/apps/web/.next/cache`, and one at the media cache `read-only` derives into, `/tmp/portfolio-media`, owned by the server's user.

### `demo`

```sh
cd deploy
echo 'PORTFOLIO_ORIGIN=https://demo.jane.name' > .env
docker compose -f compose.demo.yml up --build
```

`demo` renders the bundled sample pair and mounts nothing, on the same read-only root and cache tmpfs as `read-only`.

### `owner`

`deploy/compose.owner.yml` mounts `../config` and `../assets` as `read-only` does, on the same read-only root and Next.js cache tmpfs, and keeps drafts and revisions in the `portfolio-data` volume at `/var/lib/portfolio` (`PORTFOLIO_DATA_DIR`). The image creates that directory for the server's user (uid 1001, mode `0700`), so a new volume starts out writable by the server and no one else. A host directory mounted there instead needs `sudo chown 1001:1001` and `chmod 0700` first: the store refuses one another user owns, or that its group or anyone else may write (`data_dir_not_private`). Run one server per volume: the fixed container name stops `docker compose up --scale`. Back the volume up with `portfolio-store backup` ([Backups](#backups)).

At its first start, on an empty volume, the server publishes `../config` as revision 1, or refuses to start on a pair a publish refuses ([Importing](#importing)). From then on the data directory is what visitors see, and `../config` is import input: an edit there changes nothing live until `portfolio-store import` or a Studio publish. The image ships the store's command line as `/app/bin/portfolio-store.mjs` ([The revision store](#the-revision-store)).

It needs the owner password's hash before it starts: write it into `deploy/secrets/` first ([Writing the hash](#writing-the-hash)). Then, with both documents in `config/`:

```sh
cd deploy
echo 'PORTFOLIO_ORIGIN=https://jane.name' > .env
docker compose -f compose.owner.yml up --build
```

Like every production server, it refuses to start while `identity.name` in `config/portfolio.yml` is the bundled sample's. Set `PORTFOLIO_TRUSTED_PROXY_HOPS` in `deploy/.env` to the number of proxies in front that append to `X-Forwarded-For`, usually `1`: `compose.owner.yml` passes it through, and leaves it at `0` when it's unset, which gives sign-in only its global limits ([Signing in](#signing-in)).

### What the image does

- Multi-stage build: deps, build, then run.
- Installs only production dependencies in the runtime stage.
- Runs `pnpm build` to produce a Next.js standalone output. The build needs no deployment settings, and the image sets no `PORTFOLIO_*` defaults: a setting outside the profile's column stops a production server, so a default would stop `demo`.
- Under `read-only` and `owner`, reads the portfolio and site documents from `PORTFOLIO_SOURCE_DIR`, the mounted `config/`, and never renders the bundled examples in production.
- Copies the app owned by root, so the server can't change its own code. The server's user (uid 1001) owns only the data directory, and the Compose examples give Next's cache a tmpfs. A `docker run` without one should add `--tmpfs /app/apps/web/.next/cache`.
- Its `HEALTHCHECK` asks `/api/health`.

### Updating the portfolio

Under `owner`, edit the files in `config/`, then import them from `deploy/`. Nothing restarts:

```sh
docker compose -f compose.owner.yml exec web node bin/portfolio-store.mjs import
```

A Studio publish goes live the same way, and a draft never does ([Importing](#importing)). A new case study's `/work/<slug>` serves once the server has read the revision that adds it. A Studio publish, rollback, or recover reads it as it commits, so the page serves on the next request. `portfolio-store import`, or a publish from the CLI, runs outside the server, so the page serves from the server's next read of the live revision, which any visitor page makes. Until then that slug is the 404 page. A case study a publish drops is the 404 page on the next request either way.

Under `read-only`, the server reads `config/portfolio.yml` and `config/site.yml` once, at startup. After you edit either, restart the container:

```sh
docker compose restart web
```

If the edit is invalid, the server logs its `config.fatal` lines and exits 1. The examples set `restart: unless-stopped`, so Docker restarts the container in a loop, and each restart logs the same `config.fatal` block again until you fix the file. `docker compose logs web` shows where the problem is. Once the file is fixed, the next restart serves the site, or run `docker compose restart web` to start it right away.

A variant is a dependency of `@portfolio/web` (`pnpm --filter @portfolio/web add <package>`), registered when the image builds; a package the build can't register stops the build with a diagnostic naming the package and the fix. To add one or pick up a new release, rebuild:

```sh
docker compose up --build
```

### Migrating from the one-file format

Earlier releases read one unversioned `portfolio.yml` that held the content and the appearance together. This release splits it into a portfolio document and a site document, both at `schemaVersion: 2`, and refuses the old file. `pnpm config:migrate` converts it, and changes nothing until you ask it to:

```sh
pnpm config:migrate config/portfolio.yml
```

It prints each field it moves and each value it fills in, the values it needs from you with the ids this build accepts, the section ids it gives, the old file's comments it can't keep, the new documents' diagnostics, a diff of the new portfolio document, and the whole site document. The color scheme and typography always need a value: no old id carries over. Until you give them, the diagnostics come from a check with placeholders in their place, so content problems show on the first run. Give each value with `--set`, drop the keys the old schema ignored with `--drop-unknown` (or remove them from the file), pass the site's real public origin with `--origin` to check the links against it (here `https://jane.name`; a sample address such as `example.com` would turn the sample-link check off), then write both documents into a directory:

```sh
pnpm config:migrate config/portfolio.yml \
  --set site.appearance.colorScheme=warm --set site.appearance.typography=classic \
  --drop-unknown --origin https://jane.name --write --out config/new
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

Put Nginx, Caddy, or Traefik in front, pointed at `http://127.0.0.1:3000` (or the port you set), and terminate TLS there. The app builds every absolute URL from `PORTFOLIO_ORIGIN`; it never reads `Host` or `X-Forwarded-*` for one. With `PORTFOLIO_PREVIEW_ORIGIN` set, the proxy must pass each request's own `Host` on: the server tells the site's host from the preview origin's by it, and fails closed, so any other host, such as the upstream's name a proxy put in its place, gets only `/api/health` and `/api/ready`. Nginx's `proxy_pass` sends the upstream's name unless told otherwise, so add `proxy_set_header Host $host;` beside it. Caddy's `reverse_proxy` and Traefik keep the client's `Host` as they come. Set `PORTFOLIO_TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`. With `0`, the default, `owner` ignores the header and doesn't know where a request came from. With N, it takes the Nth entry from the right as the client, without a port or the brackets around an IPv6 address. That is the source the audit log records and sign-in limits by. Set it to exactly the proxies that append: a higher count takes an entry the client wrote itself.

The site has one canonical origin, `PORTFOLIO_ORIGIN`. Every canonical link, `og:url`, sitemap entry, feed link, and JSON-LD URL names it, whichever host a request came in on. Send every other name the site answers to, such as `www.` or an old domain, to it with a permanent redirect at the proxy, since the app can't tell a wrong public host from the proxy's own and never reads `Host` to find out. In Caddy, for a site on `jane.name`:

```
www.jane.name, old-jane.example {
	redir https://jane.name{uri} permanent
}
```

In Nginx, a `server` block for the other names with `return 308 https://jane.name$request_uri;`.

That address is for a proxy on the host. A proxy in another container can't reach a port published on the host's `127.0.0.1`: put the proxy and the app on one Docker network, point the proxy at the app's service name (`http://web:3000` in these examples), and drop the `ports:` entry if nothing on the host needs it.

The proxy knows the site is on HTTPS, so it sends `Strict-Transport-Security`. In a Caddy site block, for example:

```
header Strict-Transport-Security "max-age=31536000"
```

Add `includeSubDomains` only when every subdomain serves HTTPS.

## Owner authentication

`owner` signs one person in, the owner, with a password. The server never holds the password: it reads a scrypt hash of it from a secret file and checks each sign-in against that. `owner` starts once the hash, its file, and the data directory pass their checks.

### Writing the hash

`hash-password` asks for the password twice, with echo off, and prints its hash, one line starting `$scrypt$ln=17,r=8,p=1$`. The password takes 15 to 256 characters, and it's compared after Unicode NFKC normalization, so the same password typed on another keyboard still matches. The command never takes the password as an argument, and reads it only from a terminal. Its `--stdin` flag, which reads both entries as two lines of standard input, is for tests.

From `deploy/`, write the hash where `compose.owner.yml` reads it, with the image you run:

```sh
mkdir -m 0700 secrets && sudo chown 1001:1001 secrets
docker run --rm -it --user 1001:1001 -v "$PWD/secrets:/out" <image> \
  node apps/web/bin/owner.mjs hash-password --out /out/owner_password_hash
```

`--out` creates the file with mode `0400` and no trailing newline, and never writes over one. Don't redirect the output of `docker run -t` to a file instead: the terminal puts a carriage return and the prompts in it. In a clone, `pnpm owner:hash-password` runs the same command, but a file it writes with `--out` belongs to you, and the server's user can't read a `0400` file it doesn't own: `sudo chown 1001:1001` it afterwards, or `sudo chown root:1001` it and `chmod 0440`. The image command above needs neither.

### The secret file

The server reads the hash from the file `PORTFOLIO_AUTH_PASSWORD_HASH_FILE` names, which `compose.owner.yml` sets to `/run/secrets/owner_password_hash`, the `owner_password_hash` secret from `deploy/secrets/owner_password_hash`. It has to be a regular file the server's user (uid 1001) can read and that neither group nor others can write: owned by uid 1001 with mode `0400`, or by `root:1001` with mode `0440`.

`PORTFOLIO_AUTH_PASSWORD_HASH` takes the hash itself, for a host that injects secrets as variables. Never put it in Compose's `environment:` or an `.env` file: Compose reads each `$` there as the start of a variable and corrupts the hash, unless every `$` is written `$$`. The file avoids that. `secrets/` is in `.gitignore` and `.dockerignore`, and no hash belongs in the repository or in either config document.

`owner` refuses to start when the hash is missing, set both ways, unreadable, not a regular file, writable by group or others, not a scrypt PHC string, weaker than `ln=17, r=8, p=1`, or past `ln=18, r=16, p=4`, which costs too much memory at each sign-in. The finding names the variable and the reason, never the hash.

### Changing the password

`--out` never writes over a file, so write the new hash under another name in `secrets/`, move it over `owner_password_hash` (`sudo mv`), and restart the container. Every session signs out at the restart: a changed hash revokes them all, so changing it back later brings none back. The audit log records `credential_changed`.

### The data directory

`owner` keeps its sessions, its preview grants, and its audit log in `PORTFOLIO_DATA_DIR`, the `portfolio-data` volume at `/var/lib/portfolio` in `compose.owner.yml`, beside the revision store ([The revision store](#the-revision-store)). At startup it creates `ephemeral/auth/sessions/` and `audit/` there with mode `0700`, and checks that it can write, sync, and rename a file, the way it writes session records. It refuses to start when the variable is unset, names no directory, or names one the server's user (uid 1001) can't reach or write, that another user owns or others can write, or where a store directory such as `drafts/` is a symbolic link. It makes `ephemeral/preview/` the same way the first time Studio opens a preview. Run one server per data directory: the running one holds `publication/server.json`, and lets it go as it stops, and a second server refuses to start while that claim is fresh. When the CLI holds the publication lock through startup, as through a backup, the server starts anyway, serves visitors, and claims the directory once the lock is free. Until it has, and while another server holds the directory, owner writes answer 503, and `config.status` says why under `writes`. Under `pnpm dev`, an unset `PORTFOLIO_DATA_DIR` is `.data/` at the workspace root, which git and Docker ignore.

`ephemeral/` holds sessions, auth state, and preview grants only, and never belongs in a backup. `portfolio-store backup` leaves it out, so its restore brings back no session at all ([Backups](#backups)). A file-level copy of the whole volume holds it, and restoring one brings back sessions revoked since the copy was taken: run [`revoke-sessions`](#revoking-sessions) after restoring one.

Keep `publication/` in every backup with `revisions/`: it holds `live.json` and `events/`. A store that has lost both serves the mounted documents, as an empty one does, unless `revisions/` holds a tombstone, and startup leaves every revision in it as it is.

### Signing in

A sign-in posts the password to `/api/studio/auth.login`, as JSON or as a form post, from the site's own origin: the request needs an `Origin` exactly equal to `PORTFOLIO_ORIGIN`. A JSON sign-in gets the session in the JSON envelope, and a form post a 303: to where the owner was going, or back to `/studio/sign-in` with a `state` saying why. The sign-in page at that path makes the form post, and works without JavaScript; with it, the page posts JSON and shows each state in place, and a toggle can show the password. It asks for the password alone, with the username fixed to `owner` for password managers. Under `demo` and `read-only` the page answers as a path no route matches, with the same 404 page and headers, and every auth route answers the 404 envelope of an operation the profile lacks. Where the owner was going is `returnTo`, a path under `/studio` other than the sign-in page itself, from the form's `returnTo` field, or else the `returnTo` in the URL, and `/studio` when it's missing or unsafe. Every wrong, missing, or malformed password costs one verification and gets the same answer.

A form post whose body can't be read, because it isn't UTF-8, gives a field twice, or is over 4 KB, runs no verification and gets a 303 to `/studio/sign-in?state=error`, keeping the URL's `returnTo`. A JSON sign-in whose body isn't UTF-8, doesn't parse, or is over 4 KB gets 400 `invalid_input`.

Sign-in has limits, kept in memory, so a restart clears them, and none locks the owner out for good:

- 5 failures from one source in 15 minutes block it for a minute, and each further failure doubles the block, up to 15 minutes. A success clears the source, and so do 15 quiet minutes after its block. A source is an IPv4 address or an IPv6 /64.
- A source has one attempt in flight at a time, from before its body is read until it has its answer, and another gets 429 with `Retry-After: 1` at once, so a source's attempts verify one at a time and a burst gets no more verifications than the limit. A form submitted twice gets that 429 for its second post.
- Once the last hour has seen 50 failures from anywhere, every attempt waits 2 seconds before its verification. It waits before it takes a verification slot, so waiting attempts never hold one, and at most 16 wait at once: another gets 429 with `Retry-After: 1` at once.
- At most 2 verifications run at once, since each takes 128 MiB at the hash's floor. A third attempt gets 429 with `Retry-After: 1`.

A throttled form post gets a 303 to `/studio/sign-in?state=rate_limited` with `retryAfter`, in seconds, instead of the 429. The sign-in page's form carries `returnTo` in its URL as well as its field, so a post turned away before its body is read still keeps where the owner was going. Being turned away never counts as a failure, so nobody can get your own address blocked by crowding sign-in.

The per-source limits need `PORTFOLIO_TRUSTED_PROXY_HOPS`. With `0`, nothing names a source, so sign-in has only the global limits: one client that keeps both verification slots busy, or all 16 places to wait taken, gets the owner's own sign-in a 429, and `owner` warns at startup. Run it behind a proxy with the hop count set ([Reverse proxy and HTTPS](#reverse-proxy-and-https)). Each source then has its own limit, one of the 16 places, and one of the 2 verification slots at most, but many sources, such as rotating IPv6 /64s, can still keep them all taken: sign-in then answers 429 until a place frees, and trying again gets you in.

### Sessions

A sign-in starts a session, named by a random token that only the browser's cookie holds. The server keeps the token's SHA-256 digest, so the data directory holds no token. A session lasts 60 minutes idle and 12 hours in all, however busy. `PORTFOLIO_AUTH_SESSION_IDLE_MINUTES` (5 to 120) and `PORTFOLIO_AUTH_SESSION_MAX_HOURS` (1 to 24) change those, and any other value stops the server. Only a Studio command, or a Studio page the owner opens from the site or the address bar, counts as use, never a query, a prefetch, or a frame, so a Studio tab left open still signs out, and a page on another subdomain of the same site, whose requests your browser sends the cookie with, can't keep a session alive. At most 5 sessions exist at once: a sixth sign-in ends the least recently used.

Every Studio page but sign-in needs a session. A request for one with no session cookie gets a 303 to `/studio/sign-in`, keeping where it was going in `returnTo`, and one whose cookie no longer counts gets a 307 there with `state=session_ended`. `/studio` is the Owner Studio (#8): its tasks down the side, where the draft stands in words across the top, and the content task's source mode, which edits the working draft's portfolio and site documents, and its media document when it has one, as text and saves them as a new draft version. A save never changes the live site, and publishing from Studio isn't open yet. The Appearance task chooses the composition, design language, color scheme, typography, and display mode, each on its own, with whether visitors may pick their own, and says before publish what each choice is, where it comes from, what it costs, and what the checks found; its selectors list only what this build ships, never the fallback composition or a Research pack, though the preview's own appearance override can still render one for review. Applying saves one edit per change as a new draft version, so the rest of the site document stays as you wrote it, and text you type in the content task while it applies is kept: Studio shows the applied version beside it and asks which to keep. Below it is a preview of the saved draft, in the same frame `/studio/preview` uses, whose own controls change the frame and never the draft, and which can show any section. A save names the version it started from, so when another tab or the command line saved first, nothing is overwritten: Studio shows the newer version beside your text and asks which to keep. Text you haven't saved is kept in this browser, one copy per tab, for 7 days from your last edit, under Studio's own storage key, and comes back when you open Studio again. It's kept as plain text: anyone at this computer, and any script on the site's pages, can read it until it expires or you discard it. Signing out while any tab's is kept asks whether to keep it or discard it, as you should on a shared computer, and discarding clears every open Studio tab's too. When the session ends, Studio keeps that text, clears the page, and goes to sign-in, coming back to the task you were on. `/studio/preview` shows the working draft or the live revision in a preview frame ([Preview grants](#preview-grants)). When the session ends there, or in another tab, the frame empties and the page offers to sign in again, keeping its place.

A session ends at sign-out, when it's revoked, when it expires, when the password hash changes, and when `revoke-sessions` runs.

Signing out, `/api/studio/auth.logout`, always answers as signed out. It clears the cookie and sends `Clear-Site-Data: "cache"` whether the session still counted, had ended, or the store couldn't be read, and ends the session if it counted. When the store can't end it, the server logs `logout.store_failed`, and the session ends at its idle limit, with no cookie left to carry it. It needs an `Origin` exactly equal to `PORTFOLIO_ORIGIN`, and with a session that counts, that session's CSRF token.

### Revoking sessions

To sign every session out without changing the password, run `revoke-sessions` in the server's container, from `deploy/`:

```sh
docker compose -f compose.owner.yml exec web node apps/web/bin/owner.mjs revoke-sessions
```

It runs as the server's user, which owns the data directory, and refuses to run as anyone else. It deletes every session record, and the server refuses any session created before the run, even one a request in flight writes back. It runs outside the server's process, so it can't wait for a command that is already committing, such as a publish moving the live pointer: that one finishes, and the session's next request is refused. If `ephemeral/auth/revoked-before` is ever damaged, no session counts until `revoke-sessions` writes it again.

### Preview grants

Studio shows a draft, a published revision, or a test fixture in a sandboxed frame at `/preview/<grant>/`, where `<grant>` is a token Studio gets from `preview.grant.mint` for that frame alone. A grant is 128 random bits. The data directory keeps only its SHA-256 digest, under `ephemeral/preview/grants/`, and log lines name it by the first 8 characters of that digest. It belongs to the session that minted it, never to the cookie: a frame's requests carry no cookie, and each one checks the grant again, its session included, without counting as use of the session. A draft's grant shows the version it was minted for, and a version with `blocks-preview` findings gets no grant, only how many findings there are.

A grant lasts 15 minutes unless Studio renews it, and 2 hours at most, never past its session. `PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS` (60 to 3600) and `PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS` (300 to 43200) change those, and any other value, or an idle limit over the cap, stops the server. A grant ends when its session does, when Studio revokes it, and at its limits. A draft's grant also ends when the draft is published or discarded, from Studio or the CLI, and when Studio mints one for a newer version of it. A session holds 16 active grants at most, and a mint past that ends its oldest. An ended grant keeps its digest, without the copy of the draft it held, until its 2-hour cap, so Studio can say why it stopped.

Only a frame's own loads reach a grant: a `GET` or `HEAD` with `Sec-Fetch-Dest: iframe` for its page, and an image, video, audio, track, or font load for a draft-only asset under `/preview-assets/<grant>/`. Every other request under `/preview` and `/preview-assets` gets one static 404 page that says only that the preview isn't available, whether the grant ended, never existed, was opened in a tab of its own, or was asked for with another method. Under an active grant, `/preview-assets/<grant>/<assetId>/<sha256>/<rendition>.<ext>` serves a rendition of the media the grant pinned, a draft's at the version it was minted for, with `Cache-Control: private, no-store`; any other path there gets that page too. When an active grant's content can't be read, such as a revision damaged on disk, its frame gets a 500 that says the preview couldn't be shown, with a reference: the `digest` of the server log's `request.error` line, beside a `preview.render_failed` line that names the grant by its `grantRef`.

Studio's `/studio/preview` shows the working draft or the live revision in one such frame, sandboxed to `allow-scripts` alone, so the frame's document has no origin of its own. `PORTFOLIO_PREVIEW_ORIGIN` gives `owner` frames one: they load from that origin with `allow-same-origin` too, Studio's `frame-src` names it, and Studio takes the frame's handshake from it alone. Point it at the same server, through the same proxy, as `PORTFOLIO_ORIGIN`, on a host of its own that serves nothing else, under another registrable domain, such as `jane-preview.net` beside `jane.name`. On the same site, such as `preview.jane.name`, a frame's requests are same-site, so they carry the session cookie though it's `SameSite=Strict`: a frame still can't read Studio's answers, and a command still needs the `Origin` and the CSRF token, but a request from it reaches Studio's queries signed in. The server refuses a preview origin on `PORTFOLIO_ORIGIN`'s host, on any port, since cookies don't keep ports apart, and over http one on its site, where a frame could set cookies for Studio's host too. Over https it starts with one on its site, and logs a warning that names the risk. Leaving the variable unset is the safe default: frames stay opaque and cross-site. The server reads a request's `Host` to tell the two apart, for this alone: on the preview origin's host, only `/preview/*`, `/preview-assets/*`, `/_next/static/*`, and `/_portfolio/*` answer, and every other path is the 404 an unknown path gets, Studio and the site included. Only a `Host` naming `PORTFOLIO_ORIGIN`'s host gets the whole site, and any other gets the health checks alone, so the proxy must keep each request's `Host` (Reverse proxy and HTTPS, above). Without it, frames load from `PORTFOLIO_ORIGIN`, and stay opaque. `demo` frames never get `allow-same-origin`, with the variable or without.

### Media

Saving a Studio draft derives its media document (#10), and so do `portfolio-store import` and the first-start import: for each image asset, in the portfolio's order, `owner` reads the source, writes it and its renditions to the data directory's asset store, and records one asset revision under the source's SHA-256. An import starts from the live revision's records, so an unchanged source derives nothing again, and it prints a line for each source it couldn't use. `retention` keeps every source and rendition a revision or a draft references. Nothing ingests or fetches on a visitor request, and `demo` fetches nothing. A draft save's session needs `media.ingest`, and `media.fetchRemote` for an `https` source.

- A path resolves only under `PORTFOLIO_MEDIA_ROOT`. An absolute path, a `.` or `..` segment, or a link whose real path leaves the root is refused, and only regular files are read. Once a file is open, the path it really opened (`/proc/self/fd`, on Linux) is checked against the root again, so a directory swapped for a link while it reads is refused too, and so is a file whose open path `/proc` can't tell, such as one deleted since it opened. A hard link inside the root reads its target, wherever that is; the read-only mount is what stops anyone making one. The server only reads the root: startup warns when it can write there (`media_root_writable`) or when it names no directory (`media_root_missing`).
- An `https` source is fetched over https only, on port 443, never through a proxy the environment names, with at most 3 redirects and 15 seconds for the whole fetch. A special-use name, such as `localhost`, `*.local`, `*.test`, `*.internal`, or `*.home.arpa`, is refused without a lookup. Every request and every redirect resolves its host, and a host that resolves to a loopback, private, link-local, or cloud metadata address (`169.254.169.254` among them) is refused before anything connects. A remote source is fetched again only when its URL changes or its last fetch failed.
- A source is JPEG, PNG, WebP, or AVIF by its bytes, never its name or `Content-Type`, at most 20 MiB, and at most 100 megapixels decoded, 40 for a progressive JPEG or an interlaced PNG, and 16 for an AVIF, since those decode whole.
- A source decodes once, shrunk to the widest rendition as it loads. One derivation runs at a time, on one libvips thread, and each step of it stops after 30 seconds, which leaves the asset's last revision in place (`timeout`). A source at the caps takes up to about 800 MiB, a 12-bit AVIF with alpha the most, so give `owner` and `read-only` at least 1 GiB. A server that goes on to derive many large sources of different kinds can hold about 1.3 GiB, since the memory allocator keeps what a large decode took: give it 1.5 GiB if its media is large. These figures were measured on macOS; Linux's weren't, and its allocator may keep more, so give an `owner` container a memory limit of at least 2 GiB.
- Renditions are 480, 960, 1600, and 2400 pixels wide, up to the source's width, as WebP and JPEG, or WebP and PNG for a source with transparency. They apply the EXIF orientation and carry no EXIF, XMP, IPTC, GPS, or ICC data. The original is kept in the asset store and never served.
- A source that is missing, unreachable, refused, or not a valid image leaves the asset's last revision in place, marked unavailable; new bytes replace it only once they derive. Published revisions keep their own media document and blobs, so a changed or lost source never changes them.
- When `sharp`, the image library, won't load, startup warns (`media_renditions_unavailable`), draft saves derive nothing new and keep every revision they have, and published media keeps serving.

`read-only` and `demo` derive their media once the server starts, in the background, into `/tmp/portfolio-media`, a directory of the server user's own (one another user owns, or that others can open, is refused, and nothing derives). `read-only` reads sources under `PORTFOLIO_MEDIA_ROOT` and fetches `https` ones; `demo` reads the bundled sample's `example-media/` and fetches nothing. A changed media file changes what derives on the next start, so the log lists each asset revision's hash as it derives (`media.startup.asset`, with `assetId` and `sha256`). A private asset's id and hash never reach the log: `media.private.ingested` counts the private assets derived (`count`) and the private sources that couldn't be used (`unused`), here and on every draft save and import. Until it finishes, an image renders as unavailable; after that, the page shows the derived renditions.

Renditions serve at `/media/<assetId>/<sha256>/<rendition>.<ext>` in every profile, for the live revision's media alone: `owner`'s from the asset store, `read-only`'s and `demo`'s from the media cache. Each address names one immutable file, so it answers with `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, the rendition's own `Content-Type`, and no `Range`. It takes GET and HEAD alone: any other method gets a 405 with `Allow: GET, HEAD`. A private, unknown, or superseded asset, an original, a draft's media, and any other path there answer the same 404, with `Cache-Control: no-store`, so a private asset's existence never shows; a private record's media never reaches the page, its RSC payload, the feed, or the JSON-LD either. A rendition the media document lists whose blob is gone answers that 404 too, and the log says so once per asset (`media.blob.missing`, with `assetId`).

### Audit log

The server appends one JSON line per event to `audit/<yyyy-mm>.jsonl` in the data directory (UTC months, files `0600`). Each line is `{"at", "type", "actor", "outcome", "refs"}`. The events are sign-ins, failed and throttled sign-ins, sign-outs, revocations, evictions, password hash changes, and denied commands. `actor` is `owner`, `anonymous`, or `operator` (`revoke-sessions` and a changed hash), and `refs` may name the session by the first 8 characters of its digest, the source by its IPv4 /24 or IPv6 /48 prefix, the command, the capability, a reason code, the request ID, and a `count`. A denied command is `anonymous`, since a forged one carries the owner's cookie too, and names the session it carried. Anonymous failed and throttled sign-ins and denied commands are written once a minute per kind: the first at once, and the rest as one line with a `count` when the minute ends. No line holds a password, hash, cookie, CSRF token, full IP address, user agent, or request body. A failed write is logged and changes no decision.

## The revision store

Under `owner`, what visitors see is a published revision in `PORTFOLIO_DATA_DIR`, not the mounted files. A draft, from Studio, saves without changing anything live. A publish, an import, a rollback, or a recover writes a whole revision first, then moves the published pointer, `publication/live.json`, with one rename, so a crash leaves the old revision live or the new one, never a mix of the two. Every pointer move appends an event to the publication log.

### What the data directory holds

| Path                                    | What                                                                | Backed up |
| --------------------------------------- | ------------------------------------------------------------------- | --------- |
| `store.json`                            | The store's layout version                                          | yes       |
| `drafts/`                               | The working draft and its previous version                          | yes       |
| `revisions/<revisionId>/`               | One revision, never changed: its manifest, documents, and snapshots | yes       |
| `revisions/<revisionId>.tombstone.json` | A revision retention removed                                        | yes       |
| `publication/live.json`                 | The published pointer                                               | yes, last |
| `publication/events/<seq>.json`         | The publication log, one event per file                             | yes       |
| `publication/lock`, `server.json`       | The publication lock, and the running server's claim                | no        |
| `assets/sha256/`                        | Blobs, by the SHA-256 of their bytes (#10's media)                  | yes       |
| `audit/<yyyy-mm>.jsonl`                 | The audit log                                                       | yes       |
| `ephemeral/`                            | Sessions and auth state                                             | never     |

Directories are `0700` and files `0600`, owned by the server's user. Only local Linux volumes are supported: the store relies on a rename within a directory and on `fsync`. Each revision's media renditions and sources are blobs in `assets/sha256/`, so a backup holds what every revision shows. `../assets`, where the sources come from, stays a mount of its own: back it up beside the store.

### Running portfolio-store

The image ships the store's command line as `/app/bin/portfolio-store.mjs`. Run it in the server's container, which sets `PORTFOLIO_DATA_DIR` and `PORTFOLIO_SOURCE_DIR` and runs as the server's user, from `deploy/`:

```sh
docker compose -f compose.owner.yml exec web node bin/portfolio-store.mjs status
```

In a clone, `pnpm run store <command>` runs the same command line through tsx (`pnpm store` alone is pnpm's own command). It acts as `operator` and needs no session. It reads `PORTFOLIO_ORIGIN`, or `PORTFOLIO_ORIGIN_FILE`, as the server does, since the origin's warning rules go by it, and refuses one that isn't a bare origin (`origin_invalid`). It runs beside the server: every pointer move, draft write, and retention run takes the publication lock, and a backup holds it throughout. It never runs as root (`running_as_root`), and a command on a store, or a restore into a directory, runs only as the directory's owner (`not_data_dir_owner`): the server has to read what it writes, and root would follow a link someone put in the data directory. It prints revision IDs, hashes, codes, and the paths it was given, never a secret or a document's content. It exits 0 when the command did what it says, 1 when it was refused or failed, and 2 on a usage error. Ctrl-C, SIGTERM, or SIGHUP stops it where it is, after it releases the lock it holds, and it exits 130, 143, or 129.

| Command                                                             | What it does                                                                                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                            | The state (`live`, `degraded`, `incompatible`, or `empty`), the live revision and its unit hash, how many revisions there are, the last event, and who holds the lock. Exits 1 unless `live`. |
| `history`                                                           | Every publication event in `seq` order: its type, its revision, the revision it replaced, who, and when.                                                                                      |
| `verify`                                                            | Every file and hash: each revision reads whole, the pointer names one, the log runs from 1 to the live `seq`, and each blob's bytes match its name. It skips revisions retention removed.     |
| `import [--from <dir>] [--expect <revisionId\|empty>]`              | Makes the pair in `<dir>`, `PORTFOLIO_SOURCE_DIR` by default, the live revision ([Importing](#importing)).                                                                                    |
| `rollback --to <revisionId>`                                        | Makes an earlier revision live again, if this build can publish it. Drafts stay as they are.                                                                                                  |
| `recover [--to <revisionId>]`                                       | Makes the last known good revision live, or the one named.                                                                                                                                    |
| `unlock --force [--running]`                                        | Removes the publication lock. One touched in the last 2 minutes needs `--running` too.                                                                                                        |
| `backup --out <dir>`                                                | Copies the store into an empty or new directory ([Backups](#backups)).                                                                                                                        |
| `restore --from <dir> --into <dir>`                                 | Copies a backup into an empty or new directory, checks every hash, and runs `verify`.                                                                                                         |
| `retention [--keep <n>] [--remove <revisionId>] [--dry-run]`        | Deletes what nothing needs ([Retention](#retention)).                                                                                                                                         |
| `media check [--fetch-remote]`                                      | Reads each image source again and reports what changed against the live revision and the working draft ([Derived changes](#derived-changes)). Writes nothing.                                 |
| `sources refresh`                                                   | Fetches the working draft's GitHub sections into it with `GITHUB_TOKEN`, as Studio's refresh does ([Derived changes](#derived-changes)).                                                      |
| `changes list`, `changes accept <id...>`, `changes dismiss <id...>` | The working draft's derived changes, and the owner's decision on each ([Derived changes](#derived-changes)).                                                                                  |

### Importing

`import` reads the pair in `--from`, or in `PORTFOLIO_SOURCE_DIR`, the way startup reads it, validates it as a publish does, and makes it the live revision with an `import` event carrying the files' `sourceHash`. A pair that doesn't validate is `validation_failed`, with each record that blocks it, and nothing changes. It reads and checks the pair before it touches the data directory, so an import refused for its source, its pair, or a variant this build doesn't register leaves the data directory as it found it: an empty one stays empty, with no `store.json`, and the next first start or import sees a clean directory. When the files are the live revision's already, byte for byte, it writes no revision: the import is still recorded, as a new event on the same revision.

It expects the revision that was live when it started. If a Studio publish, another import, or a rollback moves the pointer first, the import is `live_conflict`, nothing changes, and running it again imports over what's live now. `--expect <revisionId>` names the expectation instead, and `--expect empty` expects a store with nothing live.

On an empty store, with no `publication/live.json` and no history, no event, moved aside or not, and no tombstone, owner's first start imports the mounted pair itself, as `operator`. A revision alone was never live, as a first publish that failed or crashed leaves one: it stays as it was, beside the import. The import is a publish, checked as `import` checks one: a pair that can't go live stops that start, and so does one a publish refuses, such as a site whose variant this build doesn't register, with the record naming the field and the fix. With the lock busy through startup, as through a backup, the server starts anyway, visitors get 503, and the import runs once the lock is free (`store_import_waiting`). A store that has published but has no `live.json` has lost its pointer: it serves its last known good, `degraded`, neither startup nor `import` imports into it (`pointer_missing`), and `recover` or a restore brings it back.

Once a revision exists, the mounted pair is import input: a missing, invalid, or old-format one only warns at startup, and the store serves what it did. An edit to it goes live only through `import` or a Studio publish.

The example site selects Editorial Evidence, the platform default, which this build registers (#13), so a first start on the bundled pair goes live. A site whose variant this build doesn't register is refused by a publish, an import, or a first start with `variant.unavailable`.

### Derived changes

A draft keeps two kinds of change apart. The owner's edits to the portfolio and site are authored. What changed that no edit made is derived, against the revision the draft started from:

- `source-moved`: an image's bytes are the same, read from another source, as after a rename.
- `source-replaced`: an image's bytes changed, from a new file or a metadata edit that rewrote it, so its renditions and dominant color changed too.
- `integration-refreshed`: a refresh froze new data for a GitHub section.
- `scheme-regenerated`: a draft save's generator made other tokens for a generated color scheme, from a new input or another generator version, or made its first ones.

A draft save that ingests media, and a refresh, record each change in the draft as pending. A publish that would carry one no one accepted fails with `derived.unapproved`, naming the asset or the section, and nothing goes live. Accept a change and the publish carries it. Dismiss it and the draft takes back the live revision's value for that asset, section, or scheme, on that write and every save after it, until the value changes again, which is a new change. A generated scheme's first tokens have no value before them to take back, so dismissing them is refused with `derived.dismiss_unavailable` and the draft stays as it was: accept them, or select another scheme. Studio's `draft.changes.accept` and `draft.changes.dismiss`, and `portfolio-store changes accept|dismiss <id...>`, are draft writes, with the draft's version checked. `draft.diff` gives #8's Studio both lists apart. An import, the first-start one included, brings no decision: what the operator's files bring counts as accepted, and an import into an empty store has nothing to compare. An image-derived color scheme is the exception, below. A change's id covers its cause, its subject, and the values before and after, but not when GitHub data was fetched, so a refresh of the same data keeps the change's id and its decision. The message names the id to accept or dismiss.

The gate always has something to compare against. When the live revision is damaged for good, a draft based on it and the publish both compare against the last known good revision, the one visitors get in its place, so a change made meanwhile is still held. With the live revision damaged and no healthy revision before it, a publish is refused with `live_unreadable` (Studio answers 409) and nothing goes live: `verify` says what's wrong, and `recover`, `restore`, or `import` repairs it. A read that may pass, such as `EMFILE`, stops a publish, a draft write, and `draft.diff` with `storage_unavailable` instead. The store runs the gate, and `id.reused`, itself at every publish and import, so no build's checks can leave them out.

A missing source changes no asset revision: the last one stays, marked unavailable, and so does what renders. A source that comes back with the same bytes is available again. Neither needs approval. `portfolio-store media check` reports all of them without writing anything: for the live revision and the working draft, each image is `unchanged`, `source-moved`, `source-replaced`, missing with its last revision kept, or `restored`. With neither a live revision nor a draft, it says so and exits 0. It reads local sources under `PORTFOLIO_MEDIA_ROOT`, and https ones only with `--fetch-remote`.

GitHub data reaches a page only as a frozen snapshot. Studio's refresh (`draft.refreshSources`, capability `source.refresh`) and `portfolio-store sources refresh` fetch each GitHub section of the working draft into it, and a publish freezes what the draft holds into the revision's `snapshots/github.json`, where renderers read it. No page calls GitHub. Only the refresh reads `GITHUB_TOKEN`, and without one it fetches nothing and says so (`token_unset`), changing nothing. A section whose fetch fails keeps the data it had, if it's for the account the section names. A refresh follows no redirect, and reads at most 5 MiB of an answer. A GitHub record is kept only for a section the portfolio still has, naming the same account in any case: edit a section's `username` and its old data is dropped on that write, and the section shows its profile link until a refresh. An import keeps the live revision's GitHub data on the same terms. One this build's schema refuses, as after a release tightens it, is left out with a `snapshot.dropped` warning, and the import goes on. A rollback brings back the revision's own.

A generated color scheme is one whose manifest declares a `generator`. When the draft's site selects one, as its `colorScheme`, or with a visitor's choice of scheme, by giving it an `appearanceInputs` entry, every draft save runs that generator on the entry and keeps the result in the draft as `derived.schemes[schemeId]`: the generator's id and version, the SHA-256 of the input it read, and both modes' tokens. A seed color's hash is the SHA-256 of its text lowercased. An asset is read only from the media service's asset store, as the bytes the draft's media record names, within the media limits (20 MiB, 100 megapixels), never fetched. Its hash is over its decoded pixels, not the file's bytes: the RGB rows when every pixel is opaque, else the RGBA rows, as `example-media/provenance.json` records them, so the same pixels encoded again are the same input. The server decodes a file once and keeps its hash by the file's SHA-256, for the last 256 files. A publish freezes the entries into the revision's `snapshots/schemes.json`, under the revision's digest, and only those made by the generator the scheme declares, at its version, from the input the site gives now, or the live revision's own, as a dismissal puts back. One that can't be made is `scheme.ungenerated` and holds the publish. Every result is a `scheme-regenerated` change until the owner accepts it, a first result included, at a store's first publish too. An import makes seed schemes and counts them as accepted, since the seed is text in the operator's files. It leaves an image-derived scheme out, with a `scheme.dropped` warning, until the owner accepts its tokens in a draft, and so with one it can't make; each renders its fallback meanwhile. Once the owner's accepted tokens are live, an import keeps them while the scheme's generator, its version, and the image's pixels stay the same. So no tokens made from an image go live before the owner accepts them. A draft's preview grant pins the draft's schemes when it's minted, so a later save doesn't change an open frame; an entry that doesn't check against `DerivedSchemeSchema` is left out, and logged as `preview.scheme_dropped` with the grant's ref and the scheme's id. Pages read the frozen tokens from #20's PR 3 on: each checked against `DerivedSchemeSchema`, never generated again, and an entry that's missing or doesn't check renders the color scheme fallback. A rollback brings back the revision's own.

A Studio publish of a new case study, or of GitHub data, serves on the next request. A publish from `portfolio-store`, outside the server, serves from the server's next read of the live revision, which any visitor page makes.

### Publishing, the lock, and conflicts

Publishes, imports, rollbacks, recovers, draft writes, and retention run one at a time, under `publication/lock`, across the server and the command line. One that waits more than 5 seconds for the lock gives up with `lock_timeout`: Studio answers 503 with `Retry-After`, and `portfolio-store` exits 1. A lock is stale, and the next one to want it takes it, when the process that holds it on this host is gone or restarted, or when nobody has touched it for 2 minutes. A holder that runs long touches it every 30 seconds. One whose lock was taken that way, after a stall, moves nothing more: a publish, an import, a rollback, or a draft write gets `lock_lost`, a backup keeps nothing, and retention stops where it is. Running it again is safe. A lock whose holder stopped breaks itself, so `unlock --force` is for a holder that still runs. When the lock was touched in the last 2 minutes, `unlock --force` refuses with `lock_held`, naming the holder's pid, its host when that's another, and how long ago it touched the lock, and `unlock --force --running` removes it anyway. That goes for a holder on this host that still runs, and for any holder on another host, which can't be checked from here: a `docker compose run` has a hostname of its own, so the server's lock is another host's to it. It removes the lock it read and nothing else: one another process took in the meantime stays.

Of two publishes, imports, or rollbacks that expect the same live revision, one commits and the other gets `live_conflict`, naming the revision that is live now. Studio answers it with 409, so the owner can look at what changed and try again on top of it. A draft write that names a version the draft has moved past gets `draft_conflict`, with the draft's current version and documents. Neither ever overwrites the other.

### Backups

`backup` holds the lock throughout, so nothing moves the pointer while it copies. It copies what the table above backs up, and writes `backup-manifest.json`, listing each file's path, size, and SHA-256. The publication log, the events and `publication/live.json`, goes in last, as one rename of a directory it filled first, so the pointer in the copy names a revision that's in it. The target must be empty or new, and outside the data directory. A backup claims it first, with a `.portfolio-store.backup.json` it removes last, so two backups into one directory never mix: the second gets `target_not_empty`, and a failed one takes back only what it wrote. From `deploy/`, with `../backups` made and owned by uid 1001 (`mkdir -m 0700 ../backups && sudo chown 1001:1001 ../backups`):

```sh
docker compose -f compose.owner.yml run --rm --name portfolio-store -v "$PWD/../backups:/backups" web \
  node bin/portfolio-store.mjs backup --out /backups/2026-10-22
```

A run of its own, named so it doesn't take the server's fixed container name, mounts the volume beside the running server. A backup leaves out `ephemeral/`, so restoring it brings back no session, and none revoked since it was taken: sign in again once the server runs on it. It holds every revision's renditions and sources, but not `../assets`, where new sources come from: back that directory up beside it.

A backup copies regular files only and never follows a link. Neither the server nor the command line writes a link or a special file into the store, so one there was put in by hand: the backup leaves it out, names it as `not_regular_file`, and exits 1. A backup stopped before it finished, by Ctrl-C or a kill, leaves its claim, or no `backup-manifest.json`, and `restore` refuses it either way: remove it.

To restore, stop the stack and start from an empty volume: a new host, or the old volume removed once you're sure of the backup (`docker volume rm portfolio-owner_portfolio-data`). A run of the command line then gets a new `portfolio-data` volume, made from the image's empty `/var/lib/portfolio`, which uid 1001 owns:

```sh
docker compose -f compose.owner.yml down
docker compose -f compose.owner.yml run --rm --name portfolio-store -v "$PWD/../backups:/backups:ro" web \
  node bin/portfolio-store.mjs restore --from /backups/2026-10-22 --into /var/lib/portfolio
docker compose -f compose.owner.yml up -d
```

Before it writes anything, `restore` refuses a target that isn't empty, a backup holding a link or anything else that isn't a directory or a regular file (`not_regular_file`), and a backup that isn't exactly the files its manifest lists, each with its size and hash. It claims the target with a `.portfolio-store.restore.json`, copies the backup in, the publication log last in one rename, removes the claim, runs `verify`, and prints the live revision and its unit hash, the ones `status` printed when the backup was taken. It never creates `ephemeral/`. A restore killed before it finished leaves the claim, or its log staged as `.publication.<hex>.tmp`, and preflight refuses that directory with `data_dir_restore_incomplete`: the server doesn't start on it, the write commands don't run, and `verify` names it as `restore_incomplete`. Restore again, into an empty directory: under compose, `docker compose -f compose.owner.yml down`, `docker volume rm portfolio-owner_portfolio-data`, and the restore steps above. A restore stopped only as it removed its claim is whole: when `verify` finds nothing but `restore_incomplete` for `.portfolio-store.restore.json`, removing that one file is enough. The hashes a restore checks are its manifest's own, so a backup written by hand, with a manifest that matches it, restores: the reader and `verify` judge what it holds, and `restore` exits 1 when `verify` finds a problem.

### Retention

`retention` takes the lock. With no flag it removes no revision: it deletes the blobs no revision or draft references that are older than 24 hours, so an upload a draft hasn't referenced yet stays, and the audit files whose every line is more than 12 months old. It reads a draft's media document by its shape, so one a newer build wrote still keeps its blobs, and while a revision's manifest or a draft's file can't be read, it deletes no blob at all. `--keep <n>` also removes the revisions beyond the newest `n` that aren't protected, and `--remove <revisionId>` removes one, or says why it can't. `--dry-run` says what it would remove, and removes nothing.

Protected, always: the live revision, the 10 revisions most recently live before it, and every draft's base. A removed revision leaves `revisions/<revisionId>.tombstone.json`, saying when and by whom. Its events stay in the log, `rollback` and `recover` refuse it as `not_found`, and `verify` and the last-known-good walk skip it. The tombstone is written before the revision's directory goes, so a crash between the two leaves a revision that counts as removed, and the next run finishes removing it.

### Upgrades

Back up before every upgrade, and keep the backup with the image that took it: going back means that image and that backup. Startup never changes a stored revision. When the new image can't serve the live revision, it serves the most recently live one it can, `degraded`, or nothing, `incompatible`, and `status` says why. Going back across the cutover to this store, to a release before it, means the previous image and the backed-up source files (#18, #12). The [owner migration prompt](operations/owner-migration.md) runs that cutover on a host coming from #21's containment, and keeps the old container as its rollback.

## Startup checks

Before it takes a request, the server validates its settings and the two documents. A problem stops it with exit code 1 and one `config.fatal` JSON line per problem on stdout. Each line names the setting, never its value, and for a document adds the diagnostic code, the file, the JSON pointer, the line and column, and what to do about it. [configuration.md](configuration.md#validation) explains every code.

Under `owner`, the rows about the source directory and the two documents stop only a first start, which publishes the pair into an empty store, and so it also stops on what a publish refuses that serving only warns about, such as `variant.unavailable`. Once a revision is live, each of them is a `config.warning`, and the store serves what it did.

| The server finds                                                                                                                                                                                            | Profiles         | It                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE` missing, or not exactly `owner`, `demo`, or `read-only`                                                                                                                                 | all              | refuses to start                                                                                                                        |
| `PORTFOLIO_ORIGIN` missing, not a bare origin, or `http` for an `owner` host that isn't loopback                                                                                                            | all              | refuses to start                                                                                                                        |
| A key and its `_FILE` both set, or a `_FILE` that can't be read or isn't a regular file                                                                                                                     | all              | refuses to start                                                                                                                        |
| Proxy hops that aren't a whole number, or a preview origin that is invalid or `PORTFOLIO_ORIGIN`                                                                                                            | all              | refuses to start                                                                                                                        |
| `PORTFOLIO_PATH` or `NEXT_PUBLIC_BASE_URL`                                                                                                                                                                  | all              | refuses to start, naming the setting that replaced it                                                                                   |
| A setting outside the profile's column, such as `GITHUB_TOKEN` under `read-only`                                                                                                                            | all              | refuses to start in production; `pnpm dev` warns and ignores it                                                                         |
| A source directory that is missing, unreadable, or a file rather than the directory holding it                                                                                                              | owner, read-only | refuses to start                                                                                                                        |
| A source directory without `portfolio.yml` or `site.yml` (`source.missing`), with one in two formats (`source.duplicate`), or with one the server can't read (`source.unreadable`)                          | owner, read-only | refuses to start; with neither document, `pnpm dev` renders the bundled examples and warns                                              |
| A portfolio in the old one-file format, or a `portfolio.toml`                                                                                                                                               | owner, read-only | refuses to start with one `legacy.document` line; [migrate it](#migrating-from-the-one-file-format)                                     |
| A document that isn't one plain YAML or JSON document                                                                                                                                                       | owner, read-only | refuses to start                                                                                                                        |
| A document over 1 MiB, nested more than 64 levels, or with over 10,000 entries in a mapping or list                                                                                                         | owner, read-only | refuses to start                                                                                                                        |
| A document without `schemaVersion: 2` or that fails its schema, or a portfolio with two sections on one `id`                                                                                                | owner, read-only | refuses to start                                                                                                                        |
| A key the schema doesn't define, outside `extensions`                                                                                                                                                       | owner, read-only | refuses to start, suggesting the closest allowed key                                                                                    |
| A `url`, `src`, or `*Url` that isn't `https`, `http`, `mailto`, `tel`, relative, or a `#fragment`                                                                                                           | owner, read-only | refuses to start                                                                                                                        |
| A site document that selects `fallback` (`schema.invalid`), names a section the portfolio doesn't have (`ref.missing`), or holds a deployment setting (`site.deployment-setting`)                           | owner, read-only | refuses to start                                                                                                                        |
| A site document whose variant this build doesn't register (`variant.unavailable`), or a control value it doesn't accept (`controls.*`)                                                                      | owner, read-only | starts and warns; the fallback composition renders, or the control takes its default                                                    |
| A pair with no visible section (`content.empty`), a `#fragment` link to no visible section (`anchor.broken`), one metric with two values (`metric.conflict`), or a secret-shaped string (`secret.detected`) | owner, read-only | refuses to start                                                                                                                        |
| An origin on a reserved example domain, or the bundled sample's `identity.name`                                                                                                                             | owner, read-only | refuses to start in production; `pnpm dev` warns                                                                                        |
| A password hash file that group or others can write                                                                                                                                                         | owner            | refuses to start                                                                                                                        |
| A password hash that is missing, not a scrypt PHC string, or outside `ln=17, r=8, p=1` to `ln=18, r=16, p=4`                                                                                                | owner            | refuses to start                                                                                                                        |
| `PORTFOLIO_DATA_DIR` unset, naming no directory, or naming one the server can't reach or write                                                                                                              | owner            | refuses to start                                                                                                                        |
| `PORTFOLIO_DATA_DIR` another user owns or others can write, or holding a store directory that is a symbolic link                                                                                            | owner            | refuses to start                                                                                                                        |
| Another owner server holding `PORTFOLIO_DATA_DIR`: its claim is under 45 s old, and its process runs                                                                                                        | owner            | refuses to start                                                                                                                        |
| The publication lock busy through startup, as while the CLI takes a backup                                                                                                                                  | owner            | starts and warns (`data_dir_unclaimed`); owner writes wait until it claims the directory                                                |
| `publication/` the claim can't read or write through startup, as on a full volume or with a link at `publication/lock`                                                                                      | owner            | starts and warns (`data_dir_claim_failed`); owner writes wait until it claims the directory                                             |
| The same, at a first start                                                                                                                                                                                  | owner            | starts and warns (`store_import_waiting`); visitors get 503 until the import commits                                                    |
| A store that has published, with an event or a tombstone, but no `publication/live.json`                                                                                                                    | owner            | starts degraded on the last known good (`pointer_damaged`), and imports nothing into it; `recover` or a restore brings the pointer back |
| `PORTFOLIO_AUTH_SESSION_IDLE_MINUTES` outside 5 to 120, or `PORTFOLIO_AUTH_SESSION_MAX_HOURS` outside 1 to 24                                                                                               | owner            | refuses to start                                                                                                                        |
| `PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS` outside 60 to 3600, `PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS` outside 300 to 43200, either not a whole number, or an idle limit over the cap                     | owner            | refuses to start                                                                                                                        |
| `PORTFOLIO_TRUSTED_PROXY_HOPS` of `0`                                                                                                                                                                       | owner            | starts, and warns that sign-in has only its global limits                                                                               |
| A bundled sample pair that is missing, can't be read, or doesn't validate, so the build is broken                                                                                                           | demo             | refuses to start                                                                                                                        |

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

`capabilities` lists every capability the profile grants. The checks are `catalog` (something can be served: under `owner`, `degraded` while the last known good stands in for a live revision that can't be served, and a failure when no published revision can be served), `packs` (the site's variant loads, `degraded` while the fallback composition renders in place of a variant this build doesn't register), under `demo` and `read-only`, `owner-modules` (no Studio, storage, or sign-in code has loaded), and under `owner`, `data-directory` (the data directory takes a write, a sync, and a rename, tried at most every 30 seconds). A failed check makes it 503 with `"status": "unavailable"`. When a check is degraded, or a startup requirement fell back to a degraded mode, it's 200 with `"status": "degraded"`. While the site selects a variant this build doesn't register, readiness says `degraded`. Neither endpoint returns a path, a value, or portfolio content, and both send `Cache-Control: no-store`.

## Logs

The app writes its log as one JSON object per line on stdout, with `ts`, `level`, and `event`, and only these other fields: `requestId`, `profile`, `route` (the route pattern, never the URL), `operation`, `capability`, `status`, `code`, `key`, and `digest`. `config.fatal` and `config.warning` add `file` (relative to the source directory), `document`, `path`, `line`, `column`, `stableId`, `message`, and `remediation`. Under `owner`, the revision store's `store.*` lines add `revisionId`, `servingRevisionId`, `seq`, `stage`, `durationMs`, and `drift`, never content. No line of the app's carries a request body, a cookie, `Authorization`, a raw URL, or a secret value.

Next writes its own lines to the same streams, as plain text: its startup banner on stdout (`▲ Next.js`, the address, `✓ Ready`), and on stderr, the message and stack of each error it catches, next to the app's `request.error` line, and a line naming the request URL when a request handler crashes. Those can name server paths and request URLs. None of them is JSON, so a log pipeline keeps the app's lines by parsing each line as a JSON object.

| Event                        | When                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `config.fatal`               | A startup check failed. The server exits 1 after the last one.                                                                |
| `config.warning`             | A startup check found something to fix that doesn't stop the server.                                                          |
| `deployment.config`          | Once, at startup: the redacted settings summary.                                                                              |
| `request.error`              | A page or route failed. `digest` is the reference code the error page shows the visitor.                                      |
| `operation.failed`           | A Studio operation failed. Its response carries the same `requestId`.                                                         |
| `feed.failed`                | `/feed.xml` couldn't be built: `code` is `catalog_unavailable` or `render_failed`. Its response carries the same `requestId`. |
| `session.read_failed`        | `owner`: the session store couldn't be read. The request gets no session, and its cookie stays.                               |
| `session.touch_failed`       | `owner`: a session's last use couldn't be written. The request goes on.                                                       |
| `session.listener_failed`    | `owner`: something told of an ended session failed. The session ended anyway.                                                 |
| `audit.write_failed`         | `owner`: an audit line couldn't be written. `code` is its type. No decision changes.                                          |
| `login.store_failed`         | `owner`: a sign-in's session couldn't be stored. It gets 503 `unavailable`, or a form post `state=error`, and no cookie.      |
| `logout.store_failed`        | `owner`: a sign-out couldn't end its session. The browser is signed out, and the session ends at its idle limit.              |
| `store.publish.committed`    | `owner`: a publish moved the live pointer, with `revisionId`, `seq`, and `durationMs`. Rollback and recover log their own.    |
| `store.publish.failed`       | `owner`: a publish didn't move it: `stage` is where it stopped and `code` why. Rollback and recover log their own.            |
| `store.catalog.degraded`     | `owner`: the live revision can't be served, so `servingRevisionId`, the last known good, is. `code` says why.                 |
| `store.catalog.incompatible` | `owner`: no published revision can be served, so visitors get 503. `code` says why.                                           |
| `store.pointer.missing`      | `owner`: `live.json` is gone from a store that has published. The last known good serves, `pointer_damaged`.                  |
| `store.render-drift`         | `owner`: the live revision's variant, packs, or contracts differ from this build's: `drift` lists each ID and both versions.  |
| `store.repair.failed`        | `owner`: startup repair didn't finish. Visitors are served what can be served, and owner writes wait for the repair.          |
| `store.import.first_start`   | `owner`: the first start imported the mounted pair into the empty store, with `revisionId` and `seq`.                         |
| `store.import.not_needed`    | `owner`: a first-start import found a revision live already, as when the CLI imported first. Nothing changed.                 |
| `store.import.failed`        | `owner`: a first-start import couldn't go, and `code` says why. The store stays empty.                                        |
| `store.writes.stopped`       | `owner`: a Studio write stopped with `code`: the claim isn't this server's, or the repair still fails. Each tries both first. |
| `store.repair.finished`      | `owner`: a write finished the repair startup couldn't, and owner writes go on.                                                |
| `store.server.claim_waiting` | `owner`: the publication lock stayed busy, so the server hasn't claimed the data directory yet. It tries again, with backoff. |
| `store.server.claim_failed`  | `owner`: the claim couldn't read or write `publication/`, and `code` says why. It tries again, with backoff.                  |
| `store.server.claimed`       | `owner`: the server claimed the data directory once it could, and owner writes go on.                                         |
| `store.server.claim_refused` | `owner`: another owner server holds the data directory. Owner writes answer 503 `data_dir_in_use` and try the claim again.    |
| `store.server.claim_lost`    | `owner`: another owner server took this one's claim. Owner writes stop until this one claims the directory again.             |
| `store.lock.lost`            | `owner`: another holder took the publication lock while this server held it. Nothing moved; the write answered `lock_lost`.   |

`deployment.config` adds `origin`, `previewOrigin`, `proxyHops`, `capabilities`, `adapters` (which catalog the profile reads), and `secrets`, each secret only as `set` or `unset`. The owner-session `config.status` operation returns the same summary, with how the live site's variant renders, `catalog`: the serving state, the revision `live.json` names, the one served, and any render drift, and `writes`: `open`, or `stopped` with `data_dir_in_use`, `data_dir_unclaimed`, or `store_repair_failed`. No anonymous route does.

## Response headers

Every response the app sends carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a fresh `X-Request-Id`. Under `demo`, each adds `X-Robots-Tag: noindex`.

Every public response, 404s and plain answers included, carries the site's Content-Security-Policy, with a nonce made for that response (#6): `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. So the only scripts that run are Next's, which carry the nonce, and the chunks they load. Nothing loads from another host, and no other site can frame the pages. The site sends no inline script of its own: its JSON-LD is a data block, which never runs. `'self'` in `script-src` is for a browser without `'strict-dynamic'`, which every current one ignores it beside. Styles may be inline, since the kit's spatial effects write a `<style>` of their own. Under `pnpm dev` the policy adds `'unsafe-eval'` to `script-src`. What Next answers before the app sees the request, such as the 308 for a repeated slash, goes out with no Content-Security-Policy: it's a redirect whose body is only the path.

Studio is the exception. Under `owner`, every `/studio` response, however the path is cased or percent-encoded (`/Studio` and `/%73tudio` too), gets its own Content-Security-Policy with a nonce made for that response: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`, with `PORTFOLIO_PREVIEW_ORIGIN` added to `frame-src` when it's set. Studio's pages have their own layout, with none of the site's inline script or JSON-LD, so the only scripts there are Next's, which carry the nonce. Those responses, and every `/api/studio` response in every profile, send `Referrer-Policy: same-origin` instead of the site's, since `no-referrer` would empty the `Origin` of the sign-in form's post, `Cross-Origin-Resource-Policy: same-origin`, so a page on another origin, the demo's included, can't load one to tell whether the owner is signed in, and `Cache-Control` with `no-store`. Under `demo` and `read-only`, which have no Studio, every Studio path, however it is cased or percent-encoded and to any method, answers as a path no route matches: the same status, headers, and body as `/no-such-page`. A trailing slash gets a 308 to the path without it, whose body is only that path, under the headers that path gets: the app sends it, since Next's own went out without them. Next still answers a repeated slash or a backslash itself, before the app sees the request: `//sample` gets a 308 to `/sample` with none of these headers. `Strict-Transport-Security` belongs at the TLS proxy (see [Reverse proxy and HTTPS](#reverse-proxy-and-https)).

Under `demo` (#9), the showroom at `/` and every response under `/sample`, however its path is percent-encoded, 404s and plain answers included, get the demo's policy in place of the site's, with a nonce made for that response: Studio's, with `worker-src 'self'` added and `form-action` narrowed to `'none'`: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`. On `/sample` alone `frame-ancestors` is `'self'`, so the demo's own pages can frame the sample and no other site can. Demo Studio gets the same policy, with `frame-ancestors 'none'`, once `demo` serves it. Every other demo path keeps the site's policy. No demo page carries JSON-LD.

Previews are the other exception (#7). In every profile, every response under `/preview` and `/preview-assets`, however the path is cased or percent-encoded, 404s and plain answers included, gets the preview's own policy in place of the site's, with a nonce made for that response: `default-src 'none'; script-src 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <PORTFOLIO_ORIGIN>`, so only Studio can frame one. They also send `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and `Cache-Control: private, no-store`. Under `pnpm dev` the policy adds `'unsafe-eval'` to `script-src`, takes `style-src 'self' 'unsafe-inline'` in place of the nonce, and allows `connect-src 'self'`, for React's development build, the styles Next's dev tools and hot reloading add with no nonce, and hot reloading's socket. Next sends its own `Cache-Control: no-cache, must-revalidate` on every page there, in place of the app's. A preview request reaches the app without its cookies, so no preview reads the session or a visitor's preference. Under `owner`, every request there that no active grant admits gets the preview's status page ([Preview grants](#preview-grants)); under `demo` and `read-only`, every path there answers as a path no route matches. Under `pnpm dev` alone, `/preview/dev/<variant>/<fixture>` renders a contract fixture for variant developers ([Variants](variants.md)); a production build answers it as it does any other path there. `robots.txt` doesn't disallow them: a crawler has to fetch a page to see its `noindex`. A trailing slash there gets the app's 308, with these headers. What Next answers before the app sees the request has none of them: a repeated slash or a backslash, such as `//preview/<grant>`, gets a 308 to the path it cleans up, whose body is only that path, with no `Cache-Control`, and a path that doesn't decode, such as `/preview/%E0%A4%A`, a plain-text 500. The path a 308 names checks its grant when the browser follows it, and the [CDN](#cdn) rule below keeps such answers out of shared caches.

Build assets under `/_next/static/` and anything under `/_portfolio/`, such as the compiled appearance packs in `/_portfolio/pack/`, send `Access-Control-Allow-Origin: *`, since a sandboxed preview frame has an opaque origin and loads them cross-origin. Nothing outside those prefixes does, and the app answers every other method or spelling under them with a plain 404. Under `/_portfolio/` only a GET or HEAD of exactly a file registry generation wrote there goes through. A GET for a build asset that doesn't exist gets a 404 page that carries the header too: the site's views answer it, in the site's own layout (a 200 for an RSC request). That holds what any anonymous request for an unknown path gets, and browsers never let a wildcard origin read a credentialed response.

## Plain Node

```sh
pnpm install
pnpm build
PORTFOLIO_PROFILE=read-only PORTFOLIO_ORIGIN=https://jane.name \
  PORTFOLIO_SOURCE_DIR=../../config pnpm start
```

`pnpm start` runs from `apps/web`, so the relative source directory is the repo's `config/`. The host listens on `127.0.0.1`, on `process.env.PORT` (defaults to 3000), so a reverse proxy on the same host is what visitors reach (see [Reverse proxy and HTTPS](#reverse-proxy-and-https)). `pnpm start -H <address>` listens on another address instead, and anyone who can reach that address reaches the app around the proxy, so use it only for a proxy that can't reach loopback, such as one on a Docker bridge.

For a process manager (PM2, systemd, etc.), wrap `pnpm start` with the same environment. You don't need to ship `node_modules` to your runtime if you copy `apps/web/.next/standalone/` and the public assets. Run its `apps/web/server.js` with `HOSTNAME=127.0.0.1` as well: without it, the standalone server listens on every interface.

### Demo

`demo` renders the bundled sample, `portfolio.example.yml` and `site.example.yml`, and reads no source directory; setting `PORTFOLIO_SOURCE_DIR` stops a production server. Its origin is the demo hostname:

```sh
PORTFOLIO_PROFILE=demo PORTFOLIO_ORIGIN=https://demo.jane.name pnpm start
```

`/` and `/sample` show the sample in the sample site's selection, `editorial-evidence`, the platform default (#13). `/sample?variant=<id>` shows it in any registered variant, with that variant's views below `/sample` and the parameter on every link. `/sample` and `/` also take `language`, `scheme`, `type`, and `mode`, the other four appearance axes, by the ids this build registers, and `motion=reduce`, which renders with motion reduced. A value the build doesn't accept, such as `fallback`, an unregistered id, an empty value, or a key given twice, falls back on its axis to the sample's own, and a request with any key outside these, or with them in another order, gets a 307 to the same path with the canonical query, on `PORTFOLIO_ORIGIN`. No rejected value decides what renders, though Next echoes the URL as sent, percent-encoded, in its own payloads. The sample's `github` section renders the snapshot bundled beside it, so it fetches nothing. The sample stays out of search: every response the app sends has `X-Robots-Tag: noindex`, and `robots.txt` lets crawlers fetch every page, since a crawler only sees the `noindex` on a page it may fetch. Robots names no sitemap, the sitemap is empty, no page carries JSON-LD, and there is no feed. Every Studio operation answers with the 404 envelope.

## Environment variables

The server reads these from its environment only. Every key also accepts `<KEY>_FILE`, the path of a file holding the value (such as a Docker secret); set one or the other. An empty value counts as unset. `.env.example` lists them all, the password hash by its `_FILE` only.

| Variable                                   | Profiles         | Purpose                                                                                                                                                                                                               |
| ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE`                        | all              | Required. Exactly `owner`, `demo`, or `read-only`.                                                                                                                                                                    |
| `PORTFOLIO_ORIGIN`                         | all              | Required. The origin visitors use, such as `https://jane.name`: no path or slash.                                                                                                                                     |
| `PORTFOLIO_SOURCE_DIR`                     | owner, read-only | Directory holding one `portfolio.{yml,yaml,json}` and one `site.{yml,yaml,json}`.                                                                                                                                     |
| `PORTFOLIO_MEDIA_ROOT`                     | owner, read-only | The read-only directory local media sources resolve under, such as `/media` ([Media](#media)). Optional.                                                                                                              |
| `PORTFOLIO_TRUSTED_PROXY_HOPS`             | all              | How many trusted proxies append to `X-Forwarded-For`. Whole number, default `0`.                                                                                                                                      |
| `PORTFOLIO_PREVIEW_ORIGIN`                 | owner, demo      | Optional preview origin on the same server, under another registrable domain than `PORTFOLIO_ORIGIN`, never on its host: `owner` frames load from it ([Preview grants](#preview-grants)), and it serves nothing else. |
| `PORTFOLIO_DATA_DIR`                       | owner            | Required. The writable data directory for the revision store, sessions, preview grants, and the audit log: `/var/lib/portfolio` in the owner example ([The revision store](#the-revision-store)).                     |
| `PORTFOLIO_AUTH_PASSWORD_HASH`             | owner            | The owner password's scrypt hash. Set it through `PORTFOLIO_AUTH_PASSWORD_HASH_FILE` ([Owner authentication](#owner-authentication)).                                                                                 |
| `PORTFOLIO_AUTH_SESSION_IDLE_MINUTES`      | owner            | Minutes a session lasts idle: 5 to 120, default `60` ([Sessions](#sessions)).                                                                                                                                         |
| `PORTFOLIO_AUTH_SESSION_MAX_HOURS`         | owner            | Hours a session lasts at most: 1 to 24, default `12`.                                                                                                                                                                 |
| `PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS` | owner            | Seconds a preview grant lasts without a renewal: 60 to 3600, default `900` ([Preview grants](#preview-grants)).                                                                                                       |
| `PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS`  | owner            | Seconds a preview grant lasts at most: 300 to 43200, default `7200`, and never under the idle limit.                                                                                                                  |
| `GITHUB_TOKEN`                             | owner            | Reserved. Public GitHub sections use unauthenticated REST and never send a token.                                                                                                                                     |
| `PORT`                                     | all              | Port the host binds to. Default `3000`.                                                                                                                                                                               |
| `PORTFOLIO_PATH`                           | none: refused    | Replaced by `PORTFOLIO_SOURCE_DIR`. Setting it stops the server.                                                                                                                                                      |
| `NEXT_PUBLIC_BASE_URL`                     | none: refused    | Replaced by `PORTFOLIO_ORIGIN`. Setting it stops the server.                                                                                                                                                          |

A key outside its profile's list stops a production server; `pnpm dev` warns and ignores it. `.env` files are gitignored. `pnpm dev` reads `apps/web/.env.development`, which runs `read-only` from `config/` with the origin `http://127.0.0.1:3000`. On another port (`pnpm dev --port <n>`, or when Next moves off a busy 3000), set `PORTFOLIO_ORIGIN` to the address it prints, since owner sign-in checks the origin exactly.

## Caching

The host uses Next.js fetch revalidation:

- **GitHub data:** none fetched. A `github` section renders the snapshot beside the documents, `snapshots/github.json`, read at startup, and links the profile until one holds its section. #10's third slice refreshes it.
- **Metadata:** rendered per request (each page's head, `robots.txt`, `sitemap.xml`, the Open Graph image, and the feed), from the live revision and `PORTFOLIO_ORIGIN`, so a publish or a rollback shows on the next request with no rebuild. The build renders none of them ahead. Visitor pages are `no-store`, the share image, robots, and the sitemap must be revalidated on every use, and the feed is `public, max-age=3600`, with nothing stale allowed after the hour. `features.feed: false` in the site document turns the feed off.
- **After a rollback:** the app serves the earlier revision at once, but a CDN or caching proxy can keep the feed for up to that hour, and anything at all for as long as its own rules say when they override the app's headers. When a rollback takes out something that must not stay up, purge `/feed.xml`, `/opengraph-image-12o0cb`, `/sitemap.xml`, and the pages it was on from the cache.
- **Media:** a rendition under `/media` is immutable and cached for a year; a new source gets a new address. Nothing else under `/media` is cached. An image made private or removed stops serving at once, but browsers and any CDN or caching proxy keep the copies they already fetched for up to that year: purge `/media/<assetId>/` from the proxy's cache when one has to go now.
- **Unit files:** every file under `/_portfolio/`, packs, fonts, variant stylesheets, assets, and catalog stills, is named by its content hash, so its URL is its cache key. Those names go out with `Cache-Control: public, max-age=31536000, immutable`, on the site's origin and the preview origin alike; anything else there, a 404 included, gets `no-store`. A deploy that changes a file changes its URL, so nothing needs purging. A page loads only the units it renders, and no file is preloaded or prefetched for a unit it doesn't, so switching one appearance axis downloads only that axis's unit. Documents, `/api`, `/preview` and `/preview-assets`, and Studio keep their own `Cache-Control`.
- **Next's build assets:** `/_next/static/` is content hashed too, and Next sends its own long-lived caching there.

To force a refresh, redeploy or clear the Next.js cache:

```sh
rm -rf apps/web/.next/cache
```

## CDN

The Next.js app ships static assets under `_next/static/...` and the units' files under `_portfolio/...`, both content hashed and sent `immutable`. Any CDN that respects `Cache-Control` headers will work. The Dockerfile doesn't bundle a CDN; that's the operator's choice.

Never cache anything under `/preview` or `/preview-assets`, in any case, at a CDN or a proxy. Every answer the app sends there is `private, no-store`, but Next's 308 for a repeated slash or a backslash, such as `//preview/<grant>`, goes out before the app with no `Cache-Control`, and its body names the grant's path. Bypass the cache for every path that starts with `/preview` and every path holding `//` or a backslash.

A CDN may cache `/media/` renditions, which are `public, max-age=31536000, immutable`. When an image is made private or removed, purge its `/media/<assetId>/` addresses there, or the CDN keeps serving the copies it holds ([Caching](#caching)).

Under `owner` and `read-only` every page renders in the visitor's own appearance, read from the `portfolio_appearance` cookie, the 404 page included, and answers `private, no-store`. Next sets its own `Vary` on each page, without `Cookie`, so `no-store` is all that keeps one visitor's appearance out of another's response. Don't put a cache in front of these pages that ignores `no-store` or `private`, or one that strips the `Cookie` header before the app sees it.

## Checks before going live

- `pnpm typecheck` exits 0
- `pnpm check:skills` exits 0
- `node skills/portfolio-author/scripts/validate.mjs config` exits 0
- `pnpm build` exits 0
- The dev server renders correctly in light, dark, and system display modes
- `/feed.xml`, `/robots.txt`, `/sitemap.xml` all 200, with URLs on your `PORTFOLIO_ORIGIN`
- `/api/ready` answers 200 with `"status": "ready"`, or `"degraded"` with `packs` degraded while your site's variant isn't installed
- With the production build running, `node apps/web/scripts/check-containment.mjs http://127.0.0.1:3000 --direct --expect-name "<your identity.name>" --expect-origin "<your PORTFOLIO_ORIGIN>"` exits 0. Drop `--direct` when the URL goes through your reverse proxy.

## Updating

To pull upstream changes, under `owner` after a backup ([Upgrades](#upgrades)):

```sh
git fetch origin
git rebase origin/main
pnpm install
pnpm typecheck
docker compose up --build
```

The platform follows semver: a major bump may change the schema in incompatible ways. Read the release notes before upgrading across majors. Each release names its image by digest and says how to verify it ([Releasing](releasing.md)).
