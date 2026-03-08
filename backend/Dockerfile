# ── AEGIS Backend — Dockerfile ──────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ── Dependencies ────────────────────────────────────────────
FROM base AS deps
COPY backend/package.json ./
RUN npm install --omit=dev --frozen-lockfile

# ── Build ────────────────────────────────────────────────────
FROM base AS builder
COPY backend/package.json ./
RUN npm install --frozen-lockfile
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ── Production ──────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY backend/package.json ./

EXPOSE 3000
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
