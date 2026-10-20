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

Your shell keeps no variables between commands. It may be zsh, which doesn't split an unquoted variable into words. It may also have aliases or shell functions in place of standard tools, such as `mkdir` as `mkdir -pv` (which defeats the backup directory's collision guard), `cp` as `cp -v`, or `grep`, `diff`, and `find` as functions, and those change what a step prints or whether a guard works. So:

- Run every external tool through `command`, as the commands below do: `command cp`, `command grep`, `command docker`, and so on. `command` skips aliases and shell functions. Don't put it in front of the `kgn21_` helpers, which are shell functions on purpose.
- Step 2 creates `$BACKUP/vars.sh` and prints its path. Start every later command with `. <that path>;`, typing the literal path. Append each value you record with `printf "%s='%s'\n" NAME "value" >> "${BACKUP:?}/vars.sh"`. None of these values is a secret. If one you'd append this way contains a single quote, stop and ask the owner.
- Use `${VAR:?}` in every command that writes, copies, restores, validates, or reloads, so a missing variable stops the command instead of acting somewhere else.

`vars.sh` also defines the helpers. Step 2 adds these four, step 3 adds `kgn21_compose`, and step 9 adds `kgn21_compose_new`:

- `kgn21_check <url> [--expect-name <name>] [--expect-origin <origin>] [--direct] [--no-put]` runs the release's check script. It probes a running site, prints one line per probe (method, path, expected, actual, `PASS` or `FAIL`) and then a count, and exits 0 when every probe passes, 1 when any fails, and 2 on bad arguments. It never prints response bodies, header values, or error text. `--direct` means the URL reaches the app with no proxy in front, so a denial must be the app's own 404. `--no-put` skips the three PUT probes. Its PUT bodies (`{` and `{}`) fail validation on every build this prompt can meet, so they can't change the portfolio file. The commands below pass `--expect-origin "$ORIGIN"`; leave that flag out when `ORIGIN` is empty (step 5).
- `kgn21_tools <command>` runs the release's containment tools. Each reads stdin and prints only what a step needs: `compose-facts`, `compose-locate`, `compose-edit`, `compose-diff`, `config-check`, `validate-check`, `proxy-lines`, `proxy-insert`, `ports-same`, `facts`, and `exposure`.
- `kgn21_config_check <compose command>` runs `<compose command> config --quiet`, keeps its output in `$BACKUP/config-check.txt`, and prints only the exit status, the number of lines it wrote, and the kind of its first line. It fails unless Compose exited 0 and printed nothing. Never print `config-check.txt`: Compose warnings and errors can quote values.
- `kgn21_backup <file> <name>` copies a file into `$BACKUP` under that name with `cp -p`, refuses to overwrite a file already there, and prints the copy's SHA-256.

Every check run uses the same pattern, with `<step>` one of `before`, `proxy`, `direct`, `public`, or `rollback`, plus `-2`, `-3`, and so on for a second or third site address:

```sh
kgn21_check <url> <flags> > "${BACKUP:?}/check-<step>.txt" 2>&1; echo "exit $?" >> "${BACKUP:?}/check-<step>.txt"; command cat "${BACKUP:?}/check-<step>.txt"
```

The rows are:

- Denial rows: `GET /admin`, `GET /variants`, `GET /preview/editorial`, `GET /api/portfolio`, the three `PUT` rows, and `GET /_next/image?...`.
- The five 200 rows: `GET /`, `GET /feed.xml`, `GET /api/health`, `GET /robots.txt`, `GET /sitemap.xml`.
- The sitemap-body row (`BODY /sitemap.xml`), the origin rows (`ORIGIN /robots.txt` and `ORIGIN /sitemap.xml`, only with `--expect-origin`), the identity row (`BODY /`, only with `--expect-name`), and the header row (`HEADER`).

## 1. Rules

- Change exactly three existing things: the proxy config (one added rule per site block), the portfolio mount mode, and the image reference in the Compose file. The only new things you create are the clone directory; the backup directory and the files this prompt puts in it (`vars.sh`, copies, `.new` files, the rule file, prompt copies, `config-check.txt`, `validate-proxy.txt`, check outputs, `posture.md`); the target image (pulled, or built in step 8); `node:22-alpine` when the host has no Node 22 or step 10 needs it; and throwaway `docker run --rm` containers for the helpers and the proxy config check.
- In the deployment directory, don't delete, move, check out, reset, stash, or clean anything. It still holds legacy trees. Don't remove containers, images, volumes, or networks, and don't prune. The one exception is the app container: step 9 recreates it, and step 11 recreates it again if you roll back.
- Run Compose for this project only through `kgn21_compose` (and `kgn21_compose_new` in step 9), and only in these forms:
  - `kgn21_config_check kgn21_compose`, to validate.
  - `kgn21_compose config --hash "${SERVICE:?}" 2>/dev/null`, which prints the service's config hash.
  - The facts pipeline, exactly as written: `kgn21_compose config --format json --no-env-resolution 2>/dev/null | kgn21_tools compose-facts`, with the options a step gives. Never run `config` in any other form: its output holds every environment value.
  - `kgn21_compose up -d --no-build --no-deps "${SERVICE:?}"`.

  `command docker compose version` and `command docker compose ls --all --filter name="${PROJECT:?}"` are fine. The Compose file may keep a `build:` key that points at the legacy checkout, so never run `build`, `up --build`, `pull`, `down`, `restart`, or a plain `up`.
