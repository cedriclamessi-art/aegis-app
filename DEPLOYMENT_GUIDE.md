# AEGIS SUPREMATIE - Render Deployment Guide

## 🚀 Step-by-Step Deployment on Render

### Prerequisites
- GitHub account with repo pushed
- Render account (https://render.com)
- Stripe account (for payments)

---

## Step 1: Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit: AEGIS SUPREMATIE monolithic app"
git branch -M main
git remote add origin https://github.com/yourusername/aegis-app.git
git push -u origin main
```

---

## Step 2: Create PostgreSQL Database on Render

1. Go to [render.com](https://render.com) dashboard
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `aegis-db`
   - **Database**: `aegis`
   - **User**: `aegis`
   - **Region**: Choose closest to you
   - **Plan**: Standard ($15/month)
4. Click **"Create Database"**
5. Copy the **Internal Database URL** (you'll need this)

---

## Step 3: Create Web Service

1. Click **"New +"** → **"Web Service"**
2. Select your GitHub repo
3. Configure:
   - **Name**: `aegis-app`
   - **Environment**: `Node`
   - **Build Command**: 
     ```
     npm install && npx prisma db push && npm run build
     ```
   - **Start Command**: 
     ```
     npm start
     ```
   - **Plan**: Standard ($7/month)

---

## Step 4: Add Environment Variables

In the Web Service settings, add these environment variables:

| Key | Value | Notes |
|-----|-------|-------|
| `DATABASE_URL` | `postgresql://...` | From PostgreSQL service |
| `NODE_ENV` | `production` | |
| `JWT_SECRET` | Generate a random string | Use: `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | `https://aegis-app.onrender.com` | Replace with your URL |
| `STRIPE_SECRET_KEY` | `sk_test_...` | From Stripe dashboard |
| `STRIPE_PUBLIC_KEY` | `pk_test_...` | From Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe dashboard |
| `FOUNDER_EMAILS` | `jonathanlamessi@yahoo.fr,enna.lamessi@gmail.com` | |

---

## Step 5: Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Build the app
   - Run migrations
   - Deploy to production

Monitor the deployment in the **Logs** tab.

---

## Step 6: Verify Deployment

Once deployed:

1. Go to your app URL: `https://aegis-app.onrender.com`
2. Create an account
3. Test login/signup flow
4. Check dashboard loads

---

## 🔗 Stripe Webhook Setup

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. **Developers** → **Webhooks**
3. Click **"Add endpoint"**
4. Endpoint URL: `https://aegis-app.onrender.com/api/webhooks/stripe`
5. Events to send:
   - `payment_intent.succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Copy **Signing secret** → Add to `STRIPE_WEBHOOK_SECRET`

---

## 🔄 Auto-Redeploy on Git Push

Render automatically redeploys when you push to `main`:

```bash
git add .
git commit -m "Update feature"
git push origin main
```

---

## 📊 Monitoring

### Logs
- Go to Web Service → **Logs** tab
- Real-time logs of your app

### Metrics
- Go to Web Service → **Metrics** tab
- CPU, Memory, Requests, Response time

### Database
- Go to PostgreSQL service → **Connect** tab
- Connection info and backups

---

## 🐛 Troubleshooting

### Build fails
```
Error: prisma db push failed
```
**Solution**: Check `DATABASE_URL` is correct

### App crashes on startup
```
Error: Cannot find module 'next'
```
**Solution**: Check `npm install` runs in build command

### Database connection timeout
```
Error: connect ECONNREFUSED
```
**Solution**: Ensure PostgreSQL service is running and `DATABASE_URL` is set

### Stripe webhook not working
```
Error: Invalid signature
```
**Solution**: Verify `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard

---

## 💰 Estimated Costs (Monthly)

| Service | Cost | Notes |
|---------|------|-------|
| Web Service | $7 | Standard plan |
| PostgreSQL | $15 | Standard plan |
| **Total** | **$22** | Plus Stripe fees (2.9% + $0.30) |

---

## 🎯 Next Steps

1. **Custom Domain**
   - Go to Web Service → **Settings**
   - Add custom domain (requires DNS setup)

2. **SSL Certificate**
   - Render provides free SSL (automatic)

3. **Backups**
   - PostgreSQL → **Backups** tab
   - Configure automatic daily backups

4. **Scaling**
   - If traffic increases, upgrade to Pro plan
   - Render handles scaling automatically

---

## 📞 Support

- **Render Docs**: https://render.com/docs
- **Stripe Docs**: https://stripe.com/docs
- **Next.js Docs**: https://nextjs.org/docs

---

## ✅ Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] PostgreSQL database created
- [ ] Web Service created
- [ ] All environment variables set
- [ ] Build succeeds
- [ ] App loads at https://aegis-app.onrender.com
- [ ] Login/signup works
- [ ] Stripe webhook configured
- [ ] Database migrations applied

---

**Deployment complete! 🎉**

Your AEGIS SUPREMATIE app is now live on Render.

---

*For questions: support@aegis-suprematie.com*
