# Interim containment prompt

This is the prompt the owner hands to an agent on the homelab host to move the live site onto the interim containment from #21. The agent denies the authoring paths at the reverse proxy, runs the `v0.1.1` image pinned by digest with `portfolio.yml` mounted read-only, proves both with `apps/web/scripts/check-containment.mjs`, and writes `posture.md` next to its backups. #18 (homelab migration) starts its inventory from that file.

To run it:

1. Wait for the `v0.1.1` digest on #21.
2. Copy everything between the `prompt:start` and `prompt:end` markers (they show in the raw file), fill in `TARGET_IMAGE`, and save it on the host, for example as `~/kgn-21-prompt.md`. Give the agent the text and that path.
3. Run it on the host that serves the site. The agent stops and asks you when the proxy is managed through a UI or a hosted service. If it can't check the site from a network outside the homelab, it finishes, records that, and gives you the exact command to run from another network, such as a phone hotspot.

<!-- prompt:start -->

## Input

```sh
TARGET_IMAGE=ghcr.io/keyurgolani/keyurgolani.name@sha256:<the v0.1.1 digest posted on issue #21>
```

If `TARGET_IMAGE` still holds the placeholder, or isn't `<repository>@sha256:<64 hex characters>`, stop and ask the owner for it. The owner normally saved this prompt on the host and gave you its path; step 2 compares it with the release's copy.

## Context

You are on the Linux host that serves the owner's portfolio site, built from https://github.com/keyurgolani/keyurgolani.name. The baseline build (commit `62a0f06`) has an authoring surface with no access check. `/admin` shows the raw portfolio file and its server path, `GET /api/portfolio` returns the file with an `x-portfolio-path` header, and `PUT /api/portfolio`, `PUT /api/variant`, and `PUT /api/customize` rewrite it. Release `v0.1.1` answers 404 on all of them in production builds, and renders robots, the sitemap, and the Open Graph image from the mounted file.

Your job is to deny those paths at the reverse proxy, run `TARGET_IMAGE` with the portfolio file mounted read-only, prove both with the repository's check script, and write a report. Work through steps 1 to 12 in order.

## How commands work here

Your shell keeps no variables between commands, and it may be zsh, which doesn't split an unquoted variable into words. So:

- Step 2 creates `$BACKUP/vars.sh` and prints its path. Start every later command with `. <that path>;`, typing the literal path. Append each value you record with `printf "%s='%s'\n" NAME "value" >> "${BACKUP:?}/vars.sh"`. None of these values is a secret. If one you'd append this way contains a single quote, stop and ask the owner.
- Use `${VAR:?}` in every command that writes, copies, or restores, so a missing variable stops the command instead of writing somewhere else.
- `vars.sh` also defines three helpers: `kgn21_check` and `kgn21_tools` (step 2) and `kgn21_compose` (step 3).

`kgn21_check <url> [--expect-name <name>] [--expect-origin <origin>] [--direct] [--no-put]` runs the release's check script. It probes a running site, prints one line per probe (method, path, expected, actual, `PASS` or `FAIL`) and then a count, and exits 0 when every probe passes, 1 when any fails, and 2 on bad arguments. It never prints response bodies, header values, or error text. `--direct` means the URL reaches the app with no proxy in front, so a denial must be the app's own 404. `--no-put` skips the three PUT probes. Its PUT bodies (`{` and `{}`) fail validation on every build this prompt can meet, so they can't change the portfolio file. The commands below pass `--expect-origin "$ORIGIN"`; leave that flag out when `ORIGIN` is empty (step 5).

`kgn21_tools <command>` runs the release's containment tools. Each reads stdin and prints only what a step needs: `compose-lines`, `proxy-lines caddy|nginx`, `compose-edit`, `compose-diff`, `facts`, and `exposure`.

Every check run uses the same pattern, with `<step>` one of `before`, `proxy`, `direct`, `public`, or `rollback`:

```sh
kgn21_check <url> <flags> > "${BACKUP:?}/check-<step>.txt" 2>&1; echo "exit $?" >> "${BACKUP:?}/check-<step>.txt"; cat "${BACKUP:?}/check-<step>.txt"
```

The rows are:

- Denial rows: `GET /admin`, `GET /variants`, `GET /preview/editorial`, `GET /api/portfolio`, the three `PUT` rows, and `GET /_next/image?...`.
- The five 200 rows: `GET /`, `GET /feed.xml`, `GET /api/health`, `GET /robots.txt`, `GET /sitemap.xml`.
- The sitemap-body row (`BODY /sitemap.xml`), the origin rows (`ORIGIN /robots.txt` and `ORIGIN /sitemap.xml`, only with `--expect-origin`), the identity row (`BODY /`, only with `--expect-name`), and the header row (`HEADER`).

## 1. Rules

- Change exactly three existing things: the proxy config (one added rule), the portfolio mount mode, and the image reference in the Compose file. The only new things you create are the clone directory; the backup directory and the files this prompt puts in it (`vars.sh`, copies, `.new` files, the rule file, prompt copies, check outputs, `posture.md`); the target image (pulled, or built in step 8); `node:22-alpine` when the host has no Node 22 or step 10 needs it; and throwaway `docker run --rm` containers for the helpers and the proxy config check.
- In the deployment directory, don't delete, move, check out, reset, stash, or clean anything. It still holds legacy trees. Don't remove containers, images, volumes, or networks, and don't prune. The one exception is the app container: step 9 recreates it, and step 11 recreates it again if you roll back.
- Run Compose for this project only as `kgn21_compose config --quiet` and `kgn21_compose up -d --no-build --no-deps <service>`, plus the one `config --quiet` on the `.new` file in step 9. `docker compose version` and `docker compose ls --all` are fine. The Compose file may keep a `build:` key that points at the legacy checkout, so never run `build`, `up --build`, `pull`, `down`, `restart`, or a plain `up`.
- Never print a plaintext password, password hash, cookie, private key, API token, any env file content, or unrelated host data. In practice:
  - Never open an env file with `cat`, `grep`, `head`, `diff`, `source`, or an editor. Copy it with `cp -p` and hash it.
  - Read Compose files only with `kgn21_tools compose-lines` and proxy configs only with `kgn21_tools proxy-lines caddy|nginx`. They print an allowlist and number every line they print. From Compose: `image:`, `build:` with its `context:` and `dockerfile:`, `ports:`, `volumes:`, `env_file:`, `networks:`, and a few other harmless keys with their values, and every other key by name only. From the proxy: site addresses, `reverse_proxy` or `proxy_pass`, `handle`, `route`, or `location` lines, path matchers, and log outputs. Never print either file another way, and change them only with the commands in steps 7, 9, and 11.
  - Validate Compose only with `config --quiet`.
  - Read container and image facts only with `docker inspect --format` and `docker image inspect --format`, one template per command, from this list: `{{.Config.Image}}`, `{{.Image}}`, `{{.Id}}`, `{{json .RepoDigests}}`, `{{json .Mounts}}`, `{{json .HostConfig.PortBindings}}`, `{{json .Config.ExposedPorts}}`, `{{json .State.Health}}`, `{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}`, and one label at a time as `{{with .Config.Labels}}{{index . "<label>"}}{{end}}` for `org.opencontainers.image.revision`, `com.docker.compose.project`, `com.docker.compose.service`, `com.docker.compose.project.config_files`, `com.docker.compose.project.working_dir`, and `com.docker.compose.project.environment_file`. Never run a bare `inspect`, which prints `Config.Env`, and never print all labels, which can hold proxy password hashes. If a template errors, record that; don't reach for a broader one.
  - Never print a raw access log line. Count with `kgn21_tools exposure`.
  - Inside containers, run only `sha256sum /data/portfolio.yml` in the app container, and the `grep -c`, validate, and reload commands from step 7 in the proxy.
- Send the site no requests other than check runs and the `/api/health` checks in steps 3 and 9.
- Stop at the first failure and write an honest incomplete report (step 12) that names the step and the failing probe. After step 9 changes the Compose file, a failure that matches a Rollback trigger (step 11) runs Rollback first and then stops. Any other failure after step 9 stops with the new container running and the proxy rule in place.
- Don't fix, upgrade, or tidy anything this prompt doesn't list. If the host doesn't look like a step expects, stop and report what you found.
- Use `sudo` only when a listed read or change needs it.

## 2. Setup

Run this block as one command. It creates the backup directory, clones the release next to it, and starts `vars.sh`. Both directories get a timestamp, so a second run never collides with the first.

```sh
RUN=$(date -u +%Y%m%dT%H%M%SZ); BACKUP="${HOME:?}/kgn-21-backup-$RUN"; CLONE="${HOME:?}/kgn-21-v0.1.1-$RUN"
mkdir -m 0700 "$BACKUP" &&
  git clone --depth 1 --branch v0.1.1 https://github.com/keyurgolani/keyurgolani.name "$CLONE" &&
  printf "%s='%s'\n" RUN "$RUN" START "$(date -u +%s)" BACKUP "$BACKUP" CLONE "$CLONE" CLONE_COMMIT "$(git -C "$CLONE" rev-parse HEAD)" > "$BACKUP/vars.sh" &&
  echo "$BACKUP/vars.sh"
```

