# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# Base images are pinned to the multi-arch index digest, and the tag names the
# Node release, which CI's NODE_VERSION must match (pnpm check:pins).

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
# corepack fetches the pnpm version in package.json and checks its sha512.
RUN corepack enable
WORKDIR /repo

# Copy workspace + every package's package.json so pnpm can wire workspace
# symlinks correctly. We copy the whole directories rather than enumerating
# variant packages individually, so adding a new variant doesn't require a
# Dockerfile edit. Source code is small enough that the cache impact is
# negligible.
COPY pnpm-workspace.yaml package.json .npmrc pnpm-lock.yaml ./
COPY apps apps
COPY packages packages

RUN pnpm install --frozen-lockfile

# ─── builder ───────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder
RUN corepack enable
WORKDIR /repo

# deps stage already has full source + node_modules; reuse.
COPY --from=deps /repo /repo

# Pull in any files that don't live under apps/ or packages/ (configs, etc.).
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @portfolio/web build

# The store's CLI (#3): scripts/portfolio-store.ts and every module it
# imports, bundled by esbuild into one file under the react-server condition.
RUN pnpm --filter @portfolio/web build:store

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# The owner profile's data directory (#2, #3). A named volume mounted here
# starts out owned by uid 1001, so the server can write to it; nothing else
# can read it. demo and read-only never use it.
RUN mkdir -p /var/lib/portfolio && chown nextjs:nodejs /var/lib/portfolio && chmod 0700 /var/lib/portfolio

# Standalone output ships its own minimal node_modules + server.js. The app
# tree is owned by root, so the server can't change its own code: the data
# directory above is the only place it writes for good, and every Compose
# example gives Next's cache a tmpfs.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

# The owner CLI (#2), `node apps/web/bin/owner.mjs hash-password` and
# `revoke-sessions`, and the modules it imports by relative path, at the same
# paths as in the repo. Owned by root, so the server can't change them.
COPY --from=builder /repo/apps/web/bin/owner.mjs ./apps/web/bin/owner.mjs
COPY --from=builder /repo/packages/core/src/audit/record.mjs ./packages/core/src/audit/record.mjs
COPY --from=builder /repo/packages/core/src/auth/phc.mjs ./packages/core/src/auth/phc.mjs
COPY --from=builder /repo/packages/core/src/auth/session-files.mjs ./packages/core/src/auth/session-files.mjs
COPY --from=builder /repo/packages/core/src/data/layout.mjs ./packages/core/src/data/layout.mjs

# The store's CLI (#3), `node bin/portfolio-store.mjs <command>`, which runs
# in the server's container as the server's user. One file that needs only
# Node, owned by root like the rest.
COPY --from=builder /repo/apps/web/dist/portfolio-store.mjs ./bin/portfolio-store.mjs

# No PORTFOLIO_* defaults: the deployment sets its profile, origin, and source
# directory at run time (docs/deployment.md), and the server refuses to start
# without them.

USER nextjs
EXPOSE 3000

# server.js binds HOSTNAME. Some runtimes (nerdctl, Kubernetes) replace it with
# the container's hostname, so probe whatever address the server is bound to:
# loopback for a wildcard, brackets for an IPv6 literal.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "const h=process.env.HOSTNAME;const a=!h||h==='0.0.0.0'||h==='::'?'127.0.0.1':h.includes(':')?'['+h+']':h;fetch('http://'+a+':'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
