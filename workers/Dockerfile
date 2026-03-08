# ── AEGIS Workers — Dockerfile ───────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ── Dependencies ────────────────────────────────────────────
FROM base AS deps
COPY workers/package.json ./
RUN npm install --omit=dev --frozen-lockfile

# ── Build ────────────────────────────────────────────────────
FROM base AS builder
COPY workers/package.json ./
RUN npm install --frozen-lockfile
COPY workers/tsconfig.json ./
COPY workers/src ./src
RUN npm run build

# ── Production ──────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY workers/package.json ./

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/engines/agent-scheduler.js"]