- Never print a plaintext password, password hash, cookie, private key, API token, any env file content, or unrelated host data. In practice:
  - Never open an env file with `cat`, `grep`, `head`, `diff`, `source`, or an editor. Copy it with `kgn21_backup`.
  - Never print a Compose file. Read Compose facts with the facts pipeline and file positions with `kgn21_tools compose-locate`, which prints line numbers only. Change Compose files only with the commands in steps 9 and 11.
  - Read proxy configs only with `kgn21_tools proxy-lines caddy|nginx`, which prints an allowlist and numbers every line: site addresses, `reverse_proxy` or `proxy_pass`, `handle`, `route`, and `location` lines, path matchers, and log outputs. Change them only with the commands in step 7.
  - Never print `config-check.txt` or `validate-proxy.txt`. Read them only through `kgn21_config_check` and `kgn21_tools validate-check`.
  - Read container and image facts only with `docker inspect --format` and `docker image inspect --format`, one template per command, from this list: `{{.Config.Image}}`, `{{.Image}}`, `{{.Id}}`, `{{json .RepoDigests}}`, `{{json .Mounts}}`, `{{json .HostConfig.PortBindings}}`, `{{json .Config.ExposedPorts}}`, `{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}`, `{{with .State.Health}}{{range .Log}}{{.ExitCode}} {{end}}{{end}}` (the exit codes of the last health probes, never their output), `{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}`, `{{.Path}} {{json .Args}}` on a Caddy or nginx proxy container only, and one label at a time as `{{with .Config.Labels}}{{index . "<label>"}}{{end}}` for `org.opencontainers.image.revision`, `com.docker.compose.project`, `com.docker.compose.service`, `com.docker.compose.project.config_files`, `com.docker.compose.project.working_dir`, `com.docker.compose.project.environment_file`, and `com.docker.compose.config-hash`. Never run a bare `inspect`, which prints `Config.Env`, and never print all labels, which can hold proxy password hashes. If a template errors, record that; don't reach for a broader one.
  - Never print a raw access log line. Count with `kgn21_tools exposure`.
  - `docker ps` lists every container on the host; put only the app's and the proxy's rows in the report.
  - `command ls -lA` of the project directory and of the portfolio file's directory is fine (names, sizes, and mtimes). Never print file contents from those directories.
  - Inside containers, run only `sha256sum /data/portfolio.yml` in the app container, and the `grep -c`, validate, and reload commands from step 7 in the proxy.
- Send the site no requests other than check runs, the LAN check in step 3, and the health waits in steps 9 and 11.
- Stop at the first failure and write an honest incomplete report (step 12) that names the step and the failing probe. After step 9 changes the Compose file, a failure that matches a Rollback trigger (step 11) runs Rollback first and then stops. Any other failure after step 9 stops with the new container running and the proxy rule in place.
- Don't fix, upgrade, or tidy anything this prompt doesn't list. If the host doesn't look like a step expects, stop and report what you found.
- Use `sudo` only when a listed read or change needs it. Some reads, such as another user's crontab, `/etc/cron*`, and `/var/spool/cron`, may need root. When a read is refused, record "not checked", not "none".

## 2. Setup

Run this block as one command. It creates the backup directory, clones the release next to it, and starts `vars.sh`. Both directories get a timestamp, so a second run never collides with the first, and `mkdir` without `-p` fails rather than reuse a directory.

```sh
RUN=$(command date -u +%Y%m%dT%H%M%SZ); BACKUP="${HOME:?}/kgn-21-backup-$RUN"; CLONE="${HOME:?}/kgn-21-v0.1.1-$RUN"
command mkdir -m 0700 "$BACKUP" &&
  command git clone --depth 1 --branch v0.1.1 https://github.com/keyurgolani/keyurgolani.name "$CLONE" &&
  printf "%s='%s'\n" RUN "$RUN" START "$(command date -u +%s)" BACKUP "$BACKUP" CLONE "$CLONE" CLONE_COMMIT "$(command git -C "$CLONE" rev-parse HEAD)" > "$BACKUP/vars.sh" &&
  echo "$BACKUP/vars.sh"
```

`START` is this run's start time; step 4 leaves out every log entry from then on. Append `TARGET_IMAGE` with the value from the Input.

Then add the check and tools helpers. If `command node --version` prints `v22` or later:

```sh
command cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_check() { command node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "$@"; }
kgn21_tools() { command node "${CLONE:?}/apps/web/scripts/containment-tools.mjs" "$@"; }
EOF
```

Otherwise run them on Node in a container, which pulls `node:22-alpine`:

```sh
command cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_check() { command docker run --rm -i --network host -v "${CLONE:?}:${CLONE:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "$@"; }
kgn21_tools() { command docker run --rm -i --network none -v "${CLONE:?}:${CLONE:?}:ro" -v "${BACKUP:?}:${BACKUP:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/containment-tools.mjs" "$@"; }
EOF
```

Then add the config check and backup helpers:

```sh
command cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_config_check() { "$@" config --quiet > "${BACKUP:?}/config-check.txt" 2>&1; kgn21_tools config-check --exit "$?" < "${BACKUP:?}/config-check.txt"; }
kgn21_backup() { if [ -e "${BACKUP:?}/${2:?}" ]; then echo "${2} is already in the backup directory, so it was not copied"; return 1; fi; command cp -p "${1:?}" "${BACKUP:?}/${2}" && command sha256sum "${BACKUP:?}/${2}"; }
EOF
```

Check the shell for variables that would change what Compose does. This prints names only:

```sh
command env | command cut -d= -f1 | command grep -E '^(PORT|COMPOSE_[A-Z0-9_]*)$'
```

