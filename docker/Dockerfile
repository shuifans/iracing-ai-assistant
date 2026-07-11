# ==============================================================================
# Stage 1: Builder — install deps, run tests, build Next.js standalone
# ==============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Build tools for native modules (better-sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++

# Install all dependencies (including devDependencies for build & test)
COPY package.json package-lock.json ./
RUN npm ci

# Copy full source tree
COPY . .

# Run unit tests (no DB required)
RUN npm run test:unit

# Build Next.js standalone output
RUN npm run build

# ==============================================================================
# Stage 2: Runner — production-only image
# ==============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Runtime env
ENV NODE_ENV=production

# Runtime deps for native modules
RUN apk add --no-cache tini

# Install qodercli (required by @qoder-ai/qoder-agent-sdk)
# TODO: Replace with actual install command once distribution channel is confirmed
# RUN npm install -g @qoder-ai/qodercli

# Next.js standalone output includes its own minimal server + node_modules.
# We still need full production node_modules for the Worker process which
# imports from src/ modules (better-sqlite3, drizzle-orm, etc.).
# Both stages use identical node:20-alpine base, so native modules are compatible.
COPY --from=builder /app/node_modules ./node_modules

# Next.js standalone server (includes server.js + minimal deps)
COPY --from=builder /app/.next/standalone ./
# Static assets must be placed alongside the standalone server
COPY --from=builder /app/.next/static ./.next/static

# Public assets (if any)
COPY --from=builder /app/public ./public

# Worker source (TypeScript — executed via tsx at runtime)
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Database migrations
COPY --from=builder /app/src/db/migrations ./src/db/migrations

# Bootstrap / utility scripts
COPY --from=builder /app/scripts ./scripts

# Writable data directory — only mutable path in the container
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# ---------------------------------------------------------------------------
# Security: .env, .git, tests/, docs/, data/, Git credentials, test fixtures
# and real Wiki raw material are NEVER copied into the image.
# ---------------------------------------------------------------------------

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health/live || exit 1

# Run as non-root
USER node

EXPOSE 3000

# tini provides init: true equivalent — proper PID 1 signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default: start both Web and Worker via entrypoint script
CMD ["/app/scripts/start-container.sh"]
