# Self-hosting

You don't need this repository's toolchain to run your own portfolio. The published image, `ghcr.io/keyurgolani/portfolio:1`, is the server, and [`selfhost/`](../selfhost/) holds everything else Docker Compose needs:

| File                   | What it is                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `compose.yml`          | The `read-only` profile: your site, with no editing surface and nothing to sign in to |
| `compose.owner.yml`    | The `owner` profile, with Studio. It never runs unless you choose it                  |
| `config/portfolio.yml` | Your portfolio: the bundled example, to make yours                                    |
| `config/site.yml`      | Its appearance and which sections show: the bundled example                           |
| `assets/`              | The files your portfolio's media sources name. It ships empty                         |
| `.env.example`         | The settings Compose reads, none of them secret                                       |

You need Docker Engine with the Compose plugin, a host with a domain name pointed at it, and a reverse proxy on that host for HTTPS.

## Quick start

Get `selfhost/`, from a clone or from the release's source archive:

```sh
git clone --depth 1 https://github.com/keyurgolani/keyurgolani.name.git
cd keyurgolani.name/selfhost
```

Make the portfolio yours. Edit `config/portfolio.yml` and `config/site.yml` ([Authoring](authoring.md), [Configuration](configuration.md)), and put the images your media sources name in `assets/`, such as `assets/work/cover.jpg` for `source: work/cover.jpg`. The server won't start while `identity.name`, `meta.title`, or the picture `meta.ogImage` places is still the example's ([Getting started](getting-started.md#1-create-configportfolioyml-and-configsiteyml)).

Tell it where visitors find the site:

```sh
cp .env.example .env
```

Set `PORTFOLIO_ORIGIN` in `.env` to the origin visitors use, such as `https://jane.name`. Then start it:

```sh
docker compose up -d
```

`docker compose ps` shows the container healthy once it's serving, and `curl -fsS http://127.0.0.1:3000/api/health` answers from the host. The server reads `config/` once, at startup: after an edit, run `docker compose restart`. It logs each problem it finds in your documents by its code; `docker compose logs web` shows them.

## What it serves

`read-only` serves your pages, the sitemap, `robots.txt`, the feed, the renditions of your media at `/media/...`, `/api/health`, and `/api/ready`. It has no Studio, no editing routes, and no sign-in: `/studio` and every `/api/studio/...` path answer 404, as any page the profile doesn't serve does. Nothing in the container is writable but Next.js's cache and the media cache, the server runs as an unprivileged user (uid 1001) with no capabilities, and it publishes on `127.0.0.1` only.

## Updating

```sh
docker compose pull
docker compose up -d
```

`:1` follows every 1.x release. To stay on one, set `PORTFOLIO_IMAGE` in `.env` to a release tag, such as `ghcr.io/keyurgolani/portfolio:1.0.0`, or to a digest, `ghcr.io/keyurgolani/portfolio@sha256:<digest>`. Each release is the image this repository's release workflow built and signed, copied here by its digest with no rebuild. To check one before you run it, with the GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/keyurgolani/portfolio:1.0.0 \
  --repo keyurgolani/keyurgolani.name \
  --signer-workflow keyurgolani/keyurgolani.name/.github/workflows/release.yml
```

[Verify an image](releasing.md#verify-an-image) shows how to read the provenance and SBOMs it carries.

## Reverse proxy and HTTPS

The server listens on `127.0.0.1:3000` (or the `PORT` you set) and nowhere else, so nothing reaches it from outside the host but your proxy. Keep it that way: leave the `ports:` entry's `127.0.0.1` in place, and open only 80 and 443 in the host's firewall. The proxy terminates TLS and passes requests on to the server. The app builds every absolute URL from `PORTFOLIO_ORIGIN`, so it never needs the `Host` or `X-Forwarded-*` headers for one.

With Caddy, which gets and renews the certificate itself, a `Caddyfile` for `jane.name`:

```
jane.name {
	reverse_proxy 127.0.0.1:3000
	header Strict-Transport-Security "max-age=31536000"
}

www.jane.name {
	redir https://jane.name{uri} permanent
}
```

With nginx, and a certificate from your ACME client, such as certbot, at its usual paths:

```nginx
server {
	listen 80;
	listen [::]:80;
	server_name jane.name www.jane.name;
	return 308 https://jane.name$request_uri;
}

server {
	listen 443 ssl;
	listen [::]:443 ssl;
	http2 on;
	server_name jane.name;

	ssl_certificate /etc/letsencrypt/live/jane.name/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/jane.name/privkey.pem;
	add_header Strict-Transport-Security "max-age=31536000" always;

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
```

Both answer the site's other names with a permanent redirect to the one origin. Add `includeSubDomains` to the HSTS header only when every subdomain serves HTTPS. A proxy in another container can't reach a port published on the host's `127.0.0.1`: put the proxy and the server on one Docker network, point the proxy at `web:3000`, and delete the `ports:` entry instead of widening it. [Deployment](deployment.md#reverse-proxy-and-https) has the rest.

## The owner profile

`compose.owner.yml` runs the `owner` profile: Studio at `/studio`, where you edit drafts and publish revisions, for one person, you, signed in with a password. It is never the default, and it starts only with the password's hash in place. The server never holds the password; it checks each sign-in against a scrypt hash in `secrets/owner_password_hash`, a file only the server's user can read.

1. Write the hash with the image itself. `hash-password` asks for the password twice, 15 to 256 characters, with echo off, and never takes it as an argument:

   ```sh
   mkdir -m 0700 secrets && sudo chown 1001:1001 secrets
   docker run --rm -it --user 1001:1001 -v "$PWD/secrets:/out" ghcr.io/keyurgolani/portfolio:1 \
     node apps/web/bin/owner.mjs hash-password --out /out/owner_password_hash
   ```

   Never put the hash in `.env` or Compose's `environment:`: Compose reads each `$` in it as a variable. `secrets/` is listed in the repository's `.gitignore`; keep it out of any backup that leaves the host unencrypted.

2. Set `PORTFOLIO_TRUSTED_PROXY_HOPS` in `.env` to the number of proxies in front, usually `1`, so sign-in limits each client by its own address.

3. Stop the `read-only` container and start the owner one:

   ```sh
   docker compose down
   docker compose -f compose.owner.yml up -d
   ```

Every Studio page but sign-in, and every `/api/studio/...` operation, needs a session. A sign-in starts one, held in a cookie only the browser has; it lasts 60 minutes idle and 12 hours in all, and ends at sign-out, when it expires, when the password hash changes, and when `revoke-sessions` runs:

```sh
docker compose -f compose.owner.yml exec web node apps/web/bin/owner.mjs revoke-sessions
```

Under `owner`, the first start imports `config/` into the data volume, and from then on a change goes live only through a Studio publish or `portfolio-store import`. [Deployment](deployment.md#owner-authentication) covers sign-in limits, the audit log, preview grants, backups, and changing the password.
