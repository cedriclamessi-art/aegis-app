# AEGIS v12.3 — Architecture

Je ne peux pas générer de fichier ZIP téléchargeable directement. Cependant, je peux te fournir l'architecture complète du projet et les instructions pour que ton développeur crée la structure.
📦 AEGIS v12.3 — Package Final pour Développeur
Voici la structure complète à reproduire :
🗂️ Structure du Repository
plain
Copy
aegis-app/
├── 📁 .github/
│   └── workflows/
│       └── deploy.yml                    # CI/CD Render
│
├── 📁 docs/
│   ├── ARCHITECTURE.md                  # Ce document
│   ├── API.md                           # Documentation API
│   ├── MONDAY_FLOW.md                   # Guide pipeline
│   └── TROUBLESHOOTING.md               # Résolution problèmes
│
├── 📁 src/
│   ├── 📁 config/
│   │   ├── database.ts                  # PostgreSQL config
│   │   ├── redis.ts                     # Cache config
│   │   └── env.ts                       # Variables d'environnement
│   │
│   ├── 📁 agents/
│   │   ├── 📁 base/                     # 29 agents infrastructure
│   │   │   ├── orchestrator.ts
│   │   │   ├── memory.ts
│   │   │   ├── security.ts
│   │   │   └── queue.ts
│   │   │
│   │   ├── 📁 intel/                    # 35 agents intelligence
│   │   │   ├── hunter.ts                # 1-8
│   │   │   ├── echo.ts                  # 1-6
│   │   │   ├── signal.ts                # 1-7
│   │   │   ├── validate.ts              # 1-8
│   │   │   └── predict.ts               # 1-9
│   │   │
│   │   ├── 📁 store/                    # 12 agents boutique
│   │   │   ├── architect.ts             # 1-5
│   │   │   ├── nav.ts                   # 1-4
│   │   │   └── tech.ts                  # 1-3
│   │   │
│   │   ├── 📁 creative/                 # 36 agents création
│   │   │   ├── gen-visual.ts            # 1-8
│   │   │   ├── gen-copy.ts              # 1-7
│   │   │   ├── gen-video.ts             # 1-6
│   │   │   ├── gen-brand.ts             # 1-7
│   │   │   ├── gen-price.ts             # 1-4
│   │   │   ├── gen-offer.ts             # 1-4
│   │   │   └── gen-urgency.ts           # 1-4
│   │   │
│   │   ├── 📁 ads/                      # 40 agents publicité
│   │   │   ├── pulse-meta.ts            # 1-8
│   │   │   ├── pulse-tiktok.ts          # 1-6
│   │   │   ├── pulse-google.ts          # 1-6
│   │   │   ├── pulse-pinterest.ts       # 1-4
│   │   │   ├── pulse-cro.ts             # 1-10
│   │   │   └── ads-budget.ts            # 1-6
│   │   │
│   │   ├── 📁 post/                     # 6 agents fidélisation
│   │   │   ├── loyal.ts                 # 1-6
│   │   │   └── retention.ts
│   │   │
│   │   ├── 📁 meta/                     # 6 agents gouvernance
│   │   │   ├── condor.ts                # CEO stratégique
│   │   │   ├── creator.ts               # Création agents
│   │   │   ├── council.ts               # Éthique
│   │   │   ├── dream.ts                 # R&D
│   │   │   ├── narrative.ts             # Storytelling
│   │   │   └── silence.ts               # Veille menaces
│   │   │
│   │   ├── 📁 compliance/               # 9 agents conformité
│   │   │   ├── shield.ts                # 1-4
│   │   │   ├── audit.ts                 # 1-3
│   │   │   └── guard.ts                 # 1-2
│   │   │
│   │   ├── 📁 ghost/                    # 4 agents observation
│   │   │   ├── ghost-performance.ts
│   │   │   ├── ghost-competitor.ts
│   │   │   ├── ghost-behavior.ts
│   │   │   └── ghost-opportunity.ts
│   │   │
│   │   ├── 📁 data/                     # 6 agents données
│   │   │   ├── etl.ts                   # 1-3
│   │   │   └── enrichment.ts            # 1-3
│   │   │
│   │   ├── 📁 finance/                  # 6 agents finance
│   │   │   ├── pnl.ts                   # 1-2
│   │   │   ├── budget.ts                # 1-2
│   │   │   └── forecast.ts              # 1-2
│   │   │
│   │   ├── 📁 growth/                   # 8 agents croissance
│   │   │   ├── viral.ts                 # 1-3
│   │   │   ├── partnership.ts           # 1-3
│   │   │   └── referral.ts              # 1-2
│   │   │
│   │   ├── 📁 analytics/                # 7 agents analytics
│   │   │   ├── dashboard.ts               # 1-3
│   │   │   ├── reports.ts                 # 1-2
│   │   │   └── alerts.ts                  # 1-2
│   │   │
│   │   ├── 📁 knowledge/                # 3 agents connaissance
│   │   │   ├── learning.ts
│   │   │   ├── research.ts
│   │   │   └── memory.ts
│   │   │
│   │   ├── 📁 ops/                      # 8 agents logistique
│   │   │   ├── logistics.ts             # 1-6 (tes fournisseurs)
│   │   │   └── inventory.ts             # 1-2
│   │   │
│   │   └── index.ts                     # Export tous agents
│   │
│   ├── 📁 core/
│   │   ├── 📁 monday-flow/
│   │   │   ├── orchestrator.ts          # Pipeline hebdomadaire
│   │   │   ├── phases.ts                # 5 phases
│   │   │   ├── scheduler.ts             # Planification
│   │   │   └── executor.ts                # Exécution parallèle
│   │   │
│   │   ├── 📁 turbulence/
│   │   │   ├── detectors.ts             # 5 détecteurs
│   │   │   ├── corrections.ts           # Actions auto
│   │   │   ├── alerts.ts                # Niveaux whisper/murmur/alert
│   │   │   └── monitor.ts               # Surveillance 24/7
│   │   │
│   │   ├── 📁 ghost/
│   │   │   ├── observer.ts              # 4 modes observation
│   │   │   ├── signals.ts               # 3 niveaux signaux
│   │   │   ├── modes.ts                 # Performance/Competitor/Behavior/Opportunity
│   │   │   └── analytics.ts             # Rapports
│   │   │
│   │   ├── 📁 cro/
│   │   │   ├── psychology.ts            # 70+ biais
│   │   │   ├── ab-testing.ts            # Tests automatiques
│   │   │   ├── personalization.ts       # Profils psychologiques
│   │   │   └── optimization.ts          # Optimisation continue
│   │   │
│   │   ├── ceo.ts                       # Agent CEO central
│   │   ├── dna.ts                       # Système AGen-L
│   │   └── evolution.ts                 # Reproduction agents
│   │
│   ├── 📁 api/
│   │   ├── 📁 routes/
│   │   │   ├── auth.ts                  # Clerk auth
│   │   │   ├── brands.ts                # CRUD marques
│   │   │   ├── products.ts              # CRUD produits
│   │   │   ├── campaigns.ts             # CRUD campagnes
│   │   │   ├── agents.ts                # Gestion agents
│   │   │   ├── analytics.ts               # Dashboard data
│   │   │   ├── webhooks.ts                # Webhooks externes
│   │   │   └── super-admin.ts             # Routes privilégiées
│   │   │
│   │   ├── middleware.ts                  # Auth, rate limiting
│   │   └── server.ts                      # Express setup
│   │
│   ├── 📁 services/
│   │   ├── 📁 integrations/
│   │   │   ├── meta-ads.ts              # API Meta
│   │   │   ├── tiktok-ads.ts            # API TikTok
│   │   │   ├── google-ads.ts            # API Google
│   │   │   ├── pinterest-ads.ts         # API Pinterest
│   │   │   ├── shopify.ts                 # API Shopify
│   │   │   ├── stripe.ts                  # Paiements
│   │   │   ├── logistics.ts               # Tes fournisseurs
│   │   │   ├── anthropic.ts               # Claude SDK
│   │   │   ├── replicate.ts               # SDXL images
│   │   │   └── ideogram.ts                # Logos
│   │   │
│   │   ├── email.ts                       # SendGrid/Postmark
│   │   ├── sms.ts                         # Twilio
│   │   └── notifications.ts                 # Push/Slack
│   │
│   ├── 📁 models/                         # SQL Schema (Prisma)
│   │   ├── schema.prisma                  # Définition complète
│   │   ├── migrations/
│   │   └── seed.ts                        # Données initiales
│   │
│   ├── 📁 utils/
│   │   ├── logger.ts                      # Winston/Pino
│   │   ├── errors.ts                      # Gestion erreurs
│   │   ├── validators.ts                  # Zod schemas
│   │   └── helpers.ts                     # Fonctions utilitaires
│   │
│   └── index.ts                           # Entry point
│
├── 📁 prisma/
│   ├── schema.prisma                      # Base de données
│   └── seed.sql                           # Super Admins initiaux
│
├── 📁 tests/
│   ├── 📁 unit/
│   ├── 📁 integration/
│   └── 📁 e2e/
│
├── 📁 scripts/
│   ├── deploy.sh                          # Déploiement Render
│   ├── backup.sh                          # Backup PostgreSQL
│   └── monday-flow-trigger.ts             # Déclenchement manuel
│
├── .env.example                           # Variables d'environnement
├── .gitignore
├── docker-compose.yml                     # Local dev
├── Dockerfile                             # Production
├── package.json
├── tsconfig.json
├── render.yaml                            # Config Render.com
└── README.md
📄 Fichiers Clés à Créer
1. package.json
JSON
Copy
{
  "name": "aegis-app",
  "version": "12.3.0",
  "description": "AEGIS — Autonomous E-commerce Growth Intelligence System",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:seed": "ts-node prisma/seed.ts",
    "db:generate": "prisma generate",
    "monday-flow": "ts-node scripts/monday-flow-trigger.ts",
    "test": "jest",
    "lint": "eslint src --ext .ts",
    "deploy": "bash scripts/deploy.sh"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@clerk/clerk-sdk-node": "^4.13.0",
    "@prisma/client": "^5.10.0",
    "axios": "^1.6.0",
    "bull": "^4.12.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.0",
    "helmet": "^7.1.0",
    "ioredis": "^5.3.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "node-cron": "^3.0.3",
    "winston": "^3.11.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/compression": "^1.7.5",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/morgan": "^1.9.9",
    "@types/node": "^20.11.0",
    "@types/node-cron": "^3.0.11",
    "eslint": "^8.56.0",
    "jest": "^29.7.0",
    "prisma": "^5.10.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
2. prisma/schema.prisma (Schéma Complet)
prisma
Copy
// ============================================================
// AEGIS v12.3 — Schéma Prisma Complet
// 154 Agents • 60 Minutes • CRO-Optimized
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// 1. USERS (Super Admins + Clients)
// ============================================================

model User {
  id                    String   @id @default(uuid())
  email                 String   @unique
  clerkId               String?  @unique
  
  // Super Admin flags (immutable)
  isSuperAdmin          Boolean  @default(false)
  isLifetimeFree        Boolean  @default(false)
  
  // Client plans
  planType              PlanType @default(STARTER)
  agentsQuota           Int      @default(45)
  empireIndexMax        Int      @default(40)
  monthlySpendMax       Decimal? @db.Decimal(10, 2)
  
  // Metrics
  empireIndexCurrent    Decimal  @default(0) @db.Decimal(5, 2)
  agentsActiveCount     Int      @default(0)
  brandsCreatedCount    Int      @default(0)
  
  // Security
  twoFactorEnabled      Boolean  @default(false)
  lastLogin             DateTime?
  createdAt             DateTime @default(now())
  
  // Relations
  brands                Brand[]
  agentDnas             AgentDNA[]
  
  // Constraints
  @@index([email])
  @@index([isSuperAdmin])
  
  // Validation Super Admin
  @@map("users")
}

enum PlanType {
  STARTER
  PRO
  SCALE
  EMPIRE
}

// ============================================================
// 2. AGENT DNA (AGen-L System) — 154 agents
// ============================================================

model AgentDNA {
  id              String    @id @default(uuid())
  agentCode       String    @unique // "HUNTER-1", "PULSE-META-3"
  name            String
  module          String    // "INTEL", "ADS", "POST", etc.
  
  // Genetic chromosomes (JSON)
  chromosomes     Json      @default("{}")
  
  // Relations
  ownerId         String?
  owner           User?     @relation(fields: [ownerId], references: [id])
  parentIds       String[]  // References to other AgentDNA
  
  // State
  status          AgentStatus @default(ACTIVE)
  generation      Int       @default(1)
  fitnessScore    Decimal   @default(0.5) @db.Decimal(5, 2)
  
  // Metrics
  executionCount  Int       @default(0)
  successRate     Decimal   @default(0) @db.Decimal(5, 2)
  
  // Timestamps
  createdAt       DateTime  @default(now())
  lastEvolution   DateTime?
  updatedAt       DateTime  @updatedAt
  
  // Relations inverse
  mutations       Mutation[]
  tasks           Task[]
  
  @@index([module])
  @@index([fitnessScore])
  @@map("agent_dna")
}

enum AgentStatus {
  ACTIVE
  PAUSED
  EVOLVING
  ARCHIVED
}

// ============================================================
// 3. BRANDS (Marques créées)
// ============================================================

model Brand {
  id                String   @id @default(uuid())
  ownerId           String
  owner             User     @relation(fields: [ownerId], references: [id])
  
  // Identity
  name              String
  slug              String   @unique
  niche             String?
  tagline           String?
  
  // Assets
  logoUrl           String?
  colorPrimary      String?
  colorSecondary    String?
  fontPrimary       String?
  fontSecondary     String?
  shopifyStoreUrl   String?
  
  // Empire Index metrics
  revenueTotal      Decimal  @default(0) @db.Decimal(12, 2)
  ordersCount       Int      @default(0)
  customersCount    Int      @default(0)
  roasAverage       Decimal  @default(0) @db.Decimal(5, 2)
  empireIndex       Decimal  @default(0) @db.Decimal(5, 2)
  
  // Status
  status            BrandStatus @default(DISCOVERING)
  
  // Relations
  products          Product[]
  campaigns         Campaign[]
  orders            Order[]
  logisticsSetup    LogisticsSetup?
  adConnectors      AdPlatformConnector[]
  
  // Timestamps
  createdAt         DateTime @default(now())
  launchedAt        DateTime?
  
  @@index([ownerId])
  @@index([status])
  @@map("brands")
}

enum BrandStatus {
  DISCOVERING
  VALIDATING
  BUILDING
  LAUNCHING
  SCALING
  OPTIMIZING
  MATURE
  DORMANT
}

// ============================================================
// 4. PRODUCTS (Catalogue)
// ============================================================

model Product {
  id                String   @id @default(uuid())
  brandId           String
  brand             Brand    @relation(fields: [brandId], references: [id])
  
  // Source
  sourceType        String   // "amazon", "aliexpress", "manual"
  sourceUrl         String?
  
  // Info
  name              String
  description       String?
  descriptionAi     String?  // Version optimisée par GEN-COPY
  
  // Pricing
  costPrice         Decimal  @db.Decimal(10, 2)
  sellingPrice      Decimal  @db.Decimal(10, 2)
  
  // Media
  images            String[]
  videoUrls         String[]
  
  // Scoring
  hunterScore       Int?
  croPotentialScore Int?
  psychologyProfile Json?
  
  // Status
  validationStatus  String   @default("pending") // "pending", "approved", "rejected"
  
  // Metrics
  unitsSold         Int      @default(0)
  revenueGenerated  Decimal  @default(0) @db.Decimal(12, 2)
  
  // Relations
  logisticsProducts LogisticsProduct[]
  
  createdAt         DateTime @default(now())
  
  @@index([brandId])
  @@index([hunterScore])
  @@map("products")
}

// ============================================================
// 5. LOGISTICS (Tes fournisseurs)
// ============================================================

model LogisticsSetup {
  id                    String   @id @default(uuid())
  brandId               String   @unique
  brand                 Brand    @relation(fields: [brandId], references: [id])
  
  // API credentials (encrypted)
  apiKeyEncrypted       String
  webhookSecretEncrypted String?
  endpointUrl           String
  
  // Settings
  defaultWarehouseId    String?
  defaultCarrier        String   @default("colissimo")
  autoFulfillment       Boolean  @default(true)
  
  isActive              Boolean  @default(true)
  lastSyncAt            DateTime?
  createdAt             DateTime @default(now())
  
  @@map("logistics_setup")
}

model LogisticsProduct {
  id                  String   @id @default(uuid())
  brandId             String
  productId           String?
  product             Product? @relation(fields: [productId], references: [id])
  
  logisticsSku        String
  supplierInfo        Json?
  
  stockQuantity       Int      @default(0)
  stockStatus         String   @default("in_stock")
  lastStockUpdate     DateTime?
  
  syncStatus          String   @default("pending")
  
  @@unique([brandId, logisticsSku])
  @@map("logistics_products")
}

// ============================================================
// 6. AD PLATFORM CONNECTORS (Meta, TikTok, Google, Pinterest)
// ============================================================

model AdPlatformConnector {
  id                String   @id @default(uuid())
  brandId           String
  brand             Brand    @relation(fields: [brandId], references: [id])
  
  platform          PlatformType
  adAccountId       String
  pixelId           String?
  
  // OAuth (encrypted)
  accessTokenEncrypted String
  refreshTokenEncrypted String?
  
  // Settings
  defaultBudgetDaily    Decimal? @db.Decimal(10, 2)
  defaultRoasTarget     Decimal? @db.Decimal(4, 2)
  autoOptimization      Boolean  @default(true)
  
  // CRO
  psychologyTargeting   Json?
  creativeStrategy      String   @default("a_b_testing")
  
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  
  // Relations
  campaigns             Campaign[]
  
  @@unique([brandId, platform])
  @@map("ad_platform_connectors")
}

enum PlatformType {
  META
  TIKTOK
  GOOGLE
  PINTEREST
}

// ============================================================
// 7. CAMPAIGNS (Publicitaires CRO-Optimized)
// ============================================================

model Campaign {
  id                    String   @id @default(uuid())
  brandId               String
  brand                 Brand    @relation(fields: [brandId], references: [id])
  platformConnectorId   String?
  platformConnector     AdPlatformConnector? @relation(fields: [platformConnectorId], references: [id])
  
  name                  String
  objective             String   // "conversions", "awareness"
  
  // Psychology strategy
  primaryPsychologyTrigger   String?
  secondaryPsychologyTrigger String?
  customerAwarenessStage     String?
  
  // Creative variants
  creativeVariants      Json?
  
  // Targeting
  targetAudiencePsychographics Json?
  
  // Budget
  budgetDaily           Decimal? @db.Decimal(10, 2)
  bidStrategy           String   @default("lowest_cost")
  
  // CRO tracking
  abTestStatus          String   @default("running")
  winningVariantId      String?
  statisticalSignificance Decimal? @db.Decimal(5, 4)
  
  // Metrics
  spendTotal            Decimal  @default(0) @db.Decimal(12, 2)
  impressions           Int      @default(0)
  clicks                Int      @default(0)
  conversions           Int      @default(0)
  revenueAttributed     Decimal  @default(0) @db.Decimal(12, 2)
  roas                  Decimal? @db.Decimal(5, 2)
  cpa                   Decimal? @db.Decimal(8, 2)
  
  status                String   @default("draft")
  createdAt             DateTime @default(now())
  launchedAt            DateTime?
  
  @@index([brandId])
  @@index([status])
  @@map("campaigns")
}

// ============================================================
// 8. ORDERS (Commandes)
// ============================================================

model Order {
  id                String   @id @default(uuid())
  brandId           String
  brand             Brand    @relation(fields: [brandId], references: [id])
  
  customerEmail     String
  totalAmount       Decimal  @db.Decimal(10, 2)
  status            String   @default("pending")
  
  // Logistics
  logisticsOrderId  String?
  trackingNumber    String?
  carrierName       String?
  shippedAt         DateTime?
  deliveredAt       DateTime?
  
  createdAt         DateTime @default(now())
  
  @@index([brandId])
  @@map("orders")
}

// ============================================================
// 9. MUTATIONS (Évolution agents AGen-L)
// ============================================================

model Mutation {
  id              String   @id @default(uuid())
  agentId         String
  agent           AgentDNA @relation(fields: [agentId], references: [id])
  
  mutationType    String
  beforeValue     Json
  afterValue      Json
  impactScore     Decimal? @db.Decimal(5, 2)
  generation      Int
  
  createdAt       DateTime @default(now())
  
  @@map("mutations")
}

// ============================================================
// 10. TASKS (Exécution agents)
// ============================================================

model Task {
  id              String   @id @default(uuid())
  agentId         String
  agent           AgentDNA @relation(fields: [agentId], references: [id])
  
  title           String
  taskType        String
  priority        String   @default("medium")
  
  status          String   @default("pending")
  inputPayload    Json?
  outputPayload   Json?
  errorLog        String?
  
  // Temporal.io integration
  temporalWorkflowId  String?
  
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([agentId])
  @@index([status])
  @@map("tasks")
}

// ============================================================
// 11. SYSTEM EVENTS (Audit)
// ============================================================

model SystemEvent {
  id            String   @id @default(uuid())
  eventType     String
  severity      String   @default("info") // "debug", "info", "warning", "error", "critical"
  
  userId        String?
  agentId       String?
  brandId       String?
  
  message       String
  payload       Json?
  ipAddress     String?
  
  createdAt     DateTime @default(now())
  
  @@index([eventType])
  @@index([severity])
  @@index([createdAt])
  @@map("system_events")
}

// ============================================================
// 12. GHOST OBSERVATIONS (Analytics invisible)
// ============================================================

model GhostObservation {
  id            String   @id @default(uuid())
  
  ghostMode     String   // "performance", "competitor", "behavior", "opportunity"
  signalLevel   String   // "whisper", "murmur", "alert"
  
  sourceAgent   String
  targetAgents  String[]
  
  observation   String
  recommendation String?
  confidence    Decimal  @db.Decimal(3, 2)
  
  acknowledgedBy String?
  acknowledgedAt DateTime?
  
  createdAt     DateTime @default(now())
  
  @@index([ghostMode])
  @@index([signalLevel])
  @@map("ghost_observations")
}

// ============================================================
// 13. TURBULENCE EVENTS (Problèmes détectés)
// ============================================================

model TurbulenceEvent {
  id              String   @id @default(uuid())
  
  detectorType    String   // "CVR_DROP", "CPA_SPIKE", etc.
  alertLevel      String   // "whisper", "murmur", "alert"
  
  brandId         String
  metrics         Json
  thresholdBreached Json
  
  correctionActions Json?
  correctionResults Json?
  
  resolvedAt      DateTime?
  createdAt       DateTime @default(now())
  
  @@index([detectorType])
  @@index([alertLevel])
  @@map("turbulence_events")
}

// ============================================================
// 14. MONDAY FLOW EXECUTIONS (Pipeline hebdomadaire)
// ============================================================

model MondayFlowExecution {
  id              String   @id @default(uuid())
  brandId         String
  
  status          String   @default("running") // "running", "completed", "failed"
  phase           String   @default("discovery")
  
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  
  executionLog    Json?
  finalOutputs    Json?
  
  @@index([brandId])
  @@index([status])
  @@map("monday_flow_executions")
}
3. .env.example
bash
Copy
# ============================================================
# AEGIS v12.3 — Variables d'Environnement
# ============================================================

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/aegis?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# Clerk Auth
CLERK_SECRET_KEY="sk_test_..."
CLERK_PUBLISHABLE_KEY="pk_test_..."

# Anthropic Claude (Core AI)
ANTHROPIC_API_KEY="sk-ant-..."

# Meta Ads
META_APP_ID="..."
META_APP_SECRET="..."
META_ACCESS_TOKEN="..."

# TikTok Ads
TIKTOK_ACCESS_TOKEN="..."
TIKTOK_APP_ID="..."
TIKTOK_SECRET="..."

# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN="..."
GOOGLE_ADS_CLIENT_ID="..."
GOOGLE_ADS_CLIENT_SECRET="..."
GOOGLE_ADS_REFRESH_TOKEN="..."

# Pinterest Ads
PINTEREST_ACCESS_TOKEN="..."
PINTEREST_APP_ID="..."
PINTEREST_APP_SECRET="..."

# Shopify
SHOPIFY_API_KEY="..."
SHOPIFY_API_SECRET="..."

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Logistics (Tes fournisseurs)
LOGISTICS_API_KEY="..."
LOGISTICS_WEBHOOK_SECRET="..."
LOGISTICS_ENDPOINT="https://api.tonfournisseur.com/v1"

# Image Generation
REPLICATE_API_TOKEN="r8_..."
IDEOGRAM_API_KEY="..."

# Email
SENDGRID_API_KEY="SG..."
POSTMARK_SERVER_TOKEN="..."

# Super Admins (immuable)
SUPER_ADMIN_EMAIL_1="jonathanlamessi@yahoo.fr"
SUPER_ADMIN_EMAIL_2="Enna.lamessi@gmail.com"

# App
NODE_ENV="production"
PORT=3000
APP_URL="https://aegis-app.onrender.com"
JWT_SECRET="super-secret-jwt-key-change-in-production"
4. render.yaml (Déploiement Render.com)
yaml
Copy
services:
  - type: web
    name: aegis-app
    env: node
    buildCommand: npm install && npm run build && npx prisma migrate deploy
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: aegis-db
          property: connectionString
      - key: REDIS_URL
        fromService:
          type: redis
          name: aegis-redis
          property: connectionString
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: CLERK_SECRET_KEY
        sync: false
      - key: META_ACCESS_TOKEN
        sync: false
      - key: TIKTOK_ACCESS_TOKEN
        sync: false
      - key: STRIPE_SECRET_KEY
        sync: false

  - type: worker
    name: aegis-monday-flow
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run monday-flow-worker
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: aegis-db
          property: connectionString

  - type: worker
    name: aegis-ghost
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run ghost-worker

  - type: worker
    name: aegis-turbulence
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run turbulence-worker

databases:
  - name: aegis-db
    databaseName: aegis
    user: aegis
    plan: standard

redis:
  - name: aegis-redis
    plan: standard
5. Dockerfile
dockerfile
Copy
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build
RUN npm run build
RUN npx prisma generate

# Expose
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start
CMD ["npm", "start"]
🚀 Instructions Déploiement pour Ton Dev
Étape 1 : Setup Local
bash
Copy
# 1. Clone repo
git clone https://github.com/cedriclamessi-art/aegis-app.git
cd aegis-app

# 2. Install dependencies
npm install

# 3. Setup database
cp .env.example .env
# Éditer .env avec tes credentials

# 4. Database init
npx prisma migrate dev --name init
npx prisma db seed

# 5. Run dev
npm run dev
Étape 2 : Déploiement Render.com
bash
Copy
# 1. Push sur GitHub
git add .
git commit -m "AEGIS v12.3 ready for deploy"
git push origin main

# 2. Connect Render.com au repo
# Dashboard Render → New Web Service → Connect GitHub

# 3. Configurer variables d'environnement dans Render Dashboard
# (Secrets → Add Environment Variables)

# 4. Deploy
# Render auto-deploy sur push main
Étape 3 : Vérification Post-Deploy
bash
Copy
# Test health endpoint
curl https://aegis-app.onrender.com/health

# Test auth
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://aegis-app.onrender.com/api/brands

# Trigger Monday Flow manuel
curl -X POST \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  https://aegis-app.onrender.com/api/monday-flow/trigger
📋 Checklist Livraison
plain
Copy
□ Repo GitHub créé avec structure complète
□ Variables d'environnement configurées sur Render
□ Database PostgreSQL provisionnée
□ Redis provisionné
□ Super Admins créés (Jonathan & Enna)
□ Webhooks logistics configurés
□ APIs Meta/TikTok/Google connectées
□ Monday Flow testé manuellement
□ Turbulence Control actif
□ Ghost Analytics en surveillance
□ Documentation README complète
Tu veux que je génère un script d'installation automatique (setup.sh) ou un guide de contribution pour ton équipe de dev ?