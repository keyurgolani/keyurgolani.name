## syntax=docker/dockerfile:1.7

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /repo

# Copy workspace + every package's package.json so pnpm can wire workspace
# symlinks correctly. We copy the whole directories rather than enumerating
# variant packages individually, so adding a new variant doesn't require a
# Dockerfile edit. Source code is small enough that the cache impact is
# negligible.
COPY pnpm-workspace.yaml package.json .npmrc pnpm-lock.yaml* ./
COPY apps apps
COPY packages packages

RUN pnpm install --frozen-lockfile || pnpm install

# ─── builder ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /repo

# deps stage already has full source + node_modules; reuse.
COPY --from=deps /repo /repo

# Pull in any files that don't live under apps/ or packages/ (configs, etc.).
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @portfolio/web build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
RUN apk add --no-cache wget

# Standalone output ships its own minimal node_modules + server.js
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Default portfolio path inside container; overridable.
ENV PORTFOLIO_PATH=/data/portfolio.yml

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
