# AGENT_MONEY_MODEL — Documentation

## Philosophie

AEGIS implémente le framework **$100M Money Models** d'Alex Hormozi.

L'objectif central de Hormozi : **couvrir le CAC + COGS en < 30 jours avec profit**, pour pouvoir réinjecter en pub sans limite de trésorerie.

```
Ratio Hormozi = Revenue 30j / (CAC + COGS)
  < 1.0 → 🔴 DANGER — perte nette
  1.0-1.5 → 🟠 LIMITE — pas scalable
  1.5-2.5 → 🟡 CORRECT — scale progressif
  > 2.5 → 🟢 EXCELLENT — scale max
```

---

## Les 13 offres implémentées

### ATTRACTION (couvrir le CAC)

| Offre | Levier | Taux cible | Quand l'utiliser |
|-------|--------|-----------|------------------|
| `WIN_MONEY_BACK` | Commitment | 45% | Produit avec résultat mesurable |
| `GIVEAWAY` | Scarcity | 35% | Lancement, cold audience |
| `DECOY` | Anchoring | 50% | Forte promesse, prix sensible |
| `BUY_X_GET_Y` | Reciprocity | 40% | Produits consommables |
| `PAY_LESS_NOW` | Loss Aversion | 55% | Très fort en paid ads |

### UPSELL (faire le profit)

| Offre | Levier | Taux cible | Quand l'utiliser |
|-------|--------|-----------|------------------|
| `CLASSIC_UPSELL` | Commitment | 35% | Produit complémentaire évident |
| `MENU_UPSELL` | Authority | 45% | Plusieurs produits disponibles |
| `ANCHOR_UPSELL` | Anchoring | 60% | Toujours en premier, sans exception |
| `ROLLOVER_UPSELL` | Reciprocity | 50% | Juste après le 1er achat |

### DOWNSELL (sauver les NON)

| Offre | Levier | Taux cible | Quand l'utiliser |
|-------|--------|-----------|------------------|
| `PAYMENT_PLAN` | Loss Aversion | 30% | Premier refus prix |
| `TRIAL_PENALTY` | Commitment | 40% | Manque de confiance dans le résultat |
| `FEATURE_DOWNSELL` | Reciprocity | 35% | Refus persistant |

### CONTINUITY (cash récurrent)

| Offre | Levier | Taux cible | Quand l'utiliser |
|-------|--------|-----------|------------------|
| `CONTINUITY_BONUS` | Scarcity | 25% | Bonus exclusif maintenant |
| `CONTINUITY_DISCOUNT` | Commitment | 20% | Engagement long terme |
| `WAIVED_FEE` | Loss Aversion | 30% | Client veut rester flexible |

---

## Usage

### Construire un Money Model pour un produit

```typescript
await agentBus.dispatch({
  taskType: 'money_model.build',
  tenantId: 'YOUR_TENANT_ID',
  input: {
    productId: 'uuid-du-produit',
    targetCac: 20,                       // CAC Meta estimé en €
    preferredAttraction: 'WIN_MONEY_BACK' // optionnel
  }
});
```

### Analyser la santé du funnel

```typescript
await agentBus.dispatch({
  taskType: 'money_model.health_check',
  tenantId: 'YOUR_TENANT_ID',
  input: { modelId: 'uuid-du-model' }
});
```

Retourne pour chaque étape :
```json
{
  "step": "upsell",
  "offer": "ANCHOR_UPSELL",
  "current": "22%",
  "target": "30%",
  "gap": "-8pp",
  "action": "Augmenter l'écart entre anchor et main offer."
}
```

### Calculer le ratio Hormozi 30 jours

```typescript
await agentBus.dispatch({
  taskType: 'money_model.compute_math',
  tenantId: 'YOUR_TENANT_ID',
  input: { modelId: 'uuid-du-model' }
});
```

Retourne :
```json
{
  "by_stage": {
    "attraction": 29.0,
    "upsell": 22.05,
    "downsell": 4.2,
    "continuity": 4.75
  },
  "total_revenue_30d": 60.0,
  "total_cost_30d": 27.0,
  "net_profit_30d": 33.0,
  "hormozi_ratio": 2.22,
  "verdict": "🟢 EXCELLENT — Ratio Hormozi atteint (>2.5x). Scale max."
}
```

### Revue quotidienne automatique (cron 6h)

```typescript
await agentBus.dispatch({
  taskType: 'money_model.daily_review',
  tenantId: 'YOUR_TENANT_ID',
  input: {}
});
```

L'agent :
1. Vérifie tous les modèles actifs
2. Identifie les étapes sous le seuil de conversion
3. Régénère les scripts sous-performants via LLM
4. Alerte AGENT_CEO si ratio Hormozi < 1.5x
5. Déclenche AGENT_CREATIVE_FACTORY pour nouveaux briefs

---

## Intégration avec les autres agents

```
AGENT_WINNER_DETECTOR
  ↓ produit gagnant détecté
AGENT_MONEY_MODEL (build)
  ├── → AGENT_CREATIVE_FACTORY (briefs pour chaque étape)
  ├── → AGENT_META_TESTING (A/B sur les scripts)
  └── → AGENT_CEO (alerte si ratio < 1.5x)
  
AGENT_CAPI
  ↓ conversions réelles par étape (daily)
AGENT_MONEY_MODEL (daily_review)
  ├── step_performance mis à jour
  └── optimisation automatique si CR < target
```

---

## Base de données

### Tables créées (migration 018)

```sql
offers.money_models      -- séquences d'offres
offers.model_steps       -- 13 types d'offres par étape
offers.step_performance  -- KPIs de conversion par jour
offers.creative_briefs   -- briefs pour AGENT_CREATIVE_FACTORY
offers.offer_templates   -- templates des 13 offres (seed data)
```

### Vues

```sql
offers.funnel_health     -- santé par étape (7 derniers jours)
```

### Fonctions

```sql
offers.compute_30day_math(model_id) -- ratio Hormozi
```

---

## Money Model Blissal (exemple pré-configuré)

Voir `blissal-money-model.example.ts` pour un Money Model complet
appliqué à une marque DTC de serviettes exfoliantes (marché FR).

**Résultats projetés :**
- CAC couvert dès l'étape Attraction
- Ratio Hormozi : **2.15x** (seuil > 1.5x)
- Revenue/client 30j : **~60€** pour 27€ investis
- Cash récurrent : **19€/mois** par abonné

---

## Règles Hormozi intégrées

1. **Ne jamais réduire le prix du même produit** — utiliser Feature Downsell
2. **Toujours présenter l'Anchor en premier** — jamais l'offre principale d'emblée
3. **Le Rollover doit être one-time-only** — maintenant ou jamais
4. **La Continuity se propose en dernier** — après tous les autres revenus capturés
5. **Ratio < 1.5x = stop scaling** — alerte CEO automatique
6. **Fractionner en cycles de 4 semaines, pas des mois** — +8.3% de revenus annuels