`START` is this run's start time; step 4 leaves out every log entry from then on. Append `TARGET_IMAGE` with the value from the Input.

Then add the two helpers. If `node --version` prints `v22` or later:

```sh
cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_check() { node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "$@"; }
kgn21_tools() { node "${CLONE:?}/apps/web/scripts/containment-tools.mjs" "$@"; }
EOF
```

Otherwise run them on Node in a container, which pulls `node:22-alpine`:

```sh
cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_check() { docker run --rm -i --network host -v "${CLONE:?}:${CLONE:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "$@"; }
kgn21_tools() { docker run --rm -i --network none -v "${CLONE:?}:${CLONE:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/containment-tools.mjs" "$@"; }
EOF
```

Check the shell for variables that would change what Compose does. This prints names only:

```sh
env | cut -d= -f1 | grep -E '^(PORT|COMPOSE_[A-Z0-9_]*)$'
```

It must print nothing. If it prints a name, stop and ask the owner.

Compare the prompt you were given with the release's copy, ignoring the `TARGET_IMAGE` line. Use the path the owner gave you as `<prompt file>`. If you only have the text, write it exactly as given to `${BACKUP:?}/prompt-given.md` and use that.

```sh
sed -n '/^<!-- prompt:start -->$/,/^<!-- prompt:end -->$/p' "${CLONE:?}/docs/operations/interim-containment.md" | grep -v -e '^<!-- prompt:' -e '^TARGET_IMAGE=' | sed 's/[[:space:]]*$//' > "${BACKUP:?}/prompt-release.txt"
grep -v -e '^<!-- prompt:' -e '^TARGET_IMAGE=' "<prompt file>" | sed 's/[[:space:]]*$//' > "${BACKUP:?}/prompt-given.txt"
diff -q -B "${BACKUP:?}/prompt-release.txt" "${BACKUP:?}/prompt-given.txt"
```

Append `PROMPT_SOURCE` (the path, or `pasted`) and `PROMPT_MATCH` (`yes` or `no`). If they differ, carry on with the prompt you were given and say so in the report.

## 3. Read-only inventory

Note these down for the report, and append the named values to `vars.sh`.

1. The container that serves the site: `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`. In the repository's own Compose file the service is `web`, the container is `portfolio`, and the image is `portfolio:latest`. This host may differ. Append `CONTAINER`.
2. Whether Docker Compose v2 runs it: `docker compose version` reports v2 or later, and `docker compose ls --all` lists the project and its config files. Read the container's Compose labels, one per command, with the label template from the rules: `com.docker.compose.project` (append `PROJECT`), `com.docker.compose.service` (`SERVICE`), `com.docker.compose.project.working_dir` (`PROJECT_DIR`), `com.docker.compose.project.config_files` (`COMPOSE_FILES`, comma-separated, in order), and `com.docker.compose.project.environment_file`. Then define the Compose helper, as described after this list.

   If Compose v2 doesn't run the service, or a UI such as Portainer manages the stack, note that and skip the Compose parts: the helper, items 4 and 5 below, and the Compose and env files in step 5. Go on through step 7, then stop at step 8 with an incomplete report; changing the image and the mount needs the owner.