It must print nothing. If it prints a name, stop and ask the owner.

Compare the prompt you were given with the release's copy, ignoring the `TARGET_IMAGE` line. Use the path the owner gave you as `<prompt file>`. If you only have the text, write it exactly as given to `${BACKUP:?}/prompt-given.md` and use that.

```sh
command sed -n '/^<!-- prompt:start -->$/,/^<!-- prompt:end -->$/p' "${CLONE:?}/docs/operations/interim-containment.md" | command grep -v -e '^<!-- prompt:' -e '^TARGET_IMAGE=' | command sed 's/[[:space:]]*$//' > "${BACKUP:?}/prompt-release.txt"
command grep -v -e '^<!-- prompt:' -e '^TARGET_IMAGE=' "<prompt file>" | command sed 's/[[:space:]]*$//' > "${BACKUP:?}/prompt-given.txt"
command diff -q -B "${BACKUP:?}/prompt-release.txt" "${BACKUP:?}/prompt-given.txt"
```

Append `PROMPT_SOURCE` (the path, or `pasted`) and `PROMPT_MATCH` (`yes` or `no`). If they differ, carry on with the prompt you were given and say so in the report.

## 3. Read-only inventory

Note these down for the report, and append the named values to `vars.sh`.

1. The container that serves the site: `command docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`. In the repository's own Compose file the service is `web`, the container is `portfolio`, and the image is `portfolio:latest`. This host may differ. Append `CONTAINER`.
2. Whether Docker Compose runs it: `command docker compose version` reports v2 or later (v5 is fine). Read the container's Compose labels, one per command, with the label template from the rules, and append them: `com.docker.compose.project` as `PROJECT`, `com.docker.compose.service` as `SERVICE`, `com.docker.compose.project.working_dir` as `PROJECT_DIR`, `com.docker.compose.project.config_files` as `COMPOSE_FILES` (comma-separated, in order), `com.docker.compose.project.environment_file` as `ENV_FILES` (comma-separated, often empty), and `com.docker.compose.config-hash` as `CONFIG_HASH`. `command docker compose ls --all --filter name="${PROJECT:?}"` must list the project with the same config files. Then define the Compose helper, as described after this list.

   If Compose doesn't run the service, or a UI such as Portainer manages the stack, note that and skip the Compose parts: the helper, items 4 and 5 below, and the Compose and env files in step 5. Go on through step 7, then stop at step 8 with an incomplete report; changing the image and the mount needs the owner.
3. The current image: `command docker inspect --format '{{.Config.Image}}' "$CONTAINER"` (append `PREV_IMAGE_REF`) and `command docker inspect --format '{{.Image}}' "$CONTAINER"` (append `PREV_IMAGE_ID`). For `PREV_IMAGE_ID`, read `{{json .RepoDigests}}` and the `org.opencontainers.image.revision` label with `command docker image inspect`.
4. The Compose facts and files. Run the facts pipeline for the service:

   ```sh
   kgn21_compose config --format json --no-env-resolution 2>/dev/null | kgn21_tools compose-facts --service "${SERVICE:?}"
   ```

   Note the image, the build context, the `env_file` paths, the ports, the volumes, and the networks. Then run `kgn21_tools compose-locate --service "${SERVICE:?}" < <file>` for each config file. Append the one file that says `edit here: yes` as `EDIT_FILE`. If no file or more than one says so, stop and ask the owner. Then run `kgn21_compose config --hash "${SERVICE:?}" 2>/dev/null` and record whether its hash equals `CONFIG_HASH`; step 9 depends on it.
5. If `PROJECT_DIR` is a git checkout, run only `command git -C "$PROJECT_DIR" rev-parse HEAD` and `command git --no-optional-locks -C "$PROJECT_DIR" status --porcelain` there. Record the revision and the changed paths, with modified tracked files apart from untracked ones. Never print file contents from that tree.
6. Image auto-updaters, by name and count only:
   - `command docker ps --format '{{.Names}}\t{{.Image}}' | command grep -iE 'watchtower|diun|ouroboros|shepherd'`
   - `command crontab -l | command grep -cE 'docker (compose )?pull|watchtower'`
   - `command grep -rlE 'docker (compose )?pull|watchtower' /etc/cron* /var/spool/cron`, which prints file names, and a "Permission denied" line for anything it couldn't read
   - `command systemctl list-timers --all --no-pager | command grep -iE "docker|compose|watchtower|diun|pull|${PROJECT:?}"`

   Don't change anything you find. Record "not checked" for any of these you couldn't read.
7. The reverse proxy: the product, whether it runs in a container or as a host service, how it reloads, and where its access logs go. For a Caddy or nginx container, `command docker inspect --format '{{.Path}} {{json .Args}}' <proxy container>` shows the main config file it loads; its `{{json .Mounts}}` shows where that file and any file it imports live on the host. Read the file that holds the app's site blocks with `kgn21_tools proxy-lines caddy < <file>` (or `nginx`), and list every site block that proxies to the app. Leave out blocks that only redirect. Append:
   - `PROXY_KIND`: `caddy` or `nginx`.
   - `PROXY_CONTAINER`: the container's name, empty for a host service.
   - `PROXY_CONFIG`: the host path of the file with the app's site blocks.
   - `PROXY_CONFIG_IN`: that file's path inside the container.
   - `PROXY_MAIN_IN`: the main config file inside the container, the same as `PROXY_CONFIG_IN` unless the main file imports or includes the other one.
   - `PROXY_IMAGE`: the proxy container's `{{.Config.Image}}`.
   - `PROXY_NETWORK`: a network the proxy container shares with the app container. Compare the two containers' `.NetworkSettings.Networks`.
   - `PROXY_SITE_LINES`: the line number of each app site block's opening line, space-separated. That is the site address line for Caddy and the `server {` line for nginx.

   For a host service, use the host paths for the `_IN` values. If the proxy is managed through a UI or a hosted service such as a tunnel, or is configured through labels on the app container, or the app's site blocks are in more than one file, note that; step 7 handles it.
