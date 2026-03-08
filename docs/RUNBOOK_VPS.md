# AEGIS v3.2 — Runbook VPS
## Déploiement · Sécurité · Maintenance · Rollback

> **Cible** : VPS Ubuntu 22.04 LTS — 4 vCPU · 8 GB RAM · 80 GB SSD  
> **Temps estimé** : premier déploiement ~45 min · mise à jour ~10 min

---

## 0. Prérequis serveur

```bash
# Connexion initiale
ssh root@<IP_VPS>

# Créer un utilisateur non-root
adduser aegis
usermod -aG sudo aegis
rsync --archive --chown=aegis:aegis ~/.ssh /home/aegis/

# Se connecter avec l'utilisateur dédié
ssh aegis@<IP_VPS>
```

---

## 1. Installation dépendances

```bash
# Mise à jour système
sudo apt update && sudo apt upgrade -y

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose (inclus dans Docker Desktop ≥ v2)
docker compose version  # doit retourner v2.x

# Outils
sudo apt install -y make postgresql-client git curl nginx certbot python3-certbot-nginx ufw htop

# Vérification
docker --version
docker compose version
psql --version
make --version
```

---

## 2. Récupération du code

```bash
# Cloner le repo (ou uploader le ZIP)
git clone <REPO_URL> /opt/aegis
cd /opt/aegis

# Ou via SCP depuis votre machine locale :
# scp -r aegis-v3.2-final.zip aegis@<IP_VPS>:/opt/aegis.zip
# ssh aegis@<IP_VPS> "cd /opt && unzip aegis.zip && mv aegis-v3.2-final aegis"
```

---

## 3. Configuration des secrets (.env)

```bash
cd /opt/aegis
cp .env.example .env
chmod 600 .env   # ← IMPORTANT : lisible uniquement par le propriétaire
nano .env
```

**Variables OBLIGATOIRES à remplir :**

```bash
# ── PostgreSQL ─────────────────────────────────────────────
POSTGRES_USER=aegis
POSTGRES_PASSWORD=<GÉNÉRER : openssl rand -base64 32>
POSTGRES_DB=aegis
POSTGRES_PORT=5432

# ── Backend ────────────────────────────────────────────────
NODE_ENV=production
BACKEND_PORT=3000
JWT_SECRET=<GÉNÉRER : openssl rand -base64 48>
JWT_EXPIRES_IN=7d

# ── Sécurité DB ────────────────────────────────────────────
APP_ENCRYPTION_KEY=<GÉNÉRER : openssl rand -base64 32>

# ── Anthropic (LLM) ────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Meta ───────────────────────────────────────────────────
META_APP_ID=
META_APP_SECRET=
META_SYSTEM_USER_TOKEN=

# ── Shopify ────────────────────────────────────────────────
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=

# ── Stripe ─────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── Email (pour reset password + alertes) ──────────────────
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG....
EMAIL_FROM=noreply@aegis.app

# ── Admin ──────────────────────────────────────────────────
ADMIN_EMAIL=jonathanlamessi@yahoo.fr

# ── Optionnel ──────────────────────────────────────────────
SCRAPER_SERVICE_URL=http://scraper:4000
INTERNAL_SERVICE_TOKEN=<GÉNÉRER : openssl rand -hex 20>
```

**Générer tous les secrets en une commande :**
```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "INTERNAL_SERVICE_TOKEN=$(openssl rand -hex 20)"
```

---

## 4. Démarrage et migrations

```bash
cd /opt/aegis

# 4.1 — Vérification pré-déploiement
make deploy-check

# 4.2 — Démarrer PostgreSQL d'abord
docker compose up -d postgres
sleep 8  # attendre que Postgres soit prêt

# 4.3 — Toutes les migrations (ordre strict)
make migrate

# 4.4 — Seed + bootstrap admin
make seed
make bootstrap-admin

# ⚠️  NOTER le reset_token retourné — à utiliser UNE SEULE FOIS pour définir le password admin

# 4.5 — Démarrer tous les services
make up

# 4.6 — Vérifier la santé
make health
```