3. The current image: `docker inspect --format '{{.Config.Image}}' "$CONTAINER"` (append `PREV_IMAGE_REF`) and `docker inspect --format '{{.Image}}' "$CONTAINER"` (append `PREV_IMAGE_ID`). For `PREV_IMAGE_ID`, read `{{json .RepoDigests}}` and the `org.opencontainers.image.revision` label with `docker image inspect`.
4. The Compose files: run `kgn21_tools compose-lines < <file>` for each config file. Find the file that holds both the service's `image:` (or `build:`) line and its `/data/portfolio.yml` mount, and append it as `EDIT_FILE`. If no single file holds both, stop and ask the owner. Note whether the service has a `build:` key, which `env_file:` entries it lists, and its ports.
5. If `PROJECT_DIR` is a git checkout, run only `git -C "$PROJECT_DIR" rev-parse HEAD` and `git --no-optional-locks -C "$PROJECT_DIR" status --porcelain` there. Record the revision and the changed paths, with modified tracked files apart from untracked ones. Never print file contents from that tree.
6. Image auto-updaters, by name and count only: `docker ps --format '{{.Names}}\t{{.Image}}' | grep -iE 'watchtower|diun|ouroboros|shepherd'`, `crontab -l 2>/dev/null | grep -cE 'docker (compose )?pull|watchtower'`, `grep -rlE 'docker (compose )?pull|watchtower' /etc/cron* /var/spool/cron 2>/dev/null`, and `systemctl list-timers --all --no-pager`. Don't change anything you find.
7. The reverse proxy: the product, whether it runs in a container or as a host service, the file that holds the app's site block (from the proxy container's `{{json .Mounts}}`), how it reloads, and where its access logs go. Read that file with `kgn21_tools proxy-lines caddy < <file>` (or `nginx`). Append `PROXY_KIND` (`caddy` or `nginx`), `PROXY_CONTAINER` (empty for a host service), `PROXY_CONFIG` (the file's host path), `PROXY_CONFIG_IN` (its path inside the container), `PROXY_MAIN_IN` (the main config file the proxy loads, normally `/etc/caddy/Caddyfile` or `/etc/nginx/nginx.conf`; the same as `PROXY_CONFIG_IN` unless the main file imports or includes the one with the site block), `PROXY_IMAGE` (the proxy container's `{{.Config.Image}}`), `PROXY_NETWORK` (one of its networks), and `PROXY_SITE_LINE`: the number of the line that opens the app's site block with `{`, which is the site address line for Caddy and the `server {` line for nginx. For a host service, use the host paths for the `_IN` values. If the proxy is managed through a UI or a hosted service such as a tunnel, or is configured through labels on the app container, note that; step 7 handles it.
8. The public origin: the site address in the proxy config that routes to the app, for example `https://<host>`. Take it from the config; never guess. If several addresses serve the app, use the one that answers with the site rather than a redirect. Append `SITE`.
9. Published ports: `docker inspect --format '{{json .HostConfig.PortBindings}}' "$CONTAINER"`. Append the host port as `APP_PORT`. An empty `HostIp` or `0.0.0.0` means every interface. If the port is published beyond loopback, check whether it answers without the proxy by requesting `http://<this host's LAN address>:<port>/api/health` from this host, and from another machine if you have one. Docker-published ports usually bypass host firewalls such as `ufw`, so a firewall rule alone doesn't prove the port is closed. Record exactly what you tested.
10. Every mount, with its mode: `docker inspect --format '{{json .Mounts}}' "$CONTAINER"`.
11. The portfolio file: the host path of the mount whose destination is `/data/portfolio.yml` (append `PORTFOLIO_FILE`), its size and mtime (`stat`), and its SHA-256 (`sha256sum`; append `PORTFOLIO_SHA`). Don't print its content. Compare with what the container reads: `docker exec "$CONTAINER" sha256sum /data/portfolio.yml`. A different hash means the container serves an older copy, which a rename-based save on the host causes; record it.
12. Existing backups of the portfolio file or the deployment, such as `portfolio.yml.bak*`. Note them and leave them alone.

The Compose helper from item 2 passes the project name, the working directory, and one `-f` per config file, in the order of `COMPOSE_FILES`:

```sh
cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_compose() { docker compose -p '<project>' --project-directory '<working dir>' -f '<first file>' -f '<next file>' "$@"; }
EOF
```

If a path contains a single quote, stop and ask the owner. Then run `kgn21_compose config --quiet`. If it fails, stop: Compose can't read the files the stack runs from.

## 4. Prior exposure

Feed whatever proxy access logs exist to the exposure counter, one source at a time, for example:

```sh
zcat -f <access log files> | kgn21_tools exposure --before "${START:?}"
docker logs <proxy container> 2>&1 | kgn21_tools exposure --before "${START:?}"
journalctl -u <proxy unit> --no-pager -o cat | kgn21_tools exposure --before "${START:?}"
```

It counts every method on `/admin` (and paths under it), `/variants`, `/api/portfolio`, `/api/variant`, and `/api/customize` per day, with case, percent-encoding, repeated slashes, and dot segments normalized, and splits each count into 2xx, 3xx, 4xx, and 5xx responses. It leaves out entries at or after `START`, which are this run's own requests, and says how many of the counted requests came from an earlier run of the check script. It never prints a raw line, an address, or a user agent. Put its output in the report with each source and the earliest date it covers, and say that entries from this run's start on aren't counted. If a `PUT` row, or `GET /api/portfolio`, shows a 2xx, say so at the top of the report.

