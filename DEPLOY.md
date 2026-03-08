# AEGIS v3.7 — Deployment Guide (Hetzner VPS / Railway)

## Option A — Hetzner VPS (recommended, €6/month CX22)

### 1. Provision server
```bash
# Hetzner Cloud — CX22: 2 vCPU, 4 GB RAM, 40 GB SSD
# OS: Ubuntu 22.04
# Region: Nuremberg (EU)
```

### 2. Initial setup
```bash
ssh root@YOUR_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
apt install docker-compose-plugin -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install nodejs -y

# Create aegis user
useradd -m -s /bin/bash aegis
usermod -aG docker aegis
```

### 3. Deploy AEGIS
```bash
# Upload package
scp aegis-v3.7-final.zip aegis@YOUR_IP:~
ssh aegis@YOUR_IP
unzip aegis-v3.7-final.zip && cd aegis-v3.7-src

# Configure env
cp .env.example .env
nano .env  # fill all secrets

# Run migrations
docker compose up postgres -d
sleep 5
docker compose exec postgres psql -U aegis -d aegis -f /docker-entrypoint-initdb.d/000_consolidated.sql
# run remaining migrations in order...

# Start all services
docker compose up -d

# Check health
curl http://localhost:8000/health
```

### 4. SSL with Let's Encrypt
```bash
# Edit nginx.conf — replace YOUR_DOMAIN
docker compose up certbot -d
# Wait for cert generation, then restart nginx
docker compose restart nginx
```

### 5. Auto-deploy (GitHub Actions)
```yaml
# .github/workflows/deploy.yml
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to VPS
        run: |
          ssh aegis@${{ secrets.VPS_IP }} 'cd aegis && git pull && docker compose up -d --build'
```

---

## Option B — Railway (zero-ops, ~€15/month)

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Deploy
railway new
railway add postgresql
railway add redis
railway up

# Set env vars
railway vars set ANTHROPIC_API_KEY=sk-ant-...
railway vars set JWT_SECRET=$(openssl rand -hex 32)
# ... (all vars from .env.example)
```

---

## Environment Variables Required

```env
# Database
POSTGRES_PASSWORD=strong-password-here
DATABASE_URL=postgresql://aegis:${POSTGRES_PASSWORD}@postgres:5432/aegis

# Redis
REDIS_PASSWORD=strong-redis-password
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# Auth
JWT_SECRET=generate-with-openssl-rand-hex-32

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# Platforms
META_APP_ID=...
META_APP_SECRET=...
TIKTOK_APP_ID=...
TIKTOK_APP_SECRET=...
SHOPIFY_WEBHOOK_SECRET=...

# Delivery
RESEND_API_KEY=re_...
WHATSAPP_TOKEN=EAA...
WHATSAPP_PHONE_ID=...

# Klaviyo
KLAVIYO_API_KEY=pk_...
KLAVIYO_LIST_CHAMPIONS=...
KLAVIYO_LIST_AT_RISK=...
KLAVIYO_LIST_DORMANT=...
KLAVIYO_FLOW_TRANSFORMATION=...
KLAVIYO_FLOW_DEFAULT=...
```

---

## Post-deploy checklist

- [ ] `GET /health` returns `{"status": "healthy"}`
- [ ] PostgreSQL migrations 000–027 all applied
- [ ] Redis connection confirmed
- [ ] First admin user created via `POST /auth/register`
- [ ] Shopify connected + webhook registered
- [ ] Meta Ads connected
- [ ] Product margins entered in `/settings/margins`
- [ ] Brief delivery preferences configured
- [ ] First DCT launched
- [ ] Onboarding wizard completed

## Monitoring

```bash
# Logs
docker compose logs -f api
docker compose logs -f workers

# DB
docker compose exec postgres psql -U aegis -c "SELECT * FROM shop_scheduler_state;"

# Agent decisions (last 10)
docker compose exec postgres psql -U aegis -c \
  "SELECT agent_name, decision_type, confidence, created_at FROM agent_decisions ORDER BY created_at DESC LIMIT 10;"

# Health
watch -n 30 curl -s localhost:8000/health
```
