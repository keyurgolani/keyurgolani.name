# Deployment

The server runs one deployment profile, chosen by `PORTFOLIO_PROFILE` at startup:

- `read-only` serves your portfolio from a mounted directory, with no editing surface.
- `demo` serves the bundled sample pair, for a product demo, and asks crawlers to index nothing.
- `owner` adds Studio, drafts, and revisions to your portfolio, behind a sign-in with your password. It starts once the password's hash and a data directory pass their checks ([Owner authentication](#owner-authentication)).

Run it in a container (recommended) or on Node. The browser editor, the variant gallery, the variant preview pages, and their write APIs are gone in every profile, `pnpm dev` included. Edit `config/portfolio.yml` and `config/site.yml` instead: `pnpm dev` picks up each save, and a production server picks them up when it restarts. While `config/` holds neither, `pnpm dev` renders the bundled examples; a production server refuses to start. `pnpm dev` and `pnpm start` listen on `127.0.0.1` only.

## Profiles

What each profile grants. `public` is anyone, `session` is a signed-in owner, and `absent` means the profile has no page, route, or operation for it, so a request gets a 404. A unit test keeps this table in step with `apps/web/src/server/capabilities.ts`.

<!-- profile-matrix:start -->

| Capability            | What it covers                                             | `owner`   | `demo`   | `read-only` |
| --------------------- | ---------------------------------------------------------- | --------- | -------- | ----------- |
| `catalog.read`        | The portfolio's pages and metadata routes                  | `public`  | `public` | `public`    |
| `feed.read`           | `/feed.xml`                                                | `public`  | `absent` | `public`    |
| `sample.read`         | `/sample`, the bundled sample in any variant               | `absent`  | `public` | `absent`    |
| `reference.read`      | The reference portfolio (not built yet)                    | `absent`  | `public` | `absent`    |
| `sandbox.view`        | The demo Studio (not built yet)                            | `absent`  | `public` | `absent`    |
| `health.read`         | `/api/health`                                              | `public`  | `public` | `public`    |
| `ready.read`          | `/api/ready`                                               | `public`  | `public` | `public`    |
| `auth.session`        | Signing in and out                                         | `public`  | `absent` | `absent`    |
| `source.read`         | The portfolio's source document                            | `session` | `absent` | `absent`    |
| `draft.read`          | The draft                                                  | `session` | `absent` | `absent`    |
| `history.read`        | Published revisions                                        | `session` | `absent` | `absent`    |
| `draft.write`         | Draft edits, variant changes included                      | `session` | `absent` | `absent`    |
| `config.import`       | Importing a portfolio                                      | `session` | `absent` | `absent`    |
| `config.export`       | Exporting the portfolio                                    | `session` | `absent` | `absent`    |
| `studio.view`         | Studio's pages                                             | `session` | `absent` | `absent`    |
| `config.status`       | The redacted deployment summary                            | `session` | `absent` | `absent`    |
| `publish`             | Publishing the draft                                       | `session` | `absent` | `absent`    |
| `rollback`            | Going back to an earlier revision                          | `session` | `absent` | `absent`    |
| `asset.write`         | Uploading assets                                           | `session` | `absent` | `absent`    |
| `preview.grant`       | Preview frames, each by its own grant                      | `session` | `absent` | `absent`    |
| `appearance.fixtures` | `/_fixtures/appearance`, in `APPEARANCE_FIXTURES=1` builds | `public`  | `public` | `public`    |

<!-- profile-matrix:end -->