---

## 5. Configuration Nginx + HTTPS

```bash
# 5.1 — Config Nginx
sudo nano /etc/nginx/sites-available/aegis
```

```nginx
server {
    listen 80;
    server_name api.aegis.app;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.aegis.app;

    ssl_certificate     /etc/letsencrypt/live/api.aegis.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.aegis.app/privkey.pem;

    # Sécurité TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;

    location / {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

```bash
# 5.2 — Activer
sudo ln -s /etc/nginx/sites-available/aegis /etc/nginx/sites-enabled/
sudo nginx -t  # ← vérifier la config avant de recharger

# 5.3 — Certificat SSL Let's Encrypt (domaine DNS configuré)
sudo certbot --nginx -d api.aegis.app -d admin.aegis.app
# → renouvellement automatique via systemd timer

# 5.4 — Recharger Nginx
sudo systemctl reload nginx
```

---

## 6. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh          # port 22
sudo ufw allow 'Nginx Full' # ports 80 + 443
# NE PAS exposer 3000, 5432, 6379 directement
sudo ufw enable
sudo ufw status
```

---

## 7. Backup automatique (cron)

```bash
# 7.1 — Script backup
sudo nano /opt/aegis/scripts/backup.sh
```

```bash
#!/bin/bash
set -e
source /opt/aegis/.env
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/aegis/backups
mkdir -p $BACKUP_DIR

# Dump + compression
pg_dump "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}" \
  | gzip > "${BACKUP_DIR}/aegis_${TIMESTAMP}.sql.gz"

# Garder uniquement les 14 derniers jours
find $BACKUP_DIR -name "*.sql.gz" -mtime +14 -delete

echo "$(date) — Backup OK : aegis_${TIMESTAMP}.sql.gz" >> /var/log/aegis-backup.log
```

```bash
chmod +x /opt/aegis/scripts/backup.sh

# 7.2 — Cron : backup quotidien 3h du matin
crontab -e
# Ajouter :
0 3 * * * /opt/aegis/scripts/backup.sh >> /var/log/aegis-backup.log 2>&1
```

---

## 8. Définir le mot de passe admin

Après `make bootstrap-admin`, tu reçois un `reset_token`. Appel unique :

```bash
# Via curl
curl -X POST https://api.aegis.app/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<RESET_TOKEN>","newPassword":"<MOT_DE_PASSE_FORT>"}'

# Le token expire après 24h et ne peut être utilisé qu'une fois.
# Si expiré : make bootstrap-admin pour en générer un nouveau.
```

**Règles mot de passe admin :**
- Minimum 16 caractères
- Majuscules + minuscules + chiffres + caractères spéciaux
- Ne jamais stocker en texte brut, jamais dans .env

---

## 9. Tests go-live

```bash
cd /opt/aegis

# Suite complète
make test

# Health complet
make health

# Audit sécurité
make audit

# Vérifier l'admin
curl https://api.aegis.app/health | jq .
curl -X POST https://api.aegis.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jonathanlamessi@yahoo.fr","password":"<MOT_DE_PASSE>"}'
```

---

## 10. Mises à jour (routine)

```bash
cd /opt/aegis

# 10.1 — Backup avant toute mise à jour
make backup

# 10.2 — Pull du nouveau code
git pull origin main

# 10.3 — Rebuild + migration
make build
make migrate      # toujours idempotent et additif

# 10.4 — Rolling restart (zéro downtime si possible)
docker compose up -d --no-deps backend
docker compose up -d --no-deps worker

# 10.5 — Vérifier
make health-post-deploy
make test --filter=health
```

---

## 11. Rollback d'urgence

