# AEGIS SUPREMATIE - Monolithic App

**225 Agents IA E-Commerce Platform** - Prêt à déployer sur Render

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL (via Docker)

### Installation

```bash
# Clone & install
git clone <repo>
cd aegis-app
npm install

# Setup environment
cp .env.example .env

# Start database
docker compose up -d

# Setup database
npx prisma db push

# Run dev server
npm run dev
```

Open http://localhost:3000

## 🌐 Deploy on Render

### 1. Connect Repository
- Go to [render.com](https://render.com)
- Click "New +" → "Web Service"
- Connect your GitHub repo

### 2. Configure Service

| Setting | Value |
|---------|-------|
| **Name** | aegis-app |
| **Environment** | Node |
| **Build Command** | `npm install && npx prisma db push && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Standard ($7/month) |

### 3. Add Environment Variables

```
DATABASE_URL=postgresql://user:pass@host/db
REDIS_URL=redis://host:port
JWT_SECRET=your-secret-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
NEXT_PUBLIC_APP_URL=https://your-app.render.com
NODE_ENV=production
FOUNDER_EMAILS=jonathanlamessi@yahoo.fr,enna.lamessi@gmail.com
```

### 4. Add PostgreSQL Database

- In Render dashboard, create a new PostgreSQL database
- Copy connection string to `DATABASE_URL`

### 5. Deploy

Click "Create Web Service" - Render will automatically deploy!

## 📊 Features

- ✅ **Authentication** (JWT + Sessions)
- ✅ **Dashboard** (KPIs, Charts)
- ✅ **Product Analyzer** (Radar 360°)
- ✅ **Brand Studio** (Creative Generation)
- ✅ **Campaigns** (Management & Scaling)
- ✅ **Billing** (Stripe Integration)
- ✅ **225 Agents IA** (Distributed)

## 🏗️ Architecture

```
aegis-app/
├── src/
│   ├── pages/          # Next.js pages + API routes
│   ├── components/     # React components
│   ├── lib/            # Utilities (auth, db, config)
│   └── styles/         # Global CSS
├── prisma/             # Database schema
├── public/             # Static assets
├── Dockerfile          # Container config
└── docker-compose.yml  # Local dev setup
```

## 🔐 Authentication

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password",
  "name": "John Doe"
}
```

### Get Current User
```bash
GET /api/auth/me
```

## 💳 Pricing Tiers

| Tier | Price | Agents | Daily Max |
|------|-------|--------|-----------|
| Radar | €99/mo | 20 | €100 |
| Brand | €199/mo | 40 | €500 |
| Executive | €999/mo | 75 | €2000 |
| Suprématie | €2999/mo | 225 | €10000 |

**Founders** (free forever):
- jonathanlamessi@yahoo.fr
- enna.lamessi@gmail.com

## 📝 Database

### Schema
- **Users** - Authentication & subscriptions
- **Products** - Analyzed products
- **Campaigns** - Marketing campaigns
- **Payments** - Stripe transactions
- **ApiLogs** - Request tracking

### Migrations
```bash
# Generate migration
npx prisma migrate dev --name add_feature

# Apply migration
npx prisma db push

# View database
npx prisma studio
```

## 🧪 Testing

```bash
# Run tests
npm test

# Check types
npx tsc --noEmit

# Lint
npm run lint
```

## 🐛 Troubleshooting

### Database connection error
```bash
# Check DATABASE_URL in .env
# Make sure PostgreSQL is running
docker compose ps
```

### Build fails on Render
- Check build logs in Render dashboard
- Verify Node version compatibility
- Ensure all env vars are set

### Port already in use
```bash
# Kill process on port 3000
lsof -i :3000
kill -9 <PID>
```

## 📞 Support

Email: support@aegis-suprematie.com

## 📄 License

MIT

---

**AEGIS SUPREMATIE = 50€ → 20k€ CA/semaine (si perf)**