Every profile serves `/`, `/robots.txt`, `/sitemap.xml`, the share image at `/opengraph-image-12o0cb` (Next adds a suffix to a metadata route inside a route group, here the site's), `/api/health`, `/api/ready`, and `/api/studio/<operation>`. `owner` and `read-only` add `/feed.xml`, `/work/<slug>` (the 404 page until #10 resolves slugs), and the path views of the site's variant below `/` and below `/work/<slug>`. `owner` also serves `/preview/<grant>/` and `/preview-assets/<grant>/`, only to a frame whose preview grant is active ([Preview grants](#preview-grants)). `demo` adds `/sample` and the same routes below it. Every Studio operation goes through `/api/studio/<operation>`, and one the profile lacks answers with the 404 envelope, `{"error":{"code":"not_available_in_profile",...}}`. There is no image optimizer: images load as they are, and `/_next/image` answers with the 404 page in every profile. A build made with `APPEARANCE_FIXTURES=1`, which is for tests, adds `/_fixtures/appearance` to every profile, as the `appearance.fixtures` row shows. Any other build grants that capability in no profile, so the path answers as an unknown one does. Setting the variable when the server starts only logs a warning.

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

This mounts `config/` read-only at `/config` and `assets/` at the site's `/assets/`, a first segment the variant contract reserves, so no variant's view can take a path a file there answers. Nothing in the container is writable but a tmpfs at Next.js's cache, `/app/apps/web/.next/cache`.

### `demo`

```sh
cd deploy
echo 'PORTFOLIO_ORIGIN=https://demo.jane.name' > .env
docker compose -f compose.demo.yml up --build
```

`demo` renders the bundled sample pair and mounts nothing, on the same read-only root and cache tmpfs as `read-only`.

### `owner`

`deploy/compose.owner.yml` mounts `../config` and `../assets` as `read-only` does, on the same read-only root and cache tmpfs, and keeps drafts and revisions in the `portfolio-data` volume at `/var/lib/portfolio` (`PORTFOLIO_DATA_DIR`). The image creates that directory for the server's user (uid 1001, mode `0700`), so a new volume starts out writable by the server and no one else. Run one server per volume: the fixed container name stops `docker compose up --scale`. Back the volume up.

It needs the owner password's hash before it starts ([Owner authentication](#owner-authentication)). Set `PORTFOLIO_TRUSTED_PROXY_HOPS` in `deploy/.env` to the number of proxies in front that append to `X-Forwarded-For`, usually `1`: `compose.owner.yml` passes it through, and leaves it at `0` when it's unset, which gives sign-in only its global limits ([Signing in](#signing-in)).

### What the image does

- Multi-stage build: deps, build, then run.
- Installs only production dependencies in the runtime stage.
- Runs `pnpm build` to produce a Next.js standalone output. The build needs no deployment settings, and the image sets no `PORTFOLIO_*` defaults: a setting outside the profile's column stops a production server, so a default would stop `demo`.
- Under `read-only` and `owner`, reads the portfolio and site documents from `PORTFOLIO_SOURCE_DIR`, the mounted `config/`, and never renders the bundled examples in production.
- Copies the app owned by root, so the server can't change its own code. The server's user (uid 1001) owns only the data directory, and the Compose examples give Next's cache a tmpfs. A `docker run` without one should add `--tmpfs /app/apps/web/.next/cache`.
- Its `HEALTHCHECK` asks `/api/health`.

### Updating the portfolio

The server reads `config/portfolio.yml` and `config/site.yml` once, at startup. After you edit either, restart the container:

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

Put Nginx, Caddy, or Traefik in front, pointed at `http://127.0.0.1:3000` (or the port you set), and terminate TLS there. The app builds every absolute URL from `PORTFOLIO_ORIGIN`; it never reads `Host` or `X-Forwarded-*` for one. Set `PORTFOLIO_TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`. With `0`, the default, `owner` ignores the header and doesn't know where a request came from. With N, it takes the Nth entry from the right as the client, without a port or the brackets around an IPv6 address. That is the source the audit log records and sign-in limits by. Set it to exactly the proxies that append: a higher count takes an entry the client wrote itself.

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

`owner` keeps its sessions, its preview grants, and its audit log in `PORTFOLIO_DATA_DIR`, the `portfolio-data` volume at `/var/lib/portfolio` in `compose.owner.yml`. At startup it creates `ephemeral/auth/sessions/` and `audit/` there with mode `0700`, and checks that it can write, sync, and rename a file, the way it writes session records. It refuses to start when the variable is unset, names no directory, or names one the server's user (uid 1001) can't reach or write. It makes `ephemeral/preview/` the same way the first time Studio opens a preview. Run one server per data directory: the running one holds `publication/server.json`, and lets it go as it stops. Under `pnpm dev`, an unset `PORTFOLIO_DATA_DIR` is `.data/` at the workspace root, which git and Docker ignore.

`ephemeral/` holds sessions, auth state, and preview grants only, and never belongs in a backup. A restore that brings it back also brings back sessions revoked since the backup was taken, so run [`revoke-sessions`](#revoking-sessions) after any restore of the volume.

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

Every Studio page but sign-in needs a session. A request for one with no session cookie gets a 303 to `/studio/sign-in`, keeping where it was going in `returnTo`, and one whose cookie no longer counts gets a 307 there with `state=session_ended`. `/studio` is a placeholder that says you're signed in and has a Sign out button; #8 replaces it with Studio itself.

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

Only a frame's own loads reach a grant: a `GET` or `HEAD` with `Sec-Fetch-Dest: iframe` for its page, and an image, video, audio, track, or font load for a draft-only asset under `/preview-assets/<grant>/`. Every other request under `/preview` and `/preview-assets` gets one static 404 page that says only that the preview isn't available, whether the grant ended, never existed, was opened in a tab of its own, or was asked for with another method. Until #10 serves draft-only assets, every `/preview-assets/<grant>/` path gets that page too. When an active grant's content can't be read, such as a revision damaged on disk, its frame gets a 500 that says the preview couldn't be shown, with a reference: the `digest` of the server log's `request.error` line, beside a `preview.render_failed` line that names the grant by its `grantRef`.

### Audit log

The server appends one JSON line per event to `audit/<yyyy-mm>.jsonl` in the data directory (UTC months, files `0600`). Each line is `{"at", "type", "actor", "outcome", "refs"}`. The events are sign-ins, failed and throttled sign-ins, sign-outs, revocations, evictions, password hash changes, and denied commands. `actor` is `owner`, `anonymous`, or `operator` (`revoke-sessions` and a changed hash), and `refs` may name the session by the first 8 characters of its digest, the source by its IPv4 /24 or IPv6 /48 prefix, the command, the capability, a reason code, the request ID, and a `count`. A denied command is `anonymous`, since a forged one carries the owner's cookie too, and names the session it carried. Anonymous failed and throttled sign-ins and denied commands are written once a minute per kind: the first at once, and the rest as one line with a `count` when the minute ends. No line holds a password, hash, cookie, CSRF token, full IP address, user agent, or request body. A failed write is logged and changes no decision.

## Startup checks

Before it takes a request, the server validates its settings and the two documents. A problem stops it with exit code 1 and one `config.fatal` JSON line per problem on stdout. Each line names the setting, never its value, and for a document adds the diagnostic code, the file, the JSON pointer, the line and column, and what to do about it. [configuration.md](configuration.md#validation) explains every code.

| The server finds                                                                                                                                                                                            | Profiles         | It                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE` missing, or not exactly `owner`, `demo`, or `read-only`                                                                                                                                 | all              | refuses to start                                                                                    |
| `PORTFOLIO_ORIGIN` missing, not a bare origin, or `http` for an `owner` host that isn't loopback                                                                                                            | all              | refuses to start                                                                                    |
| A key and its `_FILE` both set, or a `_FILE` that can't be read or isn't a regular file                                                                                                                     | all              | refuses to start                                                                                    |
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
| A site document that selects `fallback` (`schema.invalid`), names a section the portfolio doesn't have (`ref.missing`), or holds a deployment setting (`site.deployment-setting`)                           | owner, read-only | refuses to start                                                                                    |
| A site document whose variant this build doesn't register (`variant.unavailable`), or a control value it doesn't accept (`controls.*`)                                                                      | owner, read-only | starts and warns; the fallback composition renders, or the control takes its default                |
| A pair with no visible section (`content.empty`), a `#fragment` link to no visible section (`anchor.broken`), one metric with two values (`metric.conflict`), or a secret-shaped string (`secret.detected`) | owner, read-only | refuses to start                                                                                    |
| An origin on a reserved example domain, or the bundled sample's `identity.name`                                                                                                                             | owner, read-only | refuses to start in production; `pnpm dev` warns                                                    |
| A password hash file that group or others can write                                                                                                                                                         | owner            | refuses to start                                                                                    |
| A password hash that is missing, not a scrypt PHC string, or outside `ln=17, r=8, p=1` to `ln=18, r=16, p=4`                                                                                                | owner            | refuses to start                                                                                    |
| `PORTFOLIO_DATA_DIR` unset, naming no directory, or naming one the server can't reach or write                                                                                                              | owner            | refuses to start                                                                                    |
| `PORTFOLIO_AUTH_SESSION_IDLE_MINUTES` outside 5 to 120, or `PORTFOLIO_AUTH_SESSION_MAX_HOURS` outside 1 to 24                                                                                               | owner            | refuses to start                                                                                    |
| `PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS` outside 60 to 3600, `PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS` outside 300 to 43200, either not a whole number, or an idle limit over the cap                     | owner            | refuses to start                                                                                    |
| `PORTFOLIO_TRUSTED_PROXY_HOPS` of `0`                                                                                                                                                                       | owner            | starts, and warns that sign-in has only its global limits                                           |
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

`capabilities` lists every capability the profile grants. The checks are `catalog` (something can be served: under `owner`, `degraded` while the last known good stands in for a live revision that can't be served, and a failure when no published revision can be served), `packs` (the site's variant loads, `degraded` while the fallback composition renders in place of a variant this build doesn't register), under `demo` and `read-only`, `owner-modules` (no Studio, storage, or sign-in code has loaded), and under `owner`, `data-directory` (the data directory takes a write, a sync, and a rename, tried at most every 30 seconds). A failed check makes it 503 with `"status": "unavailable"`. When a check is degraded, or a startup requirement fell back to a degraded mode, it's 200 with `"status": "degraded"`. While the site selects a variant this build doesn't register, the bundled sample's `editorial-evidence` included until #13, readiness says `degraded`. Neither endpoint returns a path, a value, or portfolio content, and both send `Cache-Control: no-store`.

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
| `store.render-drift`         | `owner`: the live revision's variant, packs, or contracts differ from this build's: `drift` lists each ID and both versions.  |
| `store.repair.failed`        | `owner`: startup repair didn't finish. Visitors are served what can be served, and owner writes wait for the repair.          |
| `store.writes.stopped`       | `owner`: a Studio write found the repair still failing, and stopped with `code`. Each write tries the repair first.           |
| `store.repair.finished`      | `owner`: a write finished the repair startup couldn't, and owner writes go on.                                                |

`deployment.config` adds `origin`, `previewOrigin`, `proxyHops`, `capabilities`, `adapters` (which catalog the profile reads), and `secrets`, each secret only as `set` or `unset`. The owner-session `config.status` operation returns the same summary, with how the live site's variant renders and `catalog`: the serving state, the revision `live.json` names, the one served, and any render drift. No anonymous route does.

## Response headers

Every response the app sends carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy: frame-ancestors 'none'`, so no other site can frame the pages, and a fresh `X-Request-Id`. Under `demo`, each adds `X-Robots-Tag: noindex`.

Studio is the exception. Under `owner`, every `/studio` response, however the path is cased or percent-encoded (`/Studio` and `/%73tudio` too), gets its own Content-Security-Policy with a nonce made for that response: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`. Studio's pages have their own layout, with none of the site's inline script or JSON-LD, so the only scripts there are Next's, which carry the nonce. Those responses, and every `/api/studio` response in every profile, send `Referrer-Policy: same-origin` instead of the site's, since `no-referrer` would empty the `Origin` of the sign-in form's post, `Cross-Origin-Resource-Policy: same-origin`, so a page on another origin, the demo's included, can't load one to tell whether the owner is signed in, and `Cache-Control` with `no-store`. Under `demo` and `read-only`, which have no Studio, every Studio path, however it is cased or percent-encoded and to any method, answers as a path no route matches: the same status, headers, and body as `/no-such-page`. A trailing slash gets a 308 to the path without it, whose body is only that path, under the headers that path gets: the app sends it, since Next's own went out without them. Next still answers a repeated slash or a backslash itself, before the app sees the request: `//sample` gets a 308 to `/sample` with none of these headers. `Strict-Transport-Security` belongs at the TLS proxy (see [Reverse proxy and HTTPS](#reverse-proxy-and-https)).

Previews are the other exception (#7). In every profile, every response under `/preview` and `/preview-assets`, however the path is cased or percent-encoded, 404s and plain answers included, gets the preview's own policy in place of the site's, with a nonce made for that response: `default-src 'none'; script-src 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <PORTFOLIO_ORIGIN>`, so only Studio can frame one. They also send `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and `Cache-Control: private, no-store`. Under `pnpm dev` the policy adds `'unsafe-eval'` to `script-src`, takes `style-src 'self' 'unsafe-inline'` in place of the nonce, and allows `connect-src 'self'`, for React's development build, the styles Next's dev tools and hot reloading add with no nonce, and hot reloading's socket. Next sends its own `Cache-Control: no-cache, must-revalidate` on every page there, in place of the app's. A preview request reaches the app without its cookies, so no preview reads the session or a visitor's preference. Under `owner`, every request there that no active grant admits gets the preview's status page ([Preview grants](#preview-grants)); under `demo` and `read-only`, every path there answers as a path no route matches. Under `pnpm dev` alone, `/preview/dev/<variant>/<fixture>` renders a contract fixture for variant developers ([Variants](variants.md)); a production build answers it as it does any other path there. `robots.txt` doesn't disallow them: a crawler has to fetch a page to see its `noindex`. A trailing slash there gets the app's 308, with these headers. What Next answers before the app sees the request has none of them: a repeated slash or a backslash, such as `//preview/<grant>`, gets a 308 to the path it cleans up, whose body is only that path, with no `Cache-Control`, and a path that doesn't decode, such as `/preview/%E0%A4%A`, a plain-text 500. The path a 308 names checks its grant when the browser follows it, and the [CDN](#cdn) rule below keeps such answers out of shared caches.

Build assets under `/_next/static/` and anything under `/_portfolio/`, such as the compiled appearance packs in `/_portfolio/pack/`, send `Access-Control-Allow-Origin: *`, since a sandboxed preview frame has an opaque origin and loads them cross-origin. Nothing outside those prefixes does, and the app answers every other method or spelling under them with a plain 404. A GET for a file there that doesn't exist gets a 404 page that carries the header too: the site's views answer a missing build asset, in the site's own layout (a 200 for an RSC request), and a missing `/_portfolio/` file gets the page a path no route matches gets. Either holds what any anonymous request for an unknown path gets, and browsers never let a wildcard origin read a credentialed response.

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

`/` and `/sample` show the sample in the sample site's selection, `editorial-evidence`, which renders as the fallback composition until #13 installs it. `/sample?variant=<id>` shows it in any registered variant, with that variant's views below `/sample` and the parameter on every link; `fallback`, an id this build doesn't register, an empty one, or two are a 404. The sample's `github` section doesn't render, since it would fetch a live account. Until the demo's indexing rules are settled, every response the app sends has `X-Robots-Tag: noindex`, `robots.txt` disallows everything, the sitemap is empty, and there is no feed. Every Studio operation answers with the 404 envelope.

## Environment variables

The server reads these from its environment only. Every key also accepts `<KEY>_FILE`, the path of a file holding the value (such as a Docker secret); set one or the other. An empty value counts as unset. `.env.example` lists them all, the password hash by its `_FILE` only.

| Variable                                   | Profiles         | Purpose                                                                                                                                                                       |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORTFOLIO_PROFILE`                        | all              | Required. Exactly `owner`, `demo`, or `read-only`.                                                                                                                            |
| `PORTFOLIO_ORIGIN`                         | all              | Required. The origin visitors use, such as `https://jane.name`: no path or slash.                                                                                             |
| `PORTFOLIO_SOURCE_DIR`                     | owner, read-only | Directory holding one `portfolio.{yml,yaml,json}` and one `site.{yml,yaml,json}`.                                                                                             |
| `PORTFOLIO_TRUSTED_PROXY_HOPS`             | all              | How many trusted proxies append to `X-Forwarded-For`. Whole number, default `0`.                                                                                              |
| `PORTFOLIO_PREVIEW_ORIGIN`                 | owner, demo      | Optional preview origin, different from `PORTFOLIO_ORIGIN`.                                                                                                                   |
| `PORTFOLIO_DATA_DIR`                       | owner            | Required. The writable data directory for sessions, preview grants, and the audit log: `/var/lib/portfolio` in the owner example ([The data directory](#the-data-directory)). |
| `PORTFOLIO_AUTH_PASSWORD_HASH`             | owner            | The owner password's scrypt hash. Set it through `PORTFOLIO_AUTH_PASSWORD_HASH_FILE` ([Owner authentication](#owner-authentication)).                                         |
| `PORTFOLIO_AUTH_SESSION_IDLE_MINUTES`      | owner            | Minutes a session lasts idle: 5 to 120, default `60` ([Sessions](#sessions)).                                                                                                 |
| `PORTFOLIO_AUTH_SESSION_MAX_HOURS`         | owner            | Hours a session lasts at most: 1 to 24, default `12`.                                                                                                                         |
| `PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS` | owner            | Seconds a preview grant lasts without a renewal: 60 to 3600, default `900` ([Preview grants](#preview-grants)).                                                               |
| `PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS`  | owner            | Seconds a preview grant lasts at most: 300 to 43200, default `7200`, and never under the idle limit.                                                                          |
| `GITHUB_TOKEN`                             | owner            | Reserved. Public GitHub sections use unauthenticated REST and never send a token.                                                                                             |
| `PORT`                                     | all              | Port the host binds to. Default `3000`.                                                                                                                                       |
| `PORTFOLIO_PATH`                           | none: refused    | Replaced by `PORTFOLIO_SOURCE_DIR`. Setting it stops the server.                                                                                                              |
| `NEXT_PUBLIC_BASE_URL`                     | none: refused    | Replaced by `PORTFOLIO_ORIGIN`. Setting it stops the server.                                                                                                                  |

A key outside its profile's list stops a production server; `pnpm dev` warns and ignores it. `.env` files are gitignored. `pnpm dev` reads `apps/web/.env.development`, which runs `read-only` from `config/` with the origin `http://127.0.0.1:3000`. On another port (`pnpm dev --port <n>`, or when Next moves off a busy 3000), set `PORTFOLIO_ORIGIN` to the address it prints, since owner sign-in checks the origin exactly.

## Caching

The host uses Next.js fetch revalidation:

- **GitHub data:** none fetched. A `github` section renders the snapshot beside the documents, `snapshots/github.json`, read at startup, and links the profile until one holds its section. #10's third slice refreshes it.
- **Metadata:** rendered per request (`robots.txt`, `sitemap.xml`, the Open Graph image, and the feed), from the documents loaded at startup and `PORTFOLIO_ORIGIN`. `features.feed: false` in the site document turns the feed off.
- **Variant CSS:** every registered variant's stylesheet, bundled into the static assets and loaded on every page, until #6 loads each variant's where it renders.

To force a refresh, redeploy or clear the Next.js cache:

```sh
rm -rf apps/web/.next/cache
```

## CDN

The Next.js app ships static assets under `_next/static/...`. Any CDN that respects `Cache-Control` headers will work. The Dockerfile doesn't bundle a CDN; that's the operator's choice.

Never cache anything under `/preview` or `/preview-assets`, in any case, at a CDN or a proxy. Every answer the app sends there is `private, no-store`, but Next's 308 for a repeated slash or a backslash, such as `//preview/<grant>`, goes out before the app with no `Cache-Control`, and its body names the grant's path. Bypass the cache for every path that starts with `/preview` and every path holding `//` or a backslash.

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

To pull upstream changes:

```sh
git fetch origin
git rebase origin/main
pnpm install
pnpm typecheck
docker compose up --build
```

The platform follows semver: a major bump may change the schema in incompatible ways. Read the release notes before upgrading across majors.
