# AEGIS — AGENT_CAPI : Server-Side Conversion Tracking

## Problème résolu

iOS 14.5+ (App Tracking Transparency) bloque ~40% des events côté client.
Sans CAPI, Meta reçoit seulement 60% des conversions réelles.
Conséquences directes sur AEGIS :

```
Pixel client voit 60% des conversions
        ↓
AGENT_META_TESTING calcule ROAS sur données tronquées
        ↓
AGENT_WINNER_DETECTOR tue des winners → scale des losers
        ↓
Budget brûlé — toute la logique de décision AEGIS est fausse
```

Le CAPI relay résout ce problème à la source.

---

## Architecture

```
Shopify Webhook (ordre/checkout/panier)
        ↓
AEGIS Backend (FastAPI)
  ├── Validation HMAC Shopify (timing-safe)
  ├── Idempotence via shopify_webhook_id
  └── Réponse 200 immédiate à Shopify (< 5s)
        ↓
CAPIRelay.relay() [asynchrone]
  ├── Génération event_id déterministe (SHA256)
  ├── Hashing données utilisateur (SHA256)
  └── Appels CAPI parallèles (Promise.allSettled)
      ├── Meta Conversions API  ─── response_meta JSONB
      ├── TikTok Events API     ─── response_tiktok JSONB
      ├── Google Enhanced Conv  ─── response_google JSONB
      └── Pinterest CAPI        ─── response_pinterest JSONB
        ↓
analytics.capi_events (logging + statut)
        ↓
AGENT_CEO alert si capture rate < 80%
```

---

## Déduplication event_id

La clé de voûte du système. Même event, envoyé par deux canaux différents, ne compte qu'une fois.

```typescript
// event_id déterministe : même input → même event_id
function buildEventId(tenantId: string, sourceId: string, eventName: string): string {
  return sha256(`${tenantId}:${sourceId}:${eventName}`).substring(0, 32);
}
```

**Côté pixel client (Shopify)** : injecter le même event_id dans le DataLayer :
```javascript
// Dans le pixel Meta côté client
fbq('track', 'Purchase', { value: 99.99, currency: 'EUR' }, { eventID: '<même event_id>' });
```

**Côté CAPI server** : l'event_id est envoyé dans le payload Meta/TikTok.
→ Meta reconnaît les deux envois comme le même event → ne compte qu'une fois.

---

## Conformité RGPD

Toutes les données personnelles sont hashées avant stockage et envoi :

| Donnée | Traitement |
|--------|-----------|
| Email | SHA256(email.toLowerCase().trim()) |
| Téléphone | SHA256(phone normalisé E.164) |
| IP | Brute (requis par Meta CAPI — conservée max 6h) |
| User Agent | Brute (non PII) |
| Nom/Prénom | Jamais stockés |

---

## Setup initial (onboarding tenant)

### 1. Configurer la table capi_config

```sql
INSERT INTO analytics.capi_config (
  tenant_id,
  meta_enabled, meta_pixel_id, meta_access_token_vault_id,
  tiktok_enabled, tiktok_pixel_id, tiktok_access_token_vault_id,
  google_enabled, google_tag_id, google_api_secret,
  shopify_webhook_secret,
  events_to_track
) VALUES (
  '<tenant_uuid>',
  true, '1234567890', '<vault_id_meta_token>',
  true, 'ABCDE12345', '<vault_id_tiktok_token>',
  false, null, null,
  '<shopify_webhook_secret>',
  ARRAY['Purchase', 'InitiateCheckout', 'AddToCart']
);
```

### 2. Stocker les tokens dans le vault

```typescript
// Via API AEGIS
await db.query(
  `SELECT connectors.vault_store($1, $2, $3, $4, $5)`,
  [tenantId, connectorId, 'api_key', metaAccessToken, null]
);
```

### 3. Enregistrer les webhooks Shopify

```typescript
// Via AGENT_CAPI task
await agentCAPI.execute({
  id: uuid(),
  tenantId,
  agentId: 'AGENT_CAPI',
  taskType: 'capi.setup_webhooks',
  input: {
    tenantId,
    shopifyDomain: 'mystore.myshopify.com',
    accessToken: '<shopify_access_token>',
  },
});
```

### 4. Configurer les variables d'environnement

```bash
AEGIS_WEBHOOK_BASE_URL=https://api.aegis.app
META_TEST_EVENT_CODE=TEST12345    # À retirer en production
```

### 5. Injecter event_id côté pixel client (Shopify theme)

Dans `checkout.liquid` ou via Shopify Web Pixels :

```javascript
// Générer le même event_id que le CAPI server
function buildEventId(tenantId, sourceId, eventName) {
  // Implémenter SHA256 côté client (SubtleCrypto API)
  // OU récupérer l'event_id depuis les métadonnées de commande Shopify
}

// Exemple pour Purchase
analytics.subscribe('checkout_completed', (event) => {
  const eventId = event.checkout.order.id + '_purchase'; // Simplifié
  fbq('track', 'Purchase', {
    value: event.checkout.totalPrice.amount,
    currency: event.checkout.currencyCode,
  }, { eventID: eventId });
});
```

---

## Monitoring

### Vue SQL : taux de capture par jour

```sql
SELECT * FROM analytics.capi_capture_rate
WHERE tenant_id = '<uuid>'
ORDER BY day DESC, event_name;
```

### Events en attente de retry

```sql
SELECT event_name, COUNT(*), MAX(retry_count)
FROM analytics.capi_events
WHERE tenant_id = '<uuid>'
  AND status IN ('failed', 'partial')
  AND retry_count < 3
GROUP BY event_name;
```

### KPIs cibles post-implémentation

| Métrique | Avant CAPI | Après CAPI | Delta |
|----------|-----------|-----------|-------|
| Conversions trackées | ~60% | ~98% | +38% |
| ROAS Meta reporté | Sous-estimé | Réel | +30-60% |
| iOS conversions | 0% | ~95% | +95% |
| Abandon panier Meta | ~40% invisible | Visible | + segmentation |

---

## Retry policy

- **Délai** : cron toutes les 5 minutes
- **Max retries** : 3 tentatives
- **Window** : events des dernières 24h seulement
- **Partial** : retry uniquement les plateformes qui ont échoué (pas les ok)

---

## Routes webhook enregistrées

```
POST /webhooks/shopify/:tenantId/orders/create       → Purchase
POST /webhooks/shopify/:tenantId/checkouts/create    → InitiateCheckout
POST /webhooks/shopify/:tenantId/carts/create        → AddToCart
```

**IMPORTANT** : Ces routes doivent recevoir le body en `Buffer` (raw) pour la validation HMAC.
Configurer Express avant `express.json()` :

```typescript
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
```
