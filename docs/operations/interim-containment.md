# Interim containment prompt

This is the prompt the owner hands to an agent on the homelab host to move the live site onto the interim containment from #21. The agent denies the authoring paths at the reverse proxy, runs the `v0.1.1` image pinned by digest with `portfolio.yml` mounted read-only, proves both with `apps/web/scripts/check-containment.mjs`, and writes `posture.md` next to its backups. #18 (homelab migration) starts its inventory from that file.

To run it:

1. Wait for the `v0.1.1` digest on #21.
2. Copy everything between the `prompt:start` and `prompt:end` markers (they show in the raw file) and fill in `TARGET_IMAGE`.
3. Run it on the host that serves the site. The agent stops and asks you when the proxy is managed through a UI or a hosted service, and when it has no network outside the homelab to verify from.

<!-- prompt:start -->

## Input

```sh
TARGET_IMAGE=ghcr.io/keyurgolani/keyurgolani.name@sha256:<the v0.1.1 digest posted on issue #21>
```

If `TARGET_IMAGE` still holds the placeholder, or isn't `<repository>@sha256:<64 hex characters>`, stop and ask the owner for it.

## Context

You are on the Linux host that serves the owner's portfolio site, built from https://github.com/keyurgolani/keyurgolani.name. The baseline build (commit `62a0f06`) has an authoring surface with no access check. `/admin` shows the raw portfolio file and its server path, `GET /api/portfolio` returns the file with an `x-portfolio-path` header, and `PUT /api/portfolio`, `PUT /api/variant`, and `PUT /api/customize` rewrite it. Release `v0.1.1` answers 404 on all of them in production builds.

Your job is to deny those paths at the reverse proxy, run `TARGET_IMAGE` with the portfolio file mounted read-only, prove both with the repository's check script, and write a report. Work through steps 1 to 12 in order.

Names used below:

- `CLONE`: the release clone from step 2.
- `BACKUP`: the backup directory from step 5.
- `NAME`: the `identity.name` value read in step 5.
- `IMAGE`: the image the service runs after step 9 (step 8 says which).
- `<compose file>`, `<project>`, `<service>`, `<container>`, `<origin>`: what the inventory in step 3 finds.

## 1. Rules

- Modify exactly three existing things: the proxy config (to add one rule), the portfolio mount mode, and the image reference. The only new things you create are the clone directory, the backup directory with `posture.md`, the target image (pulled, or built in step 8), and `node:22-alpine` if you run the check script through Docker.
- In the deployment directory, don't delete, move, check out, reset, stash, or clean anything. It still holds legacy trees. Don't remove containers, images, volumes, or networks, and don't prune.
- Never print a plaintext password, password hash, cookie, private key, API token, any env file content, or unrelated host data. In practice:
  - Never `cat`, `grep`, `head`, `diff`, or `source` an env file. Copy it with `cp -p` and hash it.
  - Validate Compose only with `docker compose config --quiet`. Plain `docker compose config` prints interpolated secrets.
  - Read container and image facts only through `docker inspect --format` and `docker image inspect --format` with these templates: `{{.Config.Image}}`, `{{.Image}}`, `{{json .Mounts}}`, `{{json .HostConfig.PortBindings}}`, `{{json .State.Health}}`, `{{index .Config.Labels "org.opencontainers.image.revision"}}`, and for images `{{.Id}}` and `{{json .RepoDigests}}`. Never run bare `docker inspect`, which prints `Config.Env`. Never print all labels; proxy labels can hold password hashes.
  - Read any config (Compose files, the proxy config, crontabs, unit files) through the secret filter `grep -nviE 'token|secret|passw|api[_-]?key|private|credential|cookie|auth'`. If the filter hides no lines of a file (its count matches `wc -l`), you may read and edit that file normally. Otherwise edit it only with targeted commands that never print the hidden lines.
  - Never print a raw access log line. Those lines hold client addresses and user agents.
- Send the site no requests other than the check script runs and the `/api/health` checks in steps 3 and 9.
- Stop at the first failure and write an honest incomplete report (step 12) that names the step and the failing probe. After step 9 changes the Compose file, a failure that matches a Rollback trigger (step 11) runs Rollback first and then stops. Any other failure after step 9 stops with the new container running and the proxy rule in place.
- Don't fix, upgrade, or tidy anything this prompt doesn't list. If the host doesn't look like a step expects, stop and report what you found.
- Use `sudo` only when a listed read or change needs it.

