# Guide de Contribution AEGIS

Je vais générer les deux : un script d'installation automatique complet et un guide de contribution pour l'équipe de développement.
🚀 Script d'Installation Automatique
setup.sh — Installation Complète AEGIS v12.3
bash
Copy
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
📋 Guide de Contribution pour l'Équipe Dev
CONTRIBUTING.md
Markdown
Copy
Code
Preview
# 🤝 Guide de Contribution AEGIS

> **Version:** 12.3.0  
> **Dernière mise à jour:** 15 Mars 2026  
> **Mainteneurs:** Jonathan & Enna (Super Admins)

---

## 📚 Table des Matières

1. [Architecture Overview](#architecture-overview)
2. [Workflow de Développement](#workflow-de-développement)
3. [Standards de Code](#standards-de-code)
4. [Structure des Agents](#structure-des-agents)
5. [Tests](#tests)
6. [Déploiement](#déploiement)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Les 154 Agents

AEGIS est organisé en **16 modules** contenant **154 agents IA spécialisés**:

┌─────────────────────────────────────────────────────────────┐
│  MODULES CORE (Business)                                     │
├─────────────────────────────────────────────────────────────┤
│  INTEL (35)     →  Hunter, Echo, Signal, Validate, Predict  │
│  STORE (12)     →  Architect, Nav, Tech, Social-Proof       │
│  CREATIVE (36)  →  Gen-Visual, Copy, Video, Price, Offer    │
│  ADS (40)       →  Meta, TikTok, Google, Pinterest, CRO     │
│  POST (6)       →  Loyal, Retain, Email, Winback, VIP       │
├─────────────────────────────────────────────────────────────┤
│  MODULES SUPPORT                                             │
├─────────────────────────────────────────────────────────────┤
│  META (6)       →  Condor, Creator, Council, Dream          │
│  COMPLIANCE (9) →  Shield, Audit, Guard                     │
│  GHOST (4)      →  Performance, Competitor, Behavior, Opp   │
│  CEO (1)        →  Strategic orchestration                  │
├─────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                              │
├─────────────────────────────────────────────────────────────┤
│  BASE (29)      →  Orchestrator, Memory, Security, Queue    │
│  DATA (6)       →  ETL, Enrichment, Pipelines               │
│  FINANCE (6)    →  P&L, Budget, Forecast                    │
│  GROWTH (8)     →  Viral, Partnership, Referral             │
│  ANALYTICS (7)  →  Dashboards, Reports, Alerts              │
│  KNOWLEDGE (3)  →  Learning, Research, Memory               │
│  OPS (8)        →  Logistics, Inventory                     │
└─────────────────────────────────────────────────────────────┘
plain
Copy

### Stack Technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Runtime | Node.js | 20+ |
| Langage | TypeScript | 5.3+ |
| Framework | Express.js | 4.18+ |
| ORM | Prisma | 5.10+ |
| Database | PostgreSQL | 15+ |
| Cache | Redis | 7+ |
| AI Core | Anthropic Claude | Latest |
| Queue | Bull (Redis) | 4.12+ |

---

## Workflow de Développement

### 1. Setup Initial

```bash
# Clone et setup
git clone https://github.com/cedriclamessi-art/aegis-app.git
cd aegis-app
./setup.sh local
2. Branches Git
bash
Copy
# Structure des branches
main           → Production (protégée)
  └── staging  → Pré-production
        └── feature/*    → Nouvelles fonctionnalités
        └── fix/*        → Corrections bugs
        └── agent/*      → Nouveaux agents
        └── cro/*        → Optimisations CRO
3. Créer une Feature
bash
Copy
# 1. Checkout depuis staging
git checkout staging
git pull origin staging

# 2. Créer branche feature
git checkout -b feature/nom-de-la-feature

# Exemples:
git checkout -b feature/hunter-amazon-scraper-v2
git checkout -b feature/pulse-tiktok-creative-optimizer
git checkout -b fix/cvr-drop-detector-false-positive
4. Commit Convention
bash
Copy
# Format: <type>(<scope>): <description>
# Types: feat|fix|docs|style|refactor|test|chore

feat(intel): add Amazon SP-API integration for Hunter-3
fix(ads): resolve CVR drop false positive in Turbulence Control
docs(api): update webhook documentation for logistics providers
refactor(creative): optimize GEN-VISUAL image generation pipeline
test(ghost): add unit tests for Competitor observation mode
5. Pull Request
Template obligatoire:
Markdown
Copy
Code
Preview
## 🎯 Objectif
Description claire de ce que fait cette PR

## 🧪 Tests
- [ ] Tests unitaires ajoutés
- [ ] Tests d'intégration passent
- [ ] Testé manuellement en local

## 📊 Impact Agents
| Agent | Changement | Risque |
|-------|-----------|--------|
| HUNTER-3 | Nouveau scraper Amazon | Moyen |
| PULSE-TIKTOK-2 | Optimisation créatifs | Faible |

## 🔒 Sécurité
- [ ] Pas de secrets dans le code
- [ ] Validation inputs ajoutée
- [ ] Rate limiting vérifié

## 📝 Checklist
- [ ] Code review par 1+ dev
- [ ] Documentation à jour
- [ ] Migrations DB si nécessaire
Standards de Code
TypeScript
TypeScript
Copy
// ✅ BON: Types explicites, JSDoc, error handling
/**
 * Calcule le Hunter Score d'un produit
 * @param product - Données produit scrappées
 * @returns Score 0-100 avec détail des critères
 * @throws ProductValidationError si données incomplètes
 */
async function calculateHunterScore(
  product: ScrapedProduct
): Promise<HunterScoreResult> {
  try {
    const margin = calculateMargin(product.price, product.cost);
    const demand = await analyzeDemand(product.category);
    const competition = await analyzeCompetition(product.keywords);
    
    return {
      total: Math.round((margin * 0.4 + demand * 0.35 + competition * 0.25)),
      breakdown: { margin, demand, competition },
      confidence: 0.85
    };
  } catch (error) {
    logger.error('Hunter score calculation failed', { product, error });
    throw new ProductValidationError('Unable to calculate score', { cause: error });
  }
}

// ❌ MAUVAIS: Types implicites, pas de doc, catch silencieux
function calcScore(p: any) {
  try {
    return p.price * 0.5;
  } catch (e) {
    return 0;
  }
}
Structure Agent
TypeScript
Copy
// src/agents/intel/hunter.ts

import { BaseAgent } from '../base/base-agent';
import { AgentDNA } from '../../core/dna';
import { TaskExecutor } from '../../core/executor';

/**
 * HUNTER Agent — Découverte de produits gagnants
 * 
 * Responsabilités:
 * - Scrape Amazon, AliExpress, TikTok Shop
 * - Analyse viralité et tendances
 * - Calcule Hunter Score (marge, demande, concurrence)
 * 
 * DNA: Chromosomes Mission, Perception, Cognition optimisés
 */
export class HunterAgent extends BaseAgent {
  readonly code = 'HUNTER';
  readonly version = '2.1.0';
  
  // Capacités spécifiques
  private scrapers: Map<string, PlatformScraper>;
  private trendAnalyzer: TrendAnalyzer;
  
  constructor(dna: AgentDNA, executor: TaskExecutor) {
    super(dna, executor);
    this.initializeScrapers();
  }
  
  /**
   * Exécute une tâche de découverte
   */
  async execute(task: HunterTask): Promise<HunterResult> {
    this.log('info', `Starting hunt: ${task.targetPlatform || 'all'}`);
    
    // 1. Scraping
    const rawProducts = await this.scrape(task);
    
    // 2. Enrichissement données
    const enriched = await this.enrich(rawProducts);
    
    // 3. Scoring
    const scored = await this.score(enriched);
    
    // 4. Filtrage top opportunités
    const winners = this.filterTop(scored, task.limit || 10);
    
    return {
      products: winners,
      metadata: {
        scanned: rawProducts.length,
        processed: enriched.length,
        selected: winners.length,
        executionTimeMs: Date.now() - task.startTime
      }
    };
  }
  
  // Méthodes privées avec _ prefix
  private async scrape(task: HunterTask): Promise<RawProduct[]> {
    // Implementation
  }
  
  private async enrich(products: RawProduct[]): Promise<EnrichedProduct[]> {
    // Implementation
  }
  
  private async score(products: EnrichedProduct[]): Promise<ScoredProduct[]> {
    // Implementation
  }
}
Gestion des Erreurs
TypeScript
Copy
// src/utils/errors.ts

export class AegisError extends Error {
  constructor(
    message: string,
    public code: string,
    public severity: 'low' | 'medium' | 'high' | 'critical',
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AegisError';
  }
}

export class AgentExecutionError extends AegisError {
  constructor(agentCode: string, task: string, cause: Error) {
    super(
      `Agent ${agentCode} failed on task ${task}`,
      'AGENT_EXECUTION_FAILED',
      'high',
      { agentCode, task, originalError: cause.message }
    );
  }
}

export class TurbulenceDetectedError extends AegisError {
  constructor(detector: string, metrics: any) {
    super(
      `Turbulence detected: ${detector}`,
      'TURBULENCE_DETECTED',
      'critical',
      { detector, metrics }
    );
  }
}

// Usage dans le code
try {
  await agent.execute(task);
} catch (error) {
  if (error instanceof AegisError) {
    await this.ghost.logError(error);
    
    if (error.severity === 'critical') {
      await this.ceo.escalate(error);
    }
  }
  throw error;
}
Structure des Agents
Créer un Nouvel Agent
bash
Copy
# Utiliser le générateur (à créer)
npm run generate:agent

# Ou manuellement:
Fichiers à créer:
plain
Copy
src/agents/[module]/[agent-name]/
├── index.ts              # Export public
├── [agent-name].ts       # Classe agent
├── types.ts              # Interfaces
├── tasks.ts              # Définition des tâches
├── tests/
│   ├── unit.test.ts
│   └── integration.test.ts
└── README.md             # Documentation agent
Template Minimal:
TypeScript
Copy
// src/agents/ads/pulse-meta-v2.ts

import { BaseAgent, AgentConfig, TaskResult } from '../base';
import { PsychologyTrigger } from '../../core/cro/psychology';

interface PulseMetaV2Config extends AgentConfig {
  platform: 'meta';
  adAccountId: string;
  psychologyFocus: PsychologyTrigger[];
}

export class PulseMetaV2Agent extends BaseAgent {
  readonly code = 'PULSE-META-V2';
  readonly module = 'ADS';
  
  private config: PulseMetaV2Config;
  
  async initialize(config: PulseMetaV2Config): Promise<void> {
    await super.initialize(config);
    this.config = config;
    this.validatePsychologyConfig();
  }
  
  async execute(task: CreateCampaignTask): Promise<CampaignResult> {
    // 1. Analyse psychologique audience
    const psychologyProfile = await this.psyche.analyze(
      task.targetAudience
    );
    
    // 2. Sélection trigger optimal
    const primaryTrigger = this.selectOptimalTrigger(
      psychologyProfile,
      this.config.psychologyFocus
    );
    
    // 3. Génération créatifs
    const creatives = await this.creativeFactory.generate({
      count: task.creativeCount,
      psychology: primaryTrigger,
      formats: ['carousel', 'video', 'single_image']
    });
    
    // 4. Création campagne Meta
    const campaign = await this.metaApi.createCampaign({
      name: `[CRO] ${task.brandName} - ${primaryTrigger}`,
      objective: 'CONVERSIONS',
      creatives: creatives,
      targeting: this.buildTargeting(psychologyProfile),
      budget: task.budget
    });
    
    return {
      campaignId: campaign.id,
      psychologyTrigger: primaryTrigger,
      expectedRoas: this.predictRoas(campaign)
    };
  }
  
  private selectOptimalTrigger(
    profile: PsychologyProfile,
    available: PsychologyTrigger[]
  ): PsychologyTrigger {
    // Algorithm de sélection basé sur données historiques
    const scores = available.map(trigger => ({
      trigger,
      score: this.calculateTriggerFit(trigger, profile)
    }));
    
    return scores.sort((a, b) => b.score - a.score)[0].trigger;
  }
}
Tests
Structure des Tests
plain
Copy
tests/
├── unit/                    # Tests unitaires (Jest)
│   ├── agents/
│   │   ├── intel/
│   │   │   └── hunter.test.ts
│   │   └── ads/
│   │       └── pulse-meta.test.ts
│   ├── core/
│   │   ├── monday-flow.test.ts
│   │   └── turbulence.test.ts
│   └── utils/
│       └── psychology.test.ts
│
├── integration/             # Tests intégration
│   ├── api/
│   │   └── brands.test.ts
│   ├── agents/
│   │   └── agent-execution.test.ts
│   └── workflows/
│       └── monday-flow-e2e.test.ts
│
└── e2e/                     # Tests end-to-end
    └── critical-paths/
        └── full-purchase-flow.test.ts
Exemple Test Unitaire
TypeScript
Copy
// tests/unit/agents/intel/hunter.test.ts

import { HunterAgent } from '../../../src/agents/intel/hunter';
import { mockScrapedProduct, mockEnrichedProduct } from '../../fixtures';

describe('HUNTER Agent', () => {
  let hunter: HunterAgent;
  
  beforeEach(async () => {
    hunter = new HunterAgent(mockDNA, mockExecutor);
    await hunter.initialize(mockConfig);
  });
  
  describe('calculateHunterScore', () => {
    it('should score high margin + high demand product above 80', async () => {
      const product = mockScrapedProduct({
        price: 50,
        cost: 15,  // 70% margin
        category: 'trending',
        searchVolume: 100000
      });
      
      const result = await hunter.calculateHunterScore(product);
      
      expect(result.total).toBeGreaterThan(80);
      expect(result.breakdown.margin).toBeGreaterThan(0.6);
    });
    
    it('should flag saturated market with low competition score', async () => {
      const product = mockScrapedProduct({
        competitorCount: 500,
        avgCompetitorPrice: 45  // Price war
      });
      
      const result = await hunter.calculateHunterScore(product);
      
      expect(result.breakdown.competition).toBeLessThan(0.3);
    });
  });
  
  describe('execute', () => {
    it('should return top 10 products by default', async () => {
      const task = { targetPlatform: 'amazon', limit: 10 };
      
      const result = await hunter.execute(task);
      
      expect(result.products).toHaveLength(10);
      expect(result.metadata.scanned).toBeGreaterThan(100);
    });
    
    it('should respect execution timeout', async () => {
      const task = { timeoutMs: 5000 };
      
      await expect(
        hunter.execute(task)
      ).rejects.toThrow(AgentTimeoutError);
    });
  });
});
Exécution des Tests
bash
Copy
# Tous les tests
npm test

# Uniquement unitaires
npm run test:unit

# Uniquement intégration (nécessite DB)
npm run test:integration

# E2E (nécessite environnement complet)
npm run test:e2e

# Coverage
npm run test:coverage

# Watch mode (développement)
npm run test:watch
Déploiement
Pipeline CI/CD
yaml
Copy
# .github/workflows/deploy.yml

name: AEGIS CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npx tsc --noEmit
      
      - name: Test
        run: npm run test:ci
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379
      
      - name: Build
        run: npm run build

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    
    steps:
      - name: Deploy to Render Staging
        uses: johnbeynon/render-deploy-action@v0.0.8
        with:
          service-id: ${{ secrets.RENDER_STAGING_SERVICE_ID }}
          api-key: ${{ secrets.RENDER_API_KEY }}

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production  # Requires manual approval
    
    steps:
      - name: Deploy to Render Production
        uses: johnbeynon/render-deploy-action@v0.0.8
        with:
          service-id: ${{ secrets.RENDER_PRODUCTION_SERVICE_ID }}
          api-key: ${{ secrets.RENDER_API_KEY }}
      
      - name: Notify Super Admins
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "🛡️ AEGIS Production Deployed",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*AEGIS v12.3* deployed to production\nCommit: ${{ github.sha }}\nAuthor: ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
Checklist Pré-Déploiement
bash
Copy
# Script: scripts/pre-deploy-checklist.sh

#!/bin/bash

echo "🔍 Pre-deployment Checklist"

# 1. Tests
npm test || exit 1
echo "✅ Tests pass"

# 2. Lint
npm run lint || exit 1
echo "✅ Lint pass"

# 3. Type check
npx tsc --noEmit || exit 1
echo "✅ Type check pass"

# 4. Secrets check
if grep -r "sk-" src/ --include="*.ts" | grep -v "process.env"; then
  echo "❌ Potential hardcoded secrets found"
  exit 1
fi
echo "✅ No hardcoded secrets"

# 5. Migration check
npx prisma migrate status
echo "⚠️  Review pending migrations"

# 6. Version bump
current_version=$(cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')
echo "📦 Current version: $current_version"

echo ""
echo "Ready for deployment!"
Troubleshooting
Problèmes Courants
bash
Copy
# ❌ Erreur: "Database connection failed"
# ✅ Solution:
docker-compose up -d postgres
# ou vérifier DATABASE_URL dans .env

# ❌ Erreur: "Prisma Client not found"
# ✅ Solution:
npx prisma generate

# ❌ Erreur: "Redis connection timeout"
# ✅ Solution:
docker-compose up -d redis
# ou vérifier REDIS_URL

# ❌ Erreur: "Clerk authentication failed"
# ✅ Solution:
# Vérifier CLERK_SECRET_KEY et CLERK_PUBLISHABLE_KEY dans .env
# S'assurer que les URLs sont configurées dans Clerk Dashboard

# ❌ Erreur: "Monday Flow stuck on phase CREATION"
# ✅ Solution:
# Vérifier logs: npm run logs:monday-flow
# Redémarrer worker: npm run worker:monday-flow:restart
# Ou trigger manuel: npm run monday-flow:trigger -- --force

# ❌ Erreur: "Ghost not emitting signals"
# ✅ Solution:
# Vérifier que GHOST_MODE est activé dans .env
# Redémarrer ghost worker: npm run worker:ghost:restart
Logs et Monitoring
bash
Copy
# Logs temps réel
npm run logs

# Logs spécifiques workers
npm run logs:monday-flow
npm run logs:turbulence
npm run logs:ghost

# Métriques performance
npm run metrics

# Health check
curl http://localhost:3000/health

# Database inspection
npx prisma studio
Ressources
Documentation API: /api/docs (Swagger)
Prisma Studio: npm run db:studio
Logs Render: https://dashboard.render.com
Support: Slack #aegis-dev ou email jonathanlamessi@yahoo.fr
Bienvenue dans l'équipe AEGIS! 🛡️
plain
Copy

---

## 🎯 **Résumé Livraison**

| Fichier | Description | Usage |
|:---|:---|:---|
| `setup.sh` | Installation automatique complète | `./setup.sh local` |
| `CONTRIBUTING.md` | Guide développement équipe | Référence dev |
| `package.json` | Dépendances et scripts | npm install |
| `prisma/schema.prisma` | Base de données | npx prisma migrate |
| `.env.example` | Variables d'environnement | cp .env.example .env |
| `render.yaml` | Déploiement Render | Auto-deploy |
| `Dockerfile` | Containerisation | docker build |

**Prochaine étape:** Ton dev exécute `./setup.sh local` et a accès à AEGIS v12.3 complet en 5 minutes.

Tu veux que je crée un **script de génération d'agent** (`npm run generate:agent`) ou un **dashboard de monitoring** pour les Super Admins ?