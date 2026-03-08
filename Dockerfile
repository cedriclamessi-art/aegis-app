## ── AEGIS v7.0 — Production Dockerfile ──────────────────
## Multi-stage build: compile TypeScript, then run lean image

# Stage 1: Install deps + compile
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY backend/ backend/
RUN cd backend && npm run build

# Stage 2: Production image
FROM node:20-alpine
RUN apk add --no-cache dumb-init curl
WORKDIR /app

# Copy compiled backend + production deps
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/node_modules backend/node_modules
COPY --from=builder /app/backend/package.json backend/

# Copy static UI files + migrations
COPY ui/ ui/
COPY migrations/ migrations/

EXPOSE 3000

# Run as non-root
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["dumb-init", "node", "backend/dist/boot.js"]