## 2. Tools

Clone the release into a new directory outside the deployment directory and record its commit:

```sh
CLONE=~/kgn-21-v0.1.1
git clone --depth 1 --branch v0.1.1 https://github.com/keyurgolani/keyurgolani.name "$CLONE"
git -C "$CLONE" rev-parse HEAD
```

The check script needs Node 22 or newer and nothing else. If `node --version` prints `v22` or later, `<check>` below means:

```sh
node "$CLONE/apps/web/scripts/check-containment.mjs"
```

Otherwise it means:

```sh
docker run --rm --network host -v "$CLONE":/repo:ro node:22-alpine node /repo/apps/web/scripts/check-containment.mjs
```

Usage is `<check> <url> [--expect-name <name>] [--direct] [--no-put]`. `--direct` means the URL reaches the app with no proxy in front, so a denial must be the app's own 404. `--no-put` skips the three PUT probes. The script prints one line per probe (method, path, expected, actual, `PASS` or `FAIL`) and a count, and exits 0 when every probe passes, 1 when any fails, and 2 on bad arguments. It never prints response bodies or header values. Its PUT bodies (`{` and `{}`) fail validation on every build this prompt can meet, so they can't change the portfolio file. Still, send them only where a step says so.

The rows are:

- Denial rows: `GET /admin`, `GET /variants`, `GET /preview/editorial`, `GET /api/portfolio`, the three `PUT` rows, and `GET /_next/image?...`.
- The five 200 rows: `GET /`, `GET /feed.xml`, `GET /api/health`, `GET /robots.txt`, `GET /sitemap.xml`.
- The sitemap-body row (`BODY /sitemap.xml`), the identity row (`BODY /`, only with `--expect-name`), and the header row (`HEADER`).

Save every run with its exit code in the backup directory and show it:

```sh
<check> <url> <flags> > "$BACKUP/check-<step>.txt" 2>&1; echo "exit $?" >> "$BACKUP/check-<step>.txt"; cat "$BACKUP/check-<step>.txt"
```

## 3. Read-only inventory

Note these down. You write `posture.md` in step 12, and you create no files before step 5 apart from the clone.

1. The container that serves the site: `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`. In the repository's own Compose file the service is `web`, the container is `portfolio`, and the image is `portfolio:latest`. This host may differ.
2. Whether Docker Compose v2 runs it: `docker compose version` reports v2 or later, and `docker compose ls --all` lists the project with its Compose file. Get service names with `docker compose -p <project> ps --format '{{.Service}}\t{{.Name}}\t{{.Image}}'`. If Compose v2 doesn't run the service, or a UI such as Portainer manages the stack, back up the proxy config as in step 5, apply only the proxy stopgap from step 7, and stop with an incomplete report.
3. The Compose file path or paths, the project name, the project directory, and the service and container names.
4. The current image: `docker inspect --format '{{.Config.Image}} {{.Image}}' <container>`, then `docker image inspect --format '{{.Id}} {{json .RepoDigests}} {{index .Config.Labels "org.opencontainers.image.revision"}}' <that image>`.
5. Whether the service builds from a checkout (a `build:` key). If it does, run only `git rev-parse HEAD` and `git --no-optional-locks status --porcelain` in that directory. Record the revision and the changed paths, with modified tracked files separate from untracked ones. Never print file contents from that tree.
6. Image auto-updaters: containers such as Watchtower or Diun, and cron jobs or systemd timers that run `docker pull` or `docker compose pull`. Read crontabs and unit files through the secret filter, and don't change anything you find.
7. The reverse proxy: the product, where its config lives (a file, a directory, labels on containers, a UI, or a hosted service such as a tunnel), how it reloads, and where its access logs go.
8. The public origin: the site address in the proxy config that routes to the app, for example `https://<host>`. Take it from the config; never guess. If several addresses serve the app, use the one that answers with the site rather than a redirect.
9. Published ports: `docker inspect --format '{{json .HostConfig.PortBindings}}' <container>`. An empty `HostIp` or `0.0.0.0` means every interface. If the app port is published beyond loopback, check whether it answers without the proxy by requesting `http://<this host's LAN address>:<port>/api/health` from this host, and from another machine if you have one. Docker-published ports usually bypass host firewalls such as `ufw`, so a firewall rule alone doesn't prove the port is closed. Record exactly what you tested.
10. Every mount, with its mode: `docker inspect --format '{{json .Mounts}}' <container>`.
11. The portfolio file: the host path of the mount whose destination is `/data/portfolio.yml` (or whichever file the app reads), with its size, mtime, and SHA-256 (`stat`, `sha256sum`). Don't print its content.
12. Existing backups of the portfolio file or the deployment, such as `portfolio.yml.bak*`. Note them and leave them alone.

