# AEGIS — Runbook Déploiement VPS
# =================================
# Ubuntu 22.04 LTS · Docker · Nginx · SSL Let's Encrypt
# Temps estimé : 30-45 minutes pour un VPS vierge
# =================================

## PRÉREQUIS

- VPS : 4 vCPU · 8 Go RAM · 100 Go SSD (minimum recommandé)
- OS : Ubuntu 22.04 LTS
- Domaine DNS configuré : aegis.tondomaine.com → IP VPS
- Accès root SSH

---

## ÉTAPE 1 — Serveur initial

```bash
# Se connecter en root
ssh root@<IP_VPS>

# Mise à jour
apt update && apt upgrade -y

# Utilisateur dédié (ne pas tourner en root)
adduser aegis
usermod -aG sudo aegis
rsync --archive --chown=aegis:aegis ~/.ssh /home/aegis/

# Firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

# Vérification
ufw status
```

---

## ÉTAPE 2 — Docker + Docker Compose

```bash
su - aegis

# Docker officiel
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker aegis
newgrp docker

# Test
docker run hello-world

# Docker Compose (plugin)
docker compose version
```

---

## ÉTAPE 3 — Nginx + Certbot (SSL)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Configuration Nginx (avant SSL)
sudo nano /etc/nginx/sites-available/aegis
```

**Contenu `/etc/nginx/sites-available/aegis` :**

```nginx
server {
    listen 80;
    server_name aegis.tondomaine.com;

    # Proxy vers le backend
    location /api/ {
        proxy_pass         http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Frontend admin
    location / {
        proxy_pass         http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }

    # Health check public
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
```

```bash
# Activer le site
sudo ln -s /etc/nginx/sites-available/aegis /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL Let's Encrypt
sudo certbot --nginx -d aegis.tondomaine.com
# → Entrer email, accepter ToS, choisir redirect HTTP→HTTPS

# Auto-renouvellement
sudo systemctl enable certbot.timer
sudo certbot renew --dry-run
```

---

## ÉTAPE 4 — Déploiement du code

```bash
# En tant qu'utilisateur aegis
su - aegis
cd ~

# Clone du repo
git clone git@github.com:TON_ORG/aegis.git
cd aegis

# Configuration environnement
cp .env.example .env
nano .env
```

**Variables `.env` à renseigner :**

```env
# ── Database ──────────────────────────────────────────────────
POSTGRES_USER=aegis
POSTGRES_PASSWORD=<GÉNÉRER: openssl rand -base64 32>
POSTGRES_DB=aegis
DATABASE_URL=postgresql://aegis:${POSTGRES_PASSWORD}@postgres:5432/aegis

# ── Sécurité ──────────────────────────────────────────────────
APP_SECRET=<GÉNÉRER: openssl rand -base64 48>
ENCRYPTION_KEY=<GÉNÉRER: openssl rand -base64 32>
INTERNAL_SERVICE_TOKEN=<GÉNÉRER: openssl rand -base64 32>

# ── App ───────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
FRONTEND_PORT=3001
APP_URL=https://aegis.tondomaine.com

# ── LLM ───────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Intégrations ──────────────────────────────────────────────
META_APP_ID=
META_APP_SECRET=
META_SYSTEM_USER_TOKEN=
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── Stockage ──────────────────────────────────────────────────
S3_ENDPOINT=https://...
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=aegis-assets

# ── Emails (reset password, alertes) ──────────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@tondomaine.com

# ── Logs ──────────────────────────────────────────────────────
LOG_LEVEL=info
```

```bash
# Générer les secrets rapidement
echo "APP_SECRET=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
echo "INTERNAL_SERVICE_TOKEN=$(openssl rand -base64 32)"
```

---

## ÉTAPE 5 — Premier démarrage

```bash
cd ~/aegis

# Vérification prérequis
make deploy-check

# Build des images
make build ENV=prod

# Démarrage DB seule d'abord
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
sleep 5

# Migrations
make migrate ENV=prod

# Seed initial (créé le compte admin — noter le reset_token affiché)
make seed ENV=prod

# Démarrage complet
make up ENV=prod

# Vérification
make health
```

---

## ÉTAPE 6 — Configuration admin

Après `make seed`, la console affiche un **reset_token**.

Pour définir le mot de passe admin :

```bash
# Via l'API
curl -X POST https://aegis.tondomaine.com/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token": "<RESET_TOKEN>", "password": "<NOUVEAU_MOT_DE_PASSE>"}'
```

Le compte `jonathanlamessi@yahoo.fr` est configuré :
- Rôle : `superadmin`
- Plan : `Scale` (lifetime gratuit)
- Subscription : `lifetime`

---

## ÉTAPE 7 — Backup automatique

```bash
# Script de backup quotidien
sudo nano /etc/cron.d/aegis-backup
```

**Contenu :**
```cron
# Backup AEGIS tous les jours à 3h00
0 3 * * * aegis cd /home/aegis/aegis && make backup ENV=prod >> /var/log/aegis-backup.log 2>&1

# Nettoyage des backups > 30 jours
30 3 * * * aegis find /home/aegis/aegis/backups -name "*.sql.gz" -mtime +30 -delete
```

---

## ÉTAPE 8 — Monitoring (minimal v1)

```bash
# Uptime check toutes les 5 minutes via cron
echo "*/5 * * * * aegis curl -sf https://aegis.tondomaine.com/health || echo 'AEGIS DOWN' | mail -s 'AEGIS Alert' jonathanlamessi@yahoo.fr" | sudo tee /etc/cron.d/aegis-monitor
```

---

## ROLLBACK D'URGENCE

```bash
# 1. Stopper les workers immédiatement
docker compose stop worker

# 2. Backup de sécurité
make backup ENV=prod

# 3. Revenir au commit précédent
git log --oneline -5    # identifier le commit stable
git checkout <COMMIT>

# 4. Rebuild + redémarrer
make build ENV=prod
make restart ENV=prod
make health

# 5. Si DB corrompue : restaurer
make restore RESTORE=backups/<FICHIER_STABLE>.sql.gz
```

---

## CHECKLIST SÉCURITÉ GO-LIVE

### Obligatoire avant mise en production

- [ ] `.env` non commité (`echo ".env" >> .gitignore`)
- [ ] `POSTGRES_PASSWORD` généré aléatoirement (min 32 chars)
- [ ] `APP_SECRET` et `ENCRYPTION_KEY` différents et uniques
- [ ] Firewall ufw actif — ports 80, 443, SSH uniquement
- [ ] SSL Let's Encrypt configuré et actif (HTTPS forcé)
- [ ] Nginx configuré avec headers sécurité
- [ ] Password admin défini via reset token (jamais en dur)
- [ ] Backups automatiques configurés + testés (`make restore`)
- [ ] RLS vérifié : `make test ENV=prod` → tests isolation tenant passent
- [ ] Stripe webhook secret configuré + vérifié
- [ ] Tokens API (Meta, Shopify) chiffrés en DB (pgcrypto)
- [ ] Logs activés : `LOG_LEVEL=info` en prod
- [ ] `docker compose logs` ne contient pas de secrets

### Recommandé

- [ ] Fail2ban configuré (SSH bruteforce)
- [ ] Accès SSH par clé uniquement (désactiver password auth)
- [ ] `POSTGRES_HOST_AUTH_METHOD` = `scram-sha-256`
- [ ] Monitoring externe (UptimeRobot, BetterUptime)
- [ ] Alerte email si health check échoue

### Headers Nginx sécurité (ajouter dans le bloc server)

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

## TABLEAU PHASES (guardrails activés par palier)

| Palier | Revenue | Guardrails actifs | Agents actifs | Mode autopilot |
|--------|---------|-------------------|---------------|----------------|
| **Phase 1** · 0→1M | 0→10k€/mois | GF1 GF2 GF3 Stop-loss Budget cap | 8 agents core | Human / Semi |
| **Phase 2** · 1M→10M | 10k→100k€/mois | + GF4 Trust Score Drift detection | +6 agents data+ads | Semi / Full |
| **Phase 3** · 10M→100M | 100k€+/mois | + GF5 Collapse detector Throttle | 25 agents complets | Full Autopilot |

**Règle immuable :** POLICY_GOVERNOR et STOP_LOSS actifs à toutes les phases.

---

## COMMANDES UTILES AU QUOTIDIEN

```bash
make health          # Santé du système
make logs            # Logs temps réel
make backup ENV=prod # Backup immédiat
make psql            # Shell PostgreSQL

# Voir les alertes actives
docker compose exec postgres psql -U aegis aegis -c \
  "SELECT alert_type, severity, message, created_at FROM ops.alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 20;"

# Voir les jobs en attente
docker compose exec postgres psql -U aegis aegis -c \
  "SELECT task_type, status, COUNT(*) FROM jobs.queue GROUP BY task_type, status ORDER BY status, COUNT DESC;"

# Empire Index des tenants
docker compose exec postgres psql -U aegis aegis -c \
  "SELECT tenant_id, empire_index, empire_mode, updated_at FROM ops.empire_state ORDER BY empire_index DESC;"
```