8. The public origins: the site addresses of those blocks, for example `https://<host>`. Take them from the config; never guess. Append `SITE` (the address that answers with the site; the first one if several do) and, if other addresses serve the app too, `OTHER_SITES` (space-separated). Steps 7 and 10 check each of them.
9. Published ports: `command docker inspect --format '{{json .HostConfig.PortBindings}}' "$CONTAINER"`. Append the whole value as `PREV_PORTS` and the host port as `APP_PORT`. An empty `HostIp` or `0.0.0.0` means every interface. If the port is published beyond loopback, check whether the app answers without the proxy, from this host and from another machine if you have one:

   ```sh
   command curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://<this host's LAN address>:<port>/api/health"
   ```

   Use the first address `command hostname -I` prints. Docker-published ports usually bypass host firewalls such as `ufw`, so a firewall rule alone doesn't prove the port is closed. Append `APP_PORT_OPEN`: `yes` if it printed 200, `no` if it didn't answer, or `untested`. Record exactly what you tested.
10. Every mount, with its mode: `command docker inspect --format '{{json .Mounts}}' "$CONTAINER"`.
11. The portfolio file: the host path of the mount whose destination is `/data/portfolio.yml` (append `PORTFOLIO_FILE`), its size and mtime (`command stat`), and its SHA-256 (`command sha256sum`; append `PORTFOLIO_SHA`). Don't print its content. Compare with what the container reads: `command docker exec "$CONTAINER" sha256sum /data/portfolio.yml`. A different hash means the container serves an older copy, which a rename-based save on the host causes; record it.
12. Existing backups of the portfolio file or the deployment, such as `portfolio.yml.bak*`, from `command ls -lA`. Note them and leave them alone.

The Compose helper from item 2 passes the project name, the working directory, one `--env-file` per entry of `ENV_FILES` (none when it's empty, so Compose reads `.env` in the working directory as it did when it started the stack), and one `-f` per entry of `COMPOSE_FILES`, in order:

```sh
command cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_compose() { command docker compose -p '<project>' --project-directory '<working dir>' --env-file '<env file>' -f '<first file>' -f '<next file>' "$@"; }
EOF
```

If a value contains a single quote, stop and ask the owner. Then run `kgn21_config_check kgn21_compose`. It must report exit 0 and 0 lines. If it doesn't, stop: Compose can't read the files the stack runs from, or it warns about them.

## 4. Prior exposure

Feed whatever proxy access logs exist to the exposure counter, one source at a time, for example:

```sh
command zcat -f <access log files> | kgn21_tools exposure --before "${START:?}"
command docker logs <proxy container> 2>&1 | kgn21_tools exposure --before "${START:?}"
command journalctl -u <proxy unit> --no-pager -o cat | kgn21_tools exposure --before "${START:?}"
```

It counts every method on `/admin` (and paths under it), `/variants`, `/api/portfolio`, `/api/variant`, and `/api/customize` per day, with case, percent-encoding, repeated slashes, and dot segments normalized, and splits each count into 2xx, 3xx, 4xx, and 5xx responses. It leaves out entries at or after `START`, which are this run's own requests, and says how many of the counted requests came from an earlier run of the check script. It never prints a raw line, an address, or a user agent. When it prints `counts incomplete`, some lines couldn't be read, so the counts for that source are a lower bound; say so next to it.

Put its output in the report with each source and the earliest date it covers. For a file, that's the first day the counter reports. For `docker logs`, it's `command docker logs --timestamps <proxy container> 2>&1 | command head -n 1 | command cut -d' ' -f1`. Say that entries from this run's start on aren't counted. If a `PUT` row shows a 2xx, or a `GET` row on `/api/portfolio` or `/admin` does (both serve the raw file), say so at the top of the report.

Don't judge the portfolio file's content. Report its mtime from step 3; the owner compares the content with what he expects.

## 5. Backup

Copy the files into `$BACKUP`, one `kgn21_backup` per file:

```sh
kgn21_backup "${PORTFOLIO_FILE:?}" portfolio.yml
kgn21_backup "${PROXY_CONFIG:?}" <the proxy config's file name>
kgn21_backup <each Compose config file> <its file name>
kgn21_backup <each env file> <its file name>
```

The env files are the `env_file` paths from the facts, the files in `ENV_FILES`, and `.env` in `PROJECT_DIR` if `command ls -lA "${PROJECT_DIR:?}"` shows one. If two files share a name, give the second a numbered name and note it. Append `EDIT_BACKUP` and `PROXY_BACKUP`, the paths of the copies of `EDIT_FILE` and `PROXY_CONFIG`, and `EDIT_BACKUP_SHA` and `PROXY_BACKUP_SHA`, their hashes. The `portfolio.yml` copy must hash to `PORTFOLIO_SHA`.

Read the name, origin, and variant from the copy:

```sh
kgn21_tools facts < "${BACKUP:?}/portfolio.yml" >> "${BACKUP:?}/vars.sh"
```

That appends `NAME` (`identity.name`), `ORIGIN` (the scheme, host, and port of `meta.url`), and `VARIANT`, already quoted for the shell. If it exits 1, stop with its message. If `ORIGIN` comes back empty, `meta.url` isn't set: leave `--expect-origin` out of every check and list it as an open item. If `ORIGIN` isn't `SITE` or one of `OTHER_SITES`, note that robots and the sitemap advertise a different origin than the proxy serves.

Check that the release has the live file's variant:

```sh
test -d "${CLONE:?}/packages/variant-${VARIANT:?}" && echo present
```

If it doesn't print `present`, stop and report it.

## 6. Before snapshot

First choose `PUTFLAG`, which this step and step 7 both use. It is `--no-put` unless the inventory shows the running build comes from a clean `62a0f06` tree, or from a pulled image whose `org.opencontainers.image.revision` label is `62a0f06cf88c5d6c55045945bf0733a6882c5425`; then it is empty. A clean `62a0f06` tree means `git rev-parse HEAD` prints that commit and `git --no-optional-locks status --porcelain` lists nothing under `apps/` or `packages/` and no `Dockerfile`, `package.json`, or `pnpm-lock.yaml`. Untracked legacy directories, `portfolio.yml`, `*.bak*` files, env files, and Compose edits don't count. Append `PUTFLAG`.

```sh
kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN" $PUTFLAG
```

Save it as `check-before.txt`. Failures are expected here.

When this host can reach its own public origin, this run, the step 7 runs, and the step 10 public runs all go to the same URL, so a public run from this host shows no more than the step 7 run did. Only a run from another network shows what visitors get. If every row in this run is a connection failure (`connection refused`, `no answer in 10s`, `name lookup failed`, and so on), this host can't reach its own origin. Record that, give the owner the exact step 6, 7, and 10.3 commands with the values filled in, ask him to run them from another machine, and judge those steps by the output he sends back.

If the identity row fails, the live site doesn't show the expected name before anything changed. Do step 7, then stop before step 8 and report the cause. Two read-only checks narrow it down. Run `command docker exec "$CONTAINER" sha256sum /data/portfolio.yml`; a hash that differs from `PORTFOLIO_SHA` means the container serves an older copy. Run `kgn21_check "$SITE" --expect-name "Anamika Devi" --no-put`; if that identity row passes, the site serves the bundled sample persona, so the mount path or the file is wrong.

Re-hash the portfolio file. If it differs from the backup, stop with an incomplete report.

## 7. Proxy stopgap

Deny, with 404 or 403, the path prefixes `/admin`, `/variants`, `/preview/`, `/api/`, and `/_next/image`, with an exact-match allow for `/api/health` that wins over the denial, in every site block that proxies to the app. The `/variants` prefix also covers the static files under `apps/web/public/variants/`, which no page renders.

If the proxy is managed through a UI or a hosted service, or the app's site blocks are in more than one file, print the exact rule, ask the owner to apply it to every block, wait, and go on to the re-runs at the end of this step. If the rule would have to live in labels on the app container (Traefik's Docker provider, for example), applying it means recreating the app container before step 9, so stop and ask the owner.