## 4. Prior exposure

From whatever proxy access logs exist (files, rotated `.gz` files, `docker logs <proxy>`, or journald), count requests per day to `/admin` (any method), `GET /api/portfolio`, and `PUT` to `/api/portfolio`, `/api/variant`, and `/api/customize`. Report counts and dates only, plus each log source and the earliest date it covers. Never print a raw line, a client address, or a user agent. For the nginx combined log format, for example:

```sh
zcat -f /var/log/nginx/access.log* | awk '{
  d = substr($4, 2, 11); m = substr($6, 2); split($7, u, "?"); p = u[1]
  if (p == "/admin" || index(p, "/admin/") == 1 || (m == "GET" && p == "/api/portfolio") ||
      (m == "PUT" && (p == "/api/portfolio" || p == "/api/variant" || p == "/api/customize")))
    print d, m, p
}' | sort | uniq -c
```

For JSON logs (Caddy, Traefik), extract only the timestamp, method, and path with `jq` or `python3`, then count the same way. Don't judge the portfolio file's content. Report its mtime from step 3; the owner compares the content with what he expects.

## 5. Backup

Create a new timestamped directory outside the deployment directory:

```sh
BACKUP=~/kgn-21-backup-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 0700 "$BACKUP"
```

Copy into it with `cp -p` (`cp -pR` for a directory): the portfolio file, every Compose file the project reads, every env file the Compose file references (`env_file:` entries and the project's `.env`), and the proxy config. Record each file's SHA-256, and confirm the portfolio copy hashes the same as the live file.

Read `identity.name` from the backed-up portfolio file. For YAML:

```sh
awk '/^identity:/ { f = 1; next } f && /^[^[:space:]#]/ { exit } f && /^[[:space:]]+name:/ { sub(/^[[:space:]]+name:[[:space:]]*/, ""); print; exit }' "$BACKUP/portfolio.yml"
```

Drop surrounding quotes from the value. That is `NAME`.

## 6. Before snapshot

Run `<check> <origin> --expect-name "$NAME" --no-put` and save it as `check-before.txt`. Failures are expected here.

Drop `--no-put` only when the inventory shows the running build comes from a clean `62a0f06` tree, or from a pulled image whose `org.opencontainers.image.revision` label is `62a0f06cf88c5d6c55045945bf0733a6882c5425`. A clean `62a0f06` tree means `git rev-parse HEAD` prints that commit and `git --no-optional-locks status --porcelain` lists nothing under `apps/` or `packages/` and no `Dockerfile`, `package.json`, or `pnpm-lock.yaml`. Untracked legacy directories, `portfolio.yml`, env files, and Compose edits don't count. Use the same choice in step 7.

Re-hash the portfolio file. If it differs from the backup, stop with an incomplete report.

## 7. Proxy stopgap

Deny, with 404 or 403, the path prefixes `/admin`, `/variants`, `/preview/`, `/api/`, and `/_next/image`, with an exact-match allow for `/api/health` that wins over the denial. The `/variants` prefix also covers the static files under `apps/web/public/variants/`, which no page renders. Mark the rule with a `kgn-21 containment` comment.

Caddy, inside the app's site block. Caddy's default directive order runs `respond` before `reverse_proxy`. If the block sends traffic through `handle` blocks, use `handle @kgn21_deny { respond 404 }` instead, since `handle` runs before `respond`. Inside a `route` block, order is literal, so put the rule first there.

```caddyfile
# kgn-21 containment: deny the authoring surface, keep /api/health
@kgn21_deny {
	path /admin* /variants* /preview/* /api/* /_next/image*
	not path /api/health
}
respond @kgn21_deny 404
```

nginx, inside the app's `server` block. Copy `proxy_pass` and the proxy headers from the app's existing `location /` into the health location:

```nginx
# kgn-21 containment: deny the authoring surface, keep /api/health
location = /api/health { proxy_pass <same upstream as location />; }
location ^~ /admin       { return 404; }
location ^~ /variants    { return 404; }
location ^~ /preview/    { return 404; }
location ^~ /api/        { return 404; }
location ^~ /_next/image { return 404; }
```

Other proxies need the same behavior. If the proxy is managed through a UI or a hosted service, print the exact rule, ask the owner to apply it, and wait. If the rule would have to live in labels on the app container (Traefik's Docker provider, for example), applying it means recreating the app container before step 9, so stop and ask the owner.

Edit the config in place. If the proxy runs in a container with its config bind-mounted as a single file, a tool that saves by writing a new file and renaming it (`sed -i` and some editors) leaves the container reading the old file. Write the new version into `$BACKUP` first, copy it over the live file in place with `cat "$BACKUP/<config name>.new" > <config file>`, and confirm the container sees the rule with `docker exec <proxy> grep -n 'kgn-21 containment' <config path inside the container>`.

Run the proxy's own config check, then reload rather than restart. Prefix these with `docker exec <proxy>` when the proxy runs in a container:

- Caddy: `caddy validate --config <Caddyfile> --adapter caddyfile`, then `caddy reload --config <Caddyfile> --adapter caddyfile`. The official image keeps it at `/etc/caddy/Caddyfile`.
- nginx: `nginx -t`, then `nginx -s reload`, or `systemctl reload nginx` for a host service.

If the check fails, restore the config from the backup and stop. If the proxy can't reload without a restart, stop and ask the owner.

Re-run the script through the proxy with the step 6 flags and save it as `check-proxy.txt`. The denial rows, the header row, and the five 200 rows must pass. The identity row must pass if it passed in step 6. The sitemap-body row may still fail until step 9.

- If a 200 row or the identity row fails, restore the proxy config from the backup (in place), check it, reload, and stop with an incomplete report.
- If a denial row or the header row fails, the rule isn't matching. Fix it and re-run. If you can't make those rows pass, stop with an incomplete report.

## 8. Image

Pull the target image if the host doesn't have it, and confirm it was built from the clone's commit:

```sh
docker pull "$TARGET_IMAGE"
docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$TARGET_IMAGE"
```

The label must match `git -C "$CLONE" rev-parse HEAD`. Stop if it doesn't. When the pull works, `IMAGE` is `TARGET_IMAGE`.

If the pull fails, build the clone instead and record the image ID in `posture.md`. Never build from the deployment checkout.

```sh
docker build -t keyurgolani-name:0.1.1 "$CLONE"
docker image inspect --format '{{.Id}}' keyurgolani-name:0.1.1
```

`IMAGE` is then `keyurgolani-name:0.1.1`.

## 9. Compose

In the Compose file, change only the app service:

- Set `image:` to `IMAGE`, adding the key if the service has none. Leave a `build:` key in place; `--no-build` below ignores it.
- Make the mount that provides `/data/portfolio.yml` read-only. In the short syntax, `:rw` or no mode becomes `:ro`. In the long syntax, add `read_only: true`.

Show the diff without context lines, which keeps unrelated values off the screen, and redact any changed line that holds a secret:

```sh
diff -U0 "$BACKUP/<compose file name>" <compose file>
```

Validate it, then recreate only the app service. Run Compose with the project name from the inventory so it replaces the existing container instead of starting a second project:

```sh
docker compose -p <project> -f <compose file> config --quiet
docker compose -p <project> -f <compose file> up -d --no-build <service>
```

Wait up to three minutes for `docker inspect --format '{{json .State.Health}}' <container>` to show `"Status":"healthy"`. A status of `unhealthy`, or no `healthy` after three minutes, is a Rollback trigger: go to step 11. If the service has no healthcheck, wait instead for `/api/health` on the app port to answer 200.

## 10. Verify

1. Run `docker inspect --format '{{.Config.Image}} {{.Image}} {{json .Mounts}}' <container>`. `{{.Config.Image}}` must be `IMAGE`, `{{.Image}}` must equal `docker image inspect --format '{{.Id}}' "$IMAGE"`, and the portfolio mount must show `"RW":false`. Stop if any of them doesn't.
2. Check the app without the proxy, PUT probes included: `<check> http://127.0.0.1:<published port> --direct --expect-name "$NAME"`, saved as `check-direct.txt`. Use the binding's `HostIp` instead of `127.0.0.1` when it's a specific address. If the app port isn't published, run the check on the service's network: `docker run --rm --network <service network> -v "$CLONE":/repo:ro node:22-alpine node /repo/apps/web/scripts/check-containment.mjs http://<container>:<container port> --direct --expect-name "$NAME"`.
3. Check the public origin from a network outside the homelab, PUT probes included: `<check> <origin> --expect-name "$NAME"`, saved as `check-public.txt`. If you have no outside network, run it from this host anyway, label it "from the host, not outside", record what the origin's host name resolves to (`getent hosts <host>` or `dig +short <host>`), and give the owner the exact command to run from another network, such as a phone hotspot.
4. Re-hash the live portfolio file. It must still match the backup.

Every row must pass in both runs. A failing row listed as a trigger in step 11 runs Rollback. Any other failing row stops the run with the new container and the proxy rule in place.

## 11. Rollback

Triggers, after step 9: the healthcheck (`unhealthy`, or not `healthy` within three minutes), or a failing `/`, `/feed.xml`, `/api/health`, or identity row in either step 10 run.

1. Restore the Compose file: `cp -p "$BACKUP/<compose file name>" <compose file>`.
2. Recreate the container on the previous image: `docker compose -p <project> -f <compose file> up -d --no-build <service>`. `--no-build` keeps Compose from rebuilding the legacy checkout.
3. Confirm `docker inspect --format '{{.Config.Image}} {{.Image}}' <container>` matches the inventory, and wait for health as in step 9.
4. Re-run the script through the proxy with the step 6 flags and save it as `check-rollback.txt`.
5. Keep the proxy rule, unless the rule itself broke a public route.

## 12. Report

Write `$BACKUP/posture.md` in the format below, then print the public summary. If you stop before step 5 creates `BACKUP`, put the report in your final message instead. Mark anything you couldn't do as open. Don't post anything anywhere; the owner posts the summary.

## Report format

`posture.md`:

```markdown
# Interim containment posture

- Date (UTC):
- Prompt: docs/operations/interim-containment.md at <clone commit> (v0.1.1)
- Result: complete | incomplete, stopped at step <n> (<failing probe or reason>) | rolled back at step <n>

## Inventory (redacted)
- Compose files, project, project directory, service, container:
- Image before: reference, image ID, revision label:
- Builds from a checkout: no | yes, HEAD <commit>, <n> modified tracked paths, <n> untracked paths (list them)
- Image auto-updaters:
- Proxy: product, config location, reload method, access log sources:
- Public origin:
- Published ports, and whether the app port answers without the proxy (what you tested, from where):
- Mounts (destination, source, RW):
- portfolio.yml: host path, size, mtime, SHA-256:
- Existing backups:

## Prior exposure
| Date | /admin | GET /api/portfolio | PUT /api/portfolio | PUT /api/variant | PUT /api/customize |
|---|---|---|---|---|---|
Log sources and the earliest date each covers:

## Backup
- Directory:
- Files and SHA-256:
- Portfolio copy hash matches the live file: yes | no

## Check runs
For each of before, proxy, direct, public, and rollback (if run): the command, the exit code, and the full output.

## Image
- TARGET_IMAGE:
- Pulled or built; image ID; revision label; matches the clone commit:

## Compose diff (redacted)

## Proxy rule
The exact rule, where it went, and the config check output.

## Rollback commands
The exact commands that put back the previous Compose file and container, and the previous proxy config.

## Open items
- App port reachable without the proxy:
- Image auto-updaters:
- Single-file portfolio mount: rename-based saves (`sed -i`, some editors) need a container restart to show.
- Anything else that didn't match this prompt:
```

Public summary, printed at the end. Include no host paths, addresses, ports, inventory, exposure counts, or proxy details:

```markdown
Interim containment applied on <YYYY-MM-DD> (UTC).

- Tag: v0.1.1
- Image: <TARGET_IMAGE>
- Outside-network check, run from <where>:

<the full output of check-public.txt, in a code block>
```

If the outside-network run is still pending, say so in the summary and leave the output for the owner to add.

## Editing the portfolio until #18

Until #18 (homelab migration) moves the live site onto #8 (Owner Studio), the owner edits the portfolio file on the host. End your final message with this note for him, filled in:

> To change the site, edit `<host path of portfolio.yml>` on the host, in place, for example `cat new.yml > <host path of portfolio.yml>`. The container has a single-file mount, so a tool that saves by renaming (`sed -i`, some editors) leaves it on the old copy. If a change doesn't show, run `docker compose -p <project> -f <compose file> restart <service>`. Validate the file first in a full checkout (`pnpm install`, then `node skills/portfolio-author/scripts/validate.mjs <file>`); a file that fails validation turns `/` into an error page and `/feed.xml` into a 500 until you fix it.

<!-- prompt:end -->
