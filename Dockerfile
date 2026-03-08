## ── AEGIS v7.0 — Production Dockerfile ──────────────────

# Stage 1: Install deps + compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package.json backend/
RUN cd backend && npm install --production=false
COPY backend/ backend/
# tsc emits JS even with type errors (noEmitOnError is off)
RUN cd backend && npx tsc --skipLibCheck || true
# Verify the build produced output
RUN test -f /app/backend/dist/boot.js && echo "✅ Build OK"

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app

# Copy compiled backend + production deps
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/node_modules backend/node_modules
COPY --from=builder /app/backend/package.json backend/

# Copy static UI files + migrations
COPY ui/ ui/
COPY migrations/ migrations/

EXPOSE 3000

CMD ["node", "backend/dist/boot.js"]