First check whether an earlier run already added the rule:

```sh
command grep -c 'kgn-21 containment' "${PROXY_CONFIG:?}"
```

If it prints 1 or more, don't add the rule again. Note it and go straight to the re-runs.

Otherwise write the rule to `${BACKUP:?}/kgn21-rule.txt` with a quoted heredoc (`command cat > "${BACKUP:?}/kgn21-rule.txt" <<'EOF'`), indented to match the site blocks. For Caddy:

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

Build the new config in `$BACKUP` with the rule first in each of the app's site blocks, with one `--after` per number in `PROXY_SITE_LINES`:

```sh
kgn21_tools proxy-insert --rule "${BACKUP:?}/kgn21-rule.txt" --after <line> --after <line> < "${PROXY_CONFIG:?}" > "${BACKUP:?}/<config name>.new"
kgn21_tools proxy-lines "${PROXY_KIND:?}" < "${BACKUP:?}/<config name>.new"
```

The rule must show right after each site block's opening line. Check the `.new` file with the proxy's own validator before it goes live. Each validator writes to `validate-proxy.txt`, and `validate-check` prints only the exit status and the file and line of each error:

- Caddy in a container, with the site blocks in the main file:

  ```sh
  command docker exec -i "${PROXY_CONTAINER:?}" caddy validate --adapter caddyfile --config /dev/stdin < "${BACKUP:?}/<config name>.new" > "${BACKUP:?}/validate-proxy.txt" 2>&1; kgn21_tools validate-check --exit "$?" < "${BACKUP:?}/validate-proxy.txt"
  ```

- nginx in a container, or Caddy with the site blocks in an imported file: run the validator in a throwaway container from the proxy's image, on the proxy's network so upstream names resolve, with every mount of the proxy container read-only and the `.new` file over the file it replaces. Use the same output handling:

  ```sh
  command docker run --rm --network "${PROXY_NETWORK:?}" -v <host path>:<container path>:ro ... -v "${BACKUP:?}/<config name>.new":"${PROXY_CONFIG_IN:?}":ro "${PROXY_IMAGE:?}" nginx -t > "${BACKUP:?}/validate-proxy.txt" 2>&1; kgn21_tools validate-check --exit "$?" < "${BACKUP:?}/validate-proxy.txt"
  ```

  For Caddy, end the `docker run` with `caddy validate --adapter caddyfile --config "${PROXY_MAIN_IN:?}"` instead of `nginx -t`.
