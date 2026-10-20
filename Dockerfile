# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# Base images are pinned to the multi-arch index digest, and the tag names the
# Node release, which CI's NODE_VERSION must match (pnpm check:pins).

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
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
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
RUN corepack enable
WORKDIR /repo

# deps stage already has full source + node_modules; reuse.
COPY --from=deps /repo /repo

# Pull in any files that don't live under apps/ or packages/ (configs, etc.).
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @portfolio/web build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Standalone output ships its own minimal node_modules + server.js
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

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