Don't judge the portfolio file's content. Report its mtime from step 3; the owner compares the content with what he expects.

## 5. Backup

Copy the files into `$BACKUP`, one `cp -p` per file:

```sh
cp -p "${PORTFOLIO_FILE:?}" "${BACKUP:?}/portfolio.yml"
cp -p "${PROXY_CONFIG:?}" "${BACKUP:?}/"
cp -p <each Compose config file> "${BACKUP:?}/"
cp -p <each env file the project uses> "${BACKUP:?}/"
```

The env files are the service's `env_file:` entries and the interpolation file (`.env` in `PROJECT_DIR`, or the `com.docker.compose.project.environment_file` label). If two files share a name, copy the second to a numbered name and note it. Append `EDIT_BACKUP` and `PROXY_BACKUP`, the backup copies of `EDIT_FILE` and `PROXY_CONFIG`. Then hash everything:

```sh
find "${BACKUP:?}" -maxdepth 1 -type f ! -name vars.sh ! -name 'prompt-*' -exec sha256sum {} +
```

The `portfolio.yml` copy must hash to `PORTFOLIO_SHA`.

Read the name, origin, and variant from the copy:

```sh
kgn21_tools facts < "${BACKUP:?}/portfolio.yml" >> "${BACKUP:?}/vars.sh"
```

That appends `NAME` (`identity.name`), `ORIGIN` (the scheme, host, and port of `meta.url`), and `VARIANT`, already quoted for the shell. If it exits 1, stop with its message. If `ORIGIN` comes back empty, `meta.url` isn't set: leave `--expect-origin` out of every check and list it as an open item. If `ORIGIN` differs from `SITE`, note that robots and the sitemap advertise a different origin than the proxy serves.

Check that the release has the live file's variant:

```sh
test -d "${CLONE:?}/packages/variant-${VARIANT:?}" && echo present
```

If it doesn't print `present`, stop and report it.

## 6. Before snapshot

```sh
kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN" --no-put
```

Save it as `check-before.txt`. Failures are expected here.

Drop `--no-put` only when the inventory shows the running build comes from a clean `62a0f06` tree, or from a pulled image whose `org.opencontainers.image.revision` label is `62a0f06cf88c5d6c55045945bf0733a6882c5425`. A clean `62a0f06` tree means `git rev-parse HEAD` prints that commit and `git --no-optional-locks status --porcelain` lists nothing under `apps/` or `packages/` and no `Dockerfile`, `package.json`, or `pnpm-lock.yaml`. Untracked legacy directories, `portfolio.yml`, env files, and Compose edits don't count. Append the choice as `PUTFLAG` (`--no-put`, or empty) for step 7.

When this host can reach its own public origin, this run, the step 7 run, and the step 10 public run all go to the same URL, so a public run from this host shows no more than the step 7 run did. Only a run from another network shows what visitors get. If every row in this run is a connection failure (`connection refused`, `no answer in 10s`, `name lookup failed`, and so on), this host can't reach its own origin. Record that, give the owner the exact step 6, 7, and 10.3 commands with the values filled in, ask him to run them from another machine, and judge those steps by the output he sends back.

If the identity row fails, the live site doesn't show the expected name before anything changed. Do step 7, then stop before step 8 and report the cause. Two read-only checks narrow it down. Run `docker exec "$CONTAINER" sha256sum /data/portfolio.yml`; a hash that differs from `PORTFOLIO_SHA` means the container serves an older copy. Run `kgn21_check "$SITE" --expect-name "Anamika Devi" --no-put`; if that identity row passes, the site serves the bundled sample persona, so the mount path or the file is wrong.

Re-hash the portfolio file. If it differs from the backup, stop with an incomplete report.

## 7. Proxy stopgap

Deny, with 404 or 403, the path prefixes `/admin`, `/variants`, `/preview/`, `/api/`, and `/_next/image`, with an exact-match allow for `/api/health` that wins over the denial. The `/variants` prefix also covers the static files under `apps/web/public/variants/`, which no page renders.