- A host service: the validator reads the live files. Copy the `.new` file into place as below, run `command nginx -t` or `command caddy validate --adapter caddyfile --config "${PROXY_MAIN_IN:?}"` with the same output handling, and if it fails, copy `PROXY_BACKUP` back with `command cp -p` before anything else. Nothing reloads in between, so the running config doesn't change.

If an error is inside the rule's lines (the `proxy-lines` output of the `.new` file numbers them), fix the rule file and rebuild the `.new` file. If an error is elsewhere or has no location (a missing certificate, an import, an upstream that doesn't resolve), stop and ask the owner.

Copy it into place with `command cp`, never `cat >`, `sed -i`, or an editor. GNU `cp` writes into the existing file and keeps its inode, so a single-file bind mount sees the change. BusyBox `cp` (Alpine and some NAS systems) replaces the file instead, so a single-file mount keeps the old copy, and the next check catches that. Then check that the proxy sees the rule (for a host service, run `command grep -c` on the file itself):

```sh
command cp "${BACKUP:?}/<config name>.new" "${PROXY_CONFIG:?}"
command docker exec "${PROXY_CONTAINER:?}" grep -c 'kgn-21 containment' "${PROXY_CONFIG_IN:?}"
```

The count must equal the number of site blocks. If it's lower, the proxy doesn't see the new file. Restore it (below) and stop, and tell the owner whether this host's `cp` is BusyBox (`command cp --version` fails or doesn't say GNU).

Reload rather than restart: `command docker exec "${PROXY_CONTAINER:?}" caddy reload --config "${PROXY_MAIN_IN:?}" --adapter caddyfile`, `command docker exec "${PROXY_CONTAINER:?}" nginx -s reload`, or `command systemctl reload <unit>` for a host service. If the proxy can't reload without a restart, restore, stop, and ask the owner.

Re-run the check through the proxy with the step 6 flags, `$PUTFLAG` included, and save it as `check-proxy.txt`. Run it again for each address in `OTHER_SITES`, saved as `check-proxy-2.txt`, `check-proxy-3.txt`, and so on.

```sh
kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN" $PUTFLAG
```

Judge each run by rows, not by the exit code. The sitemap-body row and the origin rows may still fail until step 9, so exit 1 is expected here. The denial rows, the header row, and the five 200 rows must pass in every run, and the identity row must pass if it passed in step 6.

- If a denial row fails, the rule isn't matching, probably because an earlier part of the config handles those paths. Don't restructure the existing config. Restore and stop.
- If a 200 row or the identity row fails, restore and stop.

To restore, first check that `command sha256sum "${PROXY_BACKUP:?}"` still prints `PROXY_BACKUP_SHA`; if it doesn't, stop and report without restoring. Then run `command cp -p "${PROXY_BACKUP:?}" "${PROXY_CONFIG:?}"`, check it with the proxy's validator the same way, and reload.

## 8. Image

Pull the target image and confirm it was built from the clone's commit:

```sh
command docker pull "${TARGET_IMAGE:?}"
command docker image inspect --format '{{with .Config.Labels}}{{index . "org.opencontainers.image.revision"}}{{end}}' "${TARGET_IMAGE:?}"
```

The label must equal `CLONE_COMMIT`. Stop if it doesn't. When the pull works, append `IMAGE` with the `TARGET_IMAGE` value.

If the pull fails, build the clone instead, append `IMAGE='keyurgolani-name:0.1.1'`, and record the image ID for the report. Never build from the deployment checkout.

```sh
command docker build -t keyurgolani-name:0.1.1 "${CLONE:?}"
command docker image inspect --format '{{.Id}}' keyurgolani-name:0.1.1
```

## 9. Compose

First check that the Compose files still describe the running container. `kgn21_compose config --hash "${SERVICE:?}" 2>/dev/null` must print the service name and `CONFIG_HASH`. If the hash differs, a Compose or env file changed after the container was created, and recreating it would apply that change too. Stop with the proxy rule in place and report it.

Write the edited Compose file into `$BACKUP` and check that only the image and the portfolio mount changed:

```sh
kgn21_tools compose-edit --service "${SERVICE:?}" --image "${IMAGE:?}" < "${EDIT_FILE:?}" > "${BACKUP:?}/<compose name>.new"
command diff -U0 "${EDIT_FILE:?}" "${BACKUP:?}/<compose name>.new" | kgn21_tools compose-diff
```

`compose-edit` sets the service's `image:` (adding it if missing), makes the `/data/portfolio.yml` mount read-only, and names the lines it changed. It stops with a message when the service carries a YAML anchor, merges settings with `<<`, uses `extends`, or lists its volumes inline or through an anchor; stop and ask the owner then. `compose-diff` shows only the changed image and mount lines, drops trailing comments, and must exit 0.

Validate the new file before it goes live. Add a second Compose helper, the same as `kgn21_compose` but with the `.new` file in place of `EDIT_FILE`:

```sh
command cat >> "${BACKUP:?}/vars.sh" <<'EOF'
kgn21_compose_new() { command docker compose -p '<project>' --project-directory '<working dir>' --env-file '<env file>' -f '<first file>' -f '<the .new file in place of EDIT_FILE>' "$@"; }
EOF
```

Then both of these must pass:

```sh
kgn21_config_check kgn21_compose_new
kgn21_compose_new config --format json --no-env-resolution 2>/dev/null | kgn21_tools compose-facts --service "${SERVICE:?}" --expect-image "${IMAGE:?}" --expect-read-only /data/portfolio.yml
```