```bash
# Si un déploiement casse quelque chose :

# 11.1 — Arrêter les workers immédiatement
docker compose stop worker

# 11.2 — Backup de l'état actuel
make backup

# 11.3 — Revenir à la version précédente
git stash   # ou git checkout <TAG_PRÉCÉDENT>

# 11.4 — Restore du code
docker compose up -d --no-deps backend

# 11.5 — Si migration à rollbacker (rare — migrations additives)
# Voir output de : SELECT * FROM agents.send_message(
#   'AGENT_RELEASE_MANAGER', ..., 'release.rollback', ...)

# 11.6 — Vérifier
make health
make test
```

---

## 12. Monitoring minimal (sans SaaS)

```bash
# Logs en temps réel
make logs

# Jobs queue (santé)
make shell-db
\c aegis
SELECT status, COUNT(*) FROM jobs.queue GROUP BY status;
SELECT * FROM ops.alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 10;
SELECT * FROM agents.throttle_state WHERE throttled = TRUE;

# Espace disque
df -h

# Mémoire + CPU
htop
docker stats
```

---

## 13. Checklist sécurité — À valider avant go-live

```
[ ] .env en chmod 600 — lisible uniquement par l'utilisateur aegis
[ ] Aucun mot de passe en dur dans le code (make audit)
[ ] JWT_SECRET > 32 caractères aléatoires
[ ] APP_ENCRYPTION_KEY > 32 caractères aléatoires
[ ] Firewall UFW actif — ports 5432, 3000 non exposés
[ ] HTTPS actif — certificat Let's Encrypt valide
[ ] Nginx rate limiting configuré
[ ] Backup cron actif (crontab -l)
[ ] Backup testé : make restore (sur un VPS de test)
[ ] make test → 20/20 ✅
[ ] make audit → tout vert
[ ] make health → tous services OK
[ ] Admin : mot de passe défini via reset_token (jamais en dur)
[ ] Stripe webhook secret configuré
[ ] Meta App en mode Live (pas Sandbox)
[ ] SMTP configuré — tester envoi email reset
[ ] SSH : accès par clé uniquement (PasswordAuthentication no dans sshd_config)
[ ] Logs Docker configurés (rotation : max-size 50m, max-file 5)
```

---

## 14. Plan de phases (guardrails activés)

| Phase | Revenue | CM% | Fonctionnalités débloquées |
|-------|---------|-----|---------------------------|
| **1 — BASIC** | Dès le départ | — | Winner Detector · Meta Testing · Stop Loss · Scraping · Organic |
| **2 — HEDGE FUND** | ≥ 10k€/mois | ≥ 20% | Creative Factory · Learning · SPY · CAPI Relay · Market Intel |
| **3 — FULL ORGANISM** | ≥ 100k€/mois | ≥ 30% · Cash ≥ 60j | CEO Autonome · UGC Factory · Cross-tenant Learning · Revenue Share |

**Empire Index → Mode opérationnel :**
- < 40 → SURVIE (scaling interdit, stabilisation obligatoire)
- 40–60 → ADAPTATIF (croissance prudente)
- 60–80 → SCALABLE (scale autorisé)
- > 80 → AGGRESSIF (full organism)

---

## Commandes d'urgence (quick ref)

```bash
# Stop immédiat de tout le spend
docker compose stop worker && echo "Workers arrêtés — aucune action Meta"

# Kill switch global (via DB)
psql $DB_URL -c "UPDATE saas.tenants SET kill_switch = TRUE WHERE id = '<TENANT_ID>'"

# Voir les alertes critiques
psql $DB_URL -c "SELECT * FROM ops.alerts WHERE severity='critical' AND resolved_at IS NULL"

# Débloquer un agent throttlé
psql $DB_URL -c "UPDATE agents.throttle_state SET throttled=FALSE WHERE agent_id='<AGENT_ID>'"

# Backup manuel d'urgence
pg_dump $DATABASE_URL | gzip > ~/emergency_backup_$(date +%s).sql.gz
```
