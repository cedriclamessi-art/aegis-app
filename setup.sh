#!/bin/bash

# ============================================================
# AEGIS v12.3 — Script d'Installation Automatique
# Usage: ./setup.sh [environment]
# Environments: local | staging | production
# ============================================================

set -e  # Stop on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AEGIS_VERSION="12.3.0"
REPO_URL="https://github.com/cedriclamessi-art/aegis-app.git"
PROJECT_NAME="aegis-app"

# Functions
print_header() {
    echo ""
    echo "============================================================"
    echo "  🛡️  AEGIS v${AEGIS_VERSION} — Installation"
    echo "  Mode: ${ENVIRONMENT}"
    echo "============================================================"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

check_prerequisites() {
    print_info "Vérification des prérequis..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js n'est pas installé. Installation requise: v20+"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        print_error "Node.js v20+ requis. Version actuelle: $(node -v)"
        exit 1
    fi
    print_success "Node.js $(node -v)"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm n'est pas installé"
        exit 1
    fi
    print_success "npm $(npm -v)"
    
    # Check Git
    if ! command -v git &> /dev/null; then
        print_error "Git n'est pas installé"
        exit 1
    fi
    print_success "Git $(git --version | cut -d' ' -f3)"
    
    # Check Docker (optional but recommended)
    if command -v docker &> /dev/null; then
        print_success "Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
        DOCKER_AVAILABLE=true
    else
        print_warning "Docker non disponible (optionnel)"
        DOCKER_AVAILABLE=false
    fi
    
    echo ""
}

setup_local() {
    print_header
    
    # 1. Clone repository
    print_info "1. Clonage du repository..."
    if [ -d "$PROJECT_NAME" ]; then
        print_warning "Le dossier $PROJECT_NAME existe déjà"
        read -p "Supprimer et recloner? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf $PROJECT_NAME
            git clone $REPO_URL $PROJECT_NAME
        else
            cd $PROJECT_NAME
            git pull origin main
        fi
    else
        git clone $REPO_URL $PROJECT_NAME
    fi
    
    cd $PROJECT_NAME
    print_success "Repository cloné"
    
    # 2. Install dependencies
    print_info "2. Installation des dépendances..."
    npm install
    print_success "Dépendances installées ($(npm list --depth=0 | wc -l) packages)"
    
    # 3. Environment setup
    print_info "3. Configuration de l'environnement..."
    if [ ! -f .env ]; then
        cp .env.example .env
        
        # Generate random secrets
        JWT_SECRET=$(openssl rand -hex 32)
        WEBHOOK_SECRET=$(openssl rand -hex 16)
        
        # Update .env with generated secrets
        sed -i.bak "s/JWT_SECRET=.*/JWT_SECRET=\"$JWT_SECRET\"/" .env
        sed -i.bak "s/LOGISTICS_WEBHOOK_SECRET=.*/LOGISTICS_WEBHOOK_SECRET=\"$WEBHOOK_SECRET\"/" .env
        rm .env.bak
        
        print_success "Fichier .env créé avec secrets générés"
        print_warning "⚠️  IMPORTANT: Éditez .env pour ajouter vos vraies clés API"
    else
        print_warning ".env existe déjà, conservation"
    fi
    
    # 4. Database setup
    print_info "4. Configuration de la base de données..."
    
    if [ "$DOCKER_AVAILABLE" = true ]; then
        print_info "   Démarrage PostgreSQL + Redis via Docker..."
        docker-compose up -d postgres redis
        sleep 5
        
        # Wait for PostgreSQL
        until docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
            print_info "   Attente PostgreSQL..."
            sleep 2
        done
        print_success "PostgreSQL et Redis démarrés"
    else
        print_warning "   Docker non disponible"
        print_info "   Assurez-vous que PostgreSQL et Redis tournent localement"
        read -p "Appuyez sur Entrée quand c'est prêt..."
    fi
    
    # 5. Prisma setup
    print_info "5. Initialisation de Prisma..."
    npx prisma generate
    npx prisma migrate dev --name init
    print_success "Database migrée"
    
    # 6. Seed database
    print_info "6. Création des données initiales..."
    npx ts-node prisma/seed.ts
    print_success "Super Admins créés (Jonathan & Enna)"
    
    # 7. Build
    print_info "7. Build du projet..."
    npm run build
    print_success "Build terminé"
    
    # 8. Git hooks (optional)
    print_info "8. Configuration des git hooks..."
    npx husky install 2>/dev/null || print_warning "Husky non configuré"
    
    # Summary
    echo ""
    echo "============================================================"
    print_success "Installation locale terminée!"
    echo "============================================================"
    echo ""
    echo "Prochaines étapes:"
    echo "  1. Éditez .env avec vos vraies clés API"
    echo "  2. npm run dev          # Démarrer en mode développement"
    echo "  3. npm run db:studio    # Ouvrir Prisma Studio"
    echo ""
    echo "URLs:"
    echo "  - App: http://localhost:3000"
    echo "  - Health: http://localhost:3000/health"
    echo "  - API Docs: http://localhost:3000/api/docs"
    echo ""
}

setup_staging() {
    print_header
    
    print_info "Configuration environnement STAGING..."
    
    # Vérifier variables Render
    if [ -z "$RENDER_API_KEY" ]; then
        print_error "RENDER_API_KEY non défini"
        print_info "Obtenez une clé sur: https://dashboard.render.com/settings/api-keys"
        exit 1
    fi
    
    # Deploy via Render CLI
    print_info "Déploiement sur Render..."
    
    # Blueprint deploy
    render blueprint apply -f render.yaml --environment staging
    
    print_success "Staging déployé!"
    echo "URL: https://aegis-app-staging.onrender.com"
}

setup_production() {
    print_header
    
    print_warning "DÉPLOIEMENT PRODUCTION"
    echo ""
    read -p "Êtes-vous sûr? Cela affectera les utilisateurs en ligne. (yes/no): " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
        print_info "Déploiement annulé"
        exit 0
    fi
    
    # Safety checks
    print_info "Vérifications de sécurité..."
    
    # Check git status
    if [ -n "$(git status --porcelain)" ]; then
        print_error "Des modifications non commitées existent"
        git status
        exit 1
    fi
    
    # Check tests
    print_info "Exécution des tests..."
    npm test
    if [ $? -ne 0 ]; then
        print_error "Tests échoués"
        exit 1
    fi
    
    # Deploy
    print_info "Déploiement production..."
    git push origin main
    
    # Render auto-deploy
    print_info "Render déploie automatiquement..."
    
    # Wait for health check
    print_info "Attente health check..."
    sleep 30
    
    HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://aegis-app.onrender.com/health)
    
    if [ "$HEALTH_STATUS" == "200" ]; then
        print_success "Production déployée et healthy!"
    else
        print_error "Health check failed (status: $HEALTH_STATUS)"
        print_info "Vérifiez les logs: render.com/dashboard"
        exit 1
    fi
}

# Main
ENVIRONMENT=${1:-local}

case $ENVIRONMENT in
    local)
        check_prerequisites
        setup_local
        ;;
    staging)
        setup_staging
        ;;
    production)
        setup_production
        ;;
    *)
        echo "Usage: ./setup.sh [local|staging|production]"
        echo ""
        echo "Environments:"
        echo "  local       - Développement local avec Docker"
        echo "  staging     - Déploiement sur Render (staging)"
        echo "  production  - Déploiement production (avec sécurités)"
        exit 1
        ;;
esac

echo ""
echo "🛡️  AEGIS v${AEGIS_VERSION} prêt!"
echo ""