If either fails, stop; nothing has changed yet. Otherwise copy the file into place and validate the live set:

```sh
command cp "${BACKUP:?}/<compose name>.new" "${EDIT_FILE:?}"
kgn21_config_check kgn21_compose
```

If that fails, run `command cp -p "${EDIT_BACKUP:?}" "${EDIT_FILE:?}"` and stop. Otherwise recreate only the app service:

```sh
kgn21_compose up -d --no-build --no-deps "${SERVICE:?}"
```

A non-zero exit is a Rollback trigger: go to step 11. Otherwise wait for health. This polls every 5 seconds for up to 180 seconds and prints only the status:

```sh
i=0; while [ "$i" -lt 36 ]; do s=$(command docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER:?}"); echo "$s"; case "$s" in healthy|unhealthy|none) break ;; esac; i=$((i + 1)); command sleep 5; done
```

`healthy` means go on. The first `unhealthy`, or 180 seconds without `healthy`, is a Rollback trigger. Before you roll back, you may print the exit codes of the last health probes with the `.State.Health.Log` template from the rules; never print their output. `none` means the service has no healthcheck. Poll `command curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${APP_PORT:?}/api/health"` the same way instead, until it prints 200.

Then check that the published ports didn't change:

```sh
kgn21_tools ports-same "${PREV_PORTS:?}" "$(command docker inspect --format '{{json .HostConfig.PortBindings}}' "${CONTAINER:?}")"
```

`published ports changed` is a Rollback trigger.

## 10. Verify

1. `command docker inspect --format '{{.Config.Image}}' "$CONTAINER"` must print `IMAGE`, `command docker inspect --format '{{.Image}}' "$CONTAINER"` must equal `command docker image inspect --format '{{.Id}}' "$IMAGE"`, the portfolio mount in `{{json .Mounts}}` must show `"RW":false`, and `command docker exec "$CONTAINER" sha256sum /data/portfolio.yml` must print `PORTFOLIO_SHA`. Stop if any of them doesn't.
2. Check the app without the proxy, PUT probes included, and save it as `check-direct.txt`:

   ```sh
   kgn21_check "http://127.0.0.1:${APP_PORT:?}" --direct --expect-name "$NAME" --expect-origin "$ORIGIN"
   ```

   Use the binding's `HostIp` instead of `127.0.0.1` when it's a specific address. If the app port isn't published, read the container's networks with the `.NetworkSettings.Networks` template and its port with `{{json .Config.ExposedPorts}}`, then run the check on that network: `command docker run --rm --network <network> -v "${CLONE:?}:${CLONE:?}:ro" node:22-alpine node "${CLONE:?}/apps/web/scripts/check-containment.mjs" "http://${CONTAINER:?}:<port>" --direct --expect-name "$NAME" --expect-origin "$ORIGIN"`.
3. Check each public origin from a network outside the homelab, PUT probes included: `kgn21_check "$SITE" --expect-name "$NAME" --expect-origin "$ORIGIN"`, saved as `check-public.txt`, and the same for each address in `OTHER_SITES` as `check-public-2.txt` and so on. If you have no outside network, run them from this host anyway and label them "from the host, not outside". Record what each host name resolves to (`command getent hosts <host>` or `command dig +short <host>`), give the owner the exact commands with the values filled in, mark the outside check pending, and carry on to step 12.
4. Re-hash the live portfolio file. It must still match the backup.

Every row must pass in every run. A failing row listed as a trigger in step 11 runs Rollback. Any other failing row stops the run with the new container and the proxy rule in place.

## 11. Rollback

Triggers, after step 9: a non-zero `up`, the first `unhealthy` or 180 seconds without `healthy`, changed published ports, or a failing `/`, `/feed.xml`, `/api/health`, or identity row in any step 10 run.

First check that `command sha256sum "${EDIT_BACKUP:?}"` still prints `EDIT_BACKUP_SHA`. If it doesn't, stop and report without restoring. Then run these one at a time:

```sh
command cp -p "${EDIT_BACKUP:?}" "${EDIT_FILE:?}"
kgn21_config_check kgn21_compose
kgn21_compose up -d --no-build --no-deps "${SERVICE:?}"
command docker inspect --format '{{.Image}}' "${CONTAINER:?}"
```

If the config check fails, stop and report; don't run `up`. The last command must print `PREV_IMAGE_ID`. If it doesn't, the old tag now points at another image. Stop and report, and give the owner the exact commands with the values filled in: `docker tag <PREV_IMAGE_ID> <PREV_IMAGE_REF>`, then `docker compose -p <PROJECT> --project-directory <PROJECT_DIR> <one --env-file per ENV_FILES entry> -f <each config file> up -d --no-build --no-deps <SERVICE>`.

Wait for health with the step 9 loop, then re-run the check through the proxy with the step 7 flags for `SITE` and each address in `OTHER_SITES`, saved as `check-rollback.txt`, `check-rollback-2.txt`, and so on, and judge each like the step 7 runs. Keep the proxy rule, unless the rule itself broke a public route. The report says "rolled back at step 9" or "rolled back at step 10", whichever step's check failed.

## 12. Report

Write `$BACKUP/posture.md` in the format below, then print the public summary for the outcome. If you stop before step 2 creates `BACKUP`, put the report in your final message instead. Mark anything you couldn't do as open. Don't post anything anywhere; the owner posts the summary.