If the proxy is managed through a UI or a hosted service, print the exact rule, ask the owner to apply it, wait, and go on to the re-run at the end of this step. If the rule would have to live in labels on the app container (Traefik's Docker provider, for example), applying it means recreating the app container before step 9, so stop and ask the owner.

Write the rule to `${BACKUP:?}/kgn21-rule.txt` with a quoted heredoc, indented to match the site block. For Caddy:

```caddyfile
	# kgn-21 containment: deny the authoring surface, keep /api/health
	@kgn21_deny {
		path /admin* /variants* /preview/* /api/* /_next/image*
		not path /api/health
	}
	handle @kgn21_deny {
		respond 404
	}
```

For nginx. Requests to `/api/health` fall through to the app's existing `location /`:

```nginx
	# kgn-21 containment: deny the authoring surface, keep /api/health
	location ^~ /admin       { return 404; }
	location ^~ /variants    { return 404; }
	location ^~ /preview/    { return 404; }
	location ^~ /_next/image { return 404; }
	location ~ ^/api/(?!health$) { return 404; }
```

Build the new config in `$BACKUP`, with the rule first in the app's site block:

```sh
{ head -n "${PROXY_SITE_LINE:?}" "${PROXY_CONFIG:?}"; cat "${BACKUP:?}/kgn21-rule.txt"; tail -n "+$((PROXY_SITE_LINE + 1))" "${PROXY_CONFIG:?}"; } > "${BACKUP:?}/<config name>.new"
kgn21_tools proxy-lines "$PROXY_KIND" < "${BACKUP:?}/<config name>.new"
```

The rule must show right after the site block's opening line. Check the `.new` file with the proxy's own validator before it goes live:

- Caddy in a container, with the site block in the main file: `docker exec -i "$PROXY_CONTAINER" caddy validate --adapter caddyfile --config /dev/stdin < "${BACKUP:?}/<config name>.new"`
- nginx in a container, or Caddy with the site block in an imported file: run the validator in a throwaway container from the proxy's image, on the proxy's network so upstream names resolve, with every mount of the proxy container read-only and the `.new` file over the file it replaces: `docker run --rm --network "${PROXY_NETWORK:?}" -v <host path>:<container path>:ro ... -v "${BACKUP:?}/<config name>.new":"${PROXY_CONFIG_IN:?}":ro "${PROXY_IMAGE:?}" nginx -t`, or `... caddy validate --adapter caddyfile --config "${PROXY_MAIN_IN:?}"` for Caddy.
- A host service: the validator reads the live files. Copy the `.new` file into place as below, run `nginx -t` or `caddy validate --adapter caddyfile --config "${PROXY_MAIN_IN:?}"`, and if it fails, copy `PROXY_BACKUP` back before anything else. Nothing reloads in between, so the running config doesn't change.

If the check fails because of the rule, fix the rule file and rebuild the `.new` file. If it fails for a reason outside the rule (a missing certificate, an import, an upstream that doesn't resolve), stop and ask the owner.

Copy it into place with `cp`, which writes into the existing file and keeps its inode, so a single-file bind mount sees the change. Never use `cat >`, `sed -i`, or an editor here. Then check that the proxy sees the rule (for a host service, `grep -c` the file itself):

```sh
cp "${BACKUP:?}/<config name>.new" "${PROXY_CONFIG:?}"
docker exec "${PROXY_CONTAINER:?}" grep -c 'kgn-21 containment' "${PROXY_CONFIG_IN:?}"
```

The count must be at least 1. If it's 0, the container doesn't see the file: restore it (below) and stop.

Reload rather than restart: `docker exec "$PROXY_CONTAINER" caddy reload --config "$PROXY_MAIN_IN" --adapter caddyfile`, `docker exec "$PROXY_CONTAINER" nginx -s reload`, or `systemctl reload <unit>` for a host service. If the proxy can't reload without a restart, restore, stop, and ask the owner.

Re-run the check through the proxy with the step 6 flags, `$PUTFLAG` in place of `--no-put`, and save it as `check-proxy.txt`:

```sh
kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN" $PUTFLAG
```

Judge it by rows, not by the exit code. The sitemap-body row and the origin rows may still fail until step 9, so exit 1 is expected here. The denial rows, the header row, and the five 200 rows must pass, and the identity row must pass if it passed in step 6.

- If a denial row fails, the rule isn't matching, probably because an earlier part of the config handles those paths. Don't restructure the existing config. Restore and stop.
- If a 200 row or the identity row fails, restore and stop.

To restore: `cp -p "${PROXY_BACKUP:?}" "${PROXY_CONFIG:?}"`, check it with the proxy's validator, and reload.

## 8. Image

Pull the target image and confirm it was built from the clone's commit:

```sh
docker pull "${TARGET_IMAGE:?}"
docker image inspect --format '{{with .Config.Labels}}{{index . "org.opencontainers.image.revision"}}{{end}}' "${TARGET_IMAGE:?}"
```

The label must equal `CLONE_COMMIT`. Stop if it doesn't. When the pull works, append `IMAGE` with the `TARGET_IMAGE` value.

If the pull fails, build the clone instead, append `IMAGE='keyurgolani-name:0.1.1'`, and record the image ID for the report. Never build from the deployment checkout.

```sh
docker build -t keyurgolani-name:0.1.1 "${CLONE:?}"
docker image inspect --format '{{.Id}}' keyurgolani-name:0.1.1
```

## 9. Compose

Write the edited Compose file into `$BACKUP` and check that only the image and the portfolio mount changed:

```sh
kgn21_tools compose-edit --service "${SERVICE:?}" --image "${IMAGE:?}" < "${EDIT_FILE:?}" > "${BACKUP:?}/<compose name>.new"
diff -U0 "${EDIT_FILE:?}" "${BACKUP:?}/<compose name>.new" | kgn21_tools compose-diff
```

`compose-edit` sets the service's `image:` (adding it if missing), makes the `/data/portfolio.yml` mount read-only, and names the lines it changed. It stops with a message when the file uses YAML merges, `extends`, or an inline volume list; stop and ask the owner then. `compose-diff` shows only the changed image and mount lines and must exit 0.

Validate the new file before it goes live. Pass every config file in `COMPOSE_FILES`, in order, with the `.new` file in place of `EDIT_FILE`:

```sh
docker compose -p "${PROJECT:?}" --project-directory "${PROJECT_DIR:?}" -f <file> ... -f "${BACKUP:?}/<compose name>.new" ... config --quiet
```

If it fails, stop; nothing has changed yet. Otherwise copy it into place and validate the live set:

```sh
cp "${BACKUP:?}/<compose name>.new" "${EDIT_FILE:?}"
kgn21_compose config --quiet
```

If that fails, run `cp -p "${EDIT_BACKUP:?}" "${EDIT_FILE:?}"` and stop. Otherwise recreate only the app service:

```sh
kgn21_compose up -d --no-build --no-deps "${SERVICE:?}"
```

A non-zero exit is a Rollback trigger: go to step 11. Otherwise wait up to three minutes for `docker inspect --format '{{json .State.Health}}' "$CONTAINER"` to show `"Status":"healthy"`. `unhealthy`, or no `healthy` after three minutes, is a Rollback trigger too. If the service has no healthcheck, wait for `http://127.0.0.1:$APP_PORT/api/health` to answer 200 instead.

## 10. Verify

1. `docker inspect --format '{{.Config.Image}}' "$CONTAINER"` must print `IMAGE`, `docker inspect --format '{{.Image}}' "$CONTAINER"` must equal `docker image inspect --format '{{.Id}}' "$IMAGE"`, the portfolio mount in `{{json .Mounts}}` must show `"RW":false`, and `docker exec "$CONTAINER" sha256sum /data/portfolio.yml` must print `PORTFOLIO_SHA`. Stop if any of them doesn't.
2. Check the app without the proxy, PUT probes included, and save it as `check-direct.txt`:

   ```sh
   kgn21_check "http://127.0.0.1:${APP_PORT:?}" --direct --expect-name "$NAME" --expect-origin "$ORIGIN"
   ```

   Use the binding's `HostIp` instead of `127.0.0.1` when it's a specific address. If the app port isn't published, read the container's networks with the `.NetworkSettings.Networks` template and its port with `{{json .Config.ExposedPorts}}`, then run the check on that network: `docker run --rm --network <network> -v "${CLONE:?}:${CLONE:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "http://${CONTAINER:?}:<port>" --direct --expect-name "$NAME" --expect-origin "$ORIGIN"`.
3. Check the public origin from a network outside the homelab, PUT probes included, and save it as `check-public.txt`: `kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN"`. If you have no outside network, run it from this host anyway and label it "from the host, not outside". Record what the origin's host name resolves to (`getent hosts <host>` or `dig +short <host>`), give the owner the exact command with the values filled in, mark the outside check pending, and carry on to step 12.
4. Re-hash the live portfolio file. It must still match the backup.

Every row must pass in both runs. A failing row listed as a trigger in step 11 runs Rollback. Any other failing row stops the run with the new container and the proxy rule in place.

## 11. Rollback

Triggers, after step 9: a non-zero `up`, the healthcheck (`unhealthy`, or not `healthy` within three minutes), or a failing `/`, `/feed.xml`, `/api/health`, or identity row in either step 10 run.

Run these one at a time:

```sh
cp -p "${EDIT_BACKUP:?}" "${EDIT_FILE:?}"
kgn21_compose config --quiet
kgn21_compose up -d --no-build --no-deps "${SERVICE:?}"
docker inspect --format '{{.Image}}' "${CONTAINER:?}"
```

If `config --quiet` fails, stop and report; don't run `up`. The last command must print `PREV_IMAGE_ID`. If it doesn't, the old tag now points at another image. Stop and report, and give the owner the exact commands with the values filled in: `docker tag <PREV_IMAGE_ID> <PREV_IMAGE_REF>`, then `docker compose -p <PROJECT> --project-directory <PROJECT_DIR> -f <each config file> up -d --no-build --no-deps <SERVICE>`.

Wait for health as in step 9, then re-run the check through the proxy with the step 7 flags, save it as `check-rollback.txt`, and judge it like the step 7 run. Keep the proxy rule, unless the rule itself broke a public route.

## 12. Report

Write `$BACKUP/posture.md` in the format below, then print the public summary. If you stop before step 2 creates `BACKUP`, put the report in your final message instead. Mark anything you couldn't do as open. Don't post anything anywhere; the owner posts the summary.

## Report format

`posture.md`:

```markdown
# Interim containment posture

- Date (UTC):
- Prompt: <PROMPT_SOURCE>; matches the release copy at <CLONE_COMMIT> apart from TARGET_IMAGE: yes | no
- Result: complete | incomplete, stopped at step <n> (<failing probe or reason>) | rolled back at step <n>
- Writes: <say here first if a PUT row or GET /api/portfolio showed a 2xx in step 4>

## Inventory (no secret values; paths and names are fine)
- Project, service, container:
- Compose config files in order, working directory, the file edited:
- Image before: reference, image ID, revision label:
- Builds from a checkout: no | yes, HEAD <commit>, <n> modified tracked paths, <n> untracked paths (list them)
- Image auto-updaters:
- Proxy: product, config file, reload method, access log sources:
- Public origin (SITE), and ORIGIN from meta.url:
- Published ports, and whether the app port answers without the proxy (what you tested, from where):
- Mounts (destination, source, RW):
- portfolio.yml: host path, size, mtime, SHA-256, and whether the container reads the same hash:
- Existing backups:

## Prior exposure
The exposure counter's output for each log source, the earliest date each covers, and a note that entries from this run's start on aren't counted.

## Backup
- Directory:
- Files and SHA-256:
- Portfolio copy hash matches the live file: yes | no

## Check runs
For each of before, proxy, direct, public, and rollback (if run): the command, the exit code, and the full output.

## Image
- TARGET_IMAGE:
- Pulled or built; image ID; revision label; matches the clone commit:

## Compose diff
The compose-diff output.

## Proxy rule
The exact rule, where it went, and the validator output.

## Rollback commands
The exact commands that put back the previous Compose file and container, and the previous proxy config.

## Open items
- App port reachable without the proxy:
- Image auto-updaters:
- The Compose file keeps a build: key (if it does): never run docker compose build or up --build for this project.
- meta.url (if ORIGIN is empty or differs from SITE):
- Single-file portfolio mount: rename-based saves (sed -i, some editors) need a container restart to show.
- Anything else that didn't match this prompt:
```

Public summary, printed at the end. The GHCR image reference and the public origin are fine to print. Name no other host, internal address, port, or path:

```markdown
Interim containment applied on <YYYY-MM-DD> (UTC).

- Tag: v0.1.1
- Image: <TARGET_IMAGE>
- Outside-network check, run from <where, for example "a phone hotspot">:

<the full output of check-public.txt, in a code block>
```

If the outside-network run is still pending, say so in the summary and leave the output for the owner to add.

## Editing the portfolio until #18

Until #18 (homelab migration) moves the live site onto #8 (Owner Studio), the owner edits the portfolio file on the host. End your final message with this note for him, with the values filled in:

> To change the site, edit `<PORTFOLIO_FILE>` on the host, in place, for example `cat new.yml > <PORTFOLIO_FILE>`. The container has a single-file mount, so a tool that saves by renaming (`sed -i`, some editors) leaves it on the old copy. If a change doesn't show, run `docker compose -p <PROJECT> --project-directory <PROJECT_DIR> -f <each config file> restart <SERVICE>`. Never run `docker compose build` or `up --build` for this project while the Compose file still has a `build:` key: it points at the old checkout. Validate the file first in a full checkout (`pnpm install`, then `node skills/portfolio-author/scripts/validate.mjs <file>`); a file that fails validation turns `/` into an error page and `/feed.xml` into a 500 until you fix it.

<!-- prompt:end -->