Urgent owner action: if `APP_PORT_OPEN` is `yes` and the container doesn't run `IMAGE` at the end (you rolled back, or stopped before step 9 changed it), the old build's whole authoring surface, the PUT routes included, still answers on the app port from the LAN, whatever the proxy denies. The first lines of `posture.md` and of your final message must say so and ask the owner to bind the port to `127.0.0.1` or firewall it. Don't describe the site as contained in that case.

## Report format

`posture.md`:

```markdown
# Interim containment posture

- URGENT, only when it applies: the app port <APP_PORT> answers from the LAN with the old build, so /admin, /api/portfolio, and the PUT routes are reachable there without the proxy. Bind the port to 127.0.0.1 or firewall it.
- Date (UTC):
- Prompt: <PROMPT_SOURCE>; matches the release copy at <CLONE_COMMIT> apart from TARGET_IMAGE: yes | no
- Result: complete | incomplete, stopped at step <n> (<failing probe or reason>) | rolled back at step <n> (<the check that failed>)
- Writes and file reads: <the PUT rows with a 2xx, and the GET /api/portfolio or /admin rows with a 2xx, from step 4; or "none in the counted logs">

## Inventory (no secret values; paths and names are fine)
- Project, service, container:
- Compose config files in order, working directory, env files, the file edited:
- Compose config hash matches the container: yes | no
- Image before: reference, image ID, revision label:
- Builds from a checkout: no | yes, HEAD <commit>, <n> modified tracked paths, <n> untracked paths (list them)
- Image auto-updaters (or "not checked" for each source you couldn't read):
- Proxy: product, config file, main config, reload method, access log sources:
- Site blocks that proxy to the app, and their addresses (SITE, OTHER_SITES), and ORIGIN from meta.url:
- Published ports, and whether the app port answers without the proxy (what you tested, from where):
- Mounts (destination, source, RW):
- portfolio.yml: host path, size, mtime, SHA-256, and whether the container reads the same hash:
- Existing backups:

## Prior exposure
The exposure counter's output for each log source, the earliest date each covers, whether its counts are complete, and a note that entries from this run's start on aren't counted.

## Backup
- Directory:
- Files and SHA-256:
- Portfolio copy hash matches the live file: yes | no

## Check runs
For each run (before, proxy, direct, public, rollback, and the -2, -3 runs): the command, the exit code, and the full output.

## Image
- TARGET_IMAGE:
- Pulled or built; image ID; revision label; matches the clone commit:

## Compose diff
The compose-diff output.

## Proxy rule
The exact rule, where it went, and the validate-check output.

## Rollback commands
The exact commands that put back the previous Compose file and container, and the previous proxy config.

## Open items
- App port reachable without the proxy:
- Image auto-updaters:
- The Compose file keeps a build: key (if it does): never run docker compose build or up --build for this project.
- meta.url (if ORIGIN is empty or isn't one of the site addresses):
- Single-file portfolio mount: rename-based saves (sed -i, some editors, BusyBox cp) need a container restart to show.
- Anything else that didn't match this prompt:
```

## Public summary

Print the summary for the outcome at the end. `TARGET_IMAGE` and the public origins are always fine to print. Name no other host, internal address, port, or path, and say nothing about the app port.

When the run is complete:

```markdown
Interim containment applied on <YYYY-MM-DD> (UTC).

- Tag: v0.1.1
- Image: <TARGET_IMAGE>
- Outside-network check, run from <where, for example "a phone hotspot">:

<the full output of check-public.txt, and of each check-public-<n>.txt, in code blocks>
```

If the outside-network run is still pending, say so in the summary and leave the output for the owner to add.

When the run rolled back or stopped:

```markdown
Interim containment partly applied on <YYYY-MM-DD> (UTC). The site isn't contained yet.

- Applied: <"the proxy rule for <public origins>", or "nothing">
- Not applied: <"the v0.1.1 image and the read-only mount", with the reason in a few words, for example "the new container never turned healthy, so it was rolled back">
- Image: <TARGET_IMAGE>, not running
- Outside-network check: not run
```

## Closing note for the owner

Until #18 (homelab migration) moves the live site onto #8 (Owner Studio), the owner edits the portfolio file on the host. End your final message with the note for the outcome, with the values filled in.

When the run is complete:

> To change the site, edit `<PORTFOLIO_FILE>` on the host in place, for example `cp new.yml <PORTFOLIO_FILE>`. GNU `cp` writes into the existing file. The container has a single-file mount, so a tool that saves by renaming (`sed -i`, some editors, BusyBox `cp`) leaves it on the old copy. If a change doesn't show, run `docker compose -p <PROJECT> --project-directory <PROJECT_DIR> <one --env-file per ENV_FILES entry> -f <each config file> restart <SERVICE>`. Never run `docker compose build` or `up --build` for this project while the Compose file still has a `build:` key: it points at the old checkout. Validate the file first in a full checkout (`pnpm install`, then `node skills/portfolio-author/scripts/validate.mjs <file>`); a file that fails validation turns `/` into an error page and `/feed.xml` into a 500 until you fix it.

When the run rolled back or stopped:

> The site isn't contained yet. <The proxy rule is in place for <public origins> | The proxy rule isn't in place>, but the container still runs the old build with `<PORTFOLIO_FILE>` mounted read-write, so the old authoring routes, the PUT routes included, still answer on any path or port the proxy doesn't cover<, including the app port <APP_PORT> from the LAN>. It stopped because <the reason>. Until a run completes, edit the file in place (`cp new.yml <PORTFOLIO_FILE>`, which GNU `cp` writes into), and expect anyone who reaches the old routes to be able to change it too.

<!-- prompt:end -->
