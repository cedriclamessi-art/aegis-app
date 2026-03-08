// ============================================================
// AEGIS — Shopify Webhook Handler
// Point d'entrée des événements Shopify → CAPI Relay
//
// Routes :
//   POST /webhooks/shopify/:tenantId/orders/create
//   POST /webhooks/shopify/:tenantId/checkouts/create
//   POST /webhooks/shopify/:tenantId/carts/create
// ============================================================

import crypto from 'crypto';
import { Request, Response } from 'express';
import { db } from '../../utils/db';
import { logger } from '../../utils/logger';
import { capiRelay, ShopifyOrderPayload, ShopifyCheckoutPayload, CAPIEventInput } from './capi.relay';

// ─── Validation HMAC Shopify ──────────────────────────────

function validateShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  // Comparaison timing-safe
  return crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(hmacHeader)
  );
}

// ─── Charger le webhook secret du tenant ─────────────────

async function loadWebhookSecret(tenantId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT shopify_webhook_secret FROM analytics.capi_config WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0]?.shopify_webhook_secret ?? null;
}

// ─── Extraire les click IDs depuis les cookies ────────────
// Note : les cookies sont passés dans les headers custom du webhook
// (à configurer dans AGENT_CAPI setup : inject cookies via pixel)

function extractClickIds(payload: Record<string, unknown>, headers: Record<string, string>) {
  return {
    fbc: (payload.fbc as string) ?? headers['x-fbc'] ?? undefined,
    fbp: (payload.fbp as string) ?? headers['x-fbp'] ?? undefined,
    ttclid: (payload.ttclid as string) ?? headers['x-ttclid'] ?? undefined,
    gclid: (payload.gclid as string) ?? headers['x-gclid'] ?? undefined,
  };
}

// ─── Handler : orders/create (Purchase) ──────────────────

export async function handleOrderCreate(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.params;
  const webhookId = req.headers['x-shopify-webhook-id'] as string;
  const topic     = req.headers['x-shopify-topic'] as string;
  const hmac      = req.headers['x-shopify-hmac-sha256'] as string;

  // 1. Récupérer le secret et valider HMAC
  const secret = await loadWebhookSecret(tenantId);
  if (!secret) {
    logger.warn({ tenantId }, 'CAPI: No webhook secret configured for tenant');
    res.status(200).send('ok'); // 200 pour éviter les retry Shopify
    return;
  }

  if (!validateShopifyHmac(req.body as Buffer, hmac, secret)) {
    logger.warn({ tenantId, webhookId }, 'CAPI: Invalid Shopify HMAC — rejected');
    res.status(401).send('Unauthorized');
    return;
  }

  // 2. Parser le payload
  const order: ShopifyOrderPayload = JSON.parse((req.body as Buffer).toString());

  // 3. Construire l'input CAPI
  const clickIds = extractClickIds(order as unknown as Record<string, unknown>, req.headers as Record<string, string>);

  const contents = order.line_items.map(item => ({
    id: `shopify_${item.product_id}_${item.variant_id}`,
    quantity: item.quantity,
    item_price: parseFloat(item.price),
  }));

  const contentIds = order.line_items.map(
    item => `shopify_${item.product_id}_${item.variant_id}`
  );

  const capiInput: CAPIEventInput = {
    tenantId,
    eventName: 'Purchase',
    sourceId: order.id.toString(),
    shopifyWebhookId: webhookId,
    value: parseFloat(order.total_price),
    currency: order.currency,
    contentIds,
    contents,
    numItems: order.line_items.reduce((sum, i) => sum + i.quantity, 0),
    orderId: order.order_number.toString(),
    email: order.email ?? order.customer?.email,
    phone: order.phone ?? order.customer?.phone ?? order.billing_address?.phone,
    ip: order.client_details?.browser_ip,
    userAgent: order.client_details?.user_agent,
    ...clickIds,
    rawPayload: order as unknown as Record<string, unknown>,
  };

  // 4. Répondre immédiatement à Shopify (éviter timeout 5s)
  res.status(200).send('ok');

  // 5. Relay CAPI de manière asynchrone
  capiRelay.relay(capiInput).catch(err => {
    logger.error({ tenantId, orderId: order.id, err }, 'CAPI relay error for Purchase');
  });
}

// ─── Handler : checkouts/create (InitiateCheckout) ────────

export async function handleCheckoutCreate(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.params;
  const webhookId = req.headers['x-shopify-webhook-id'] as string;
  const hmac      = req.headers['x-shopify-hmac-sha256'] as string;

  const secret = await loadWebhookSecret(tenantId);
  if (!secret || !validateShopifyHmac(req.body as Buffer, hmac, secret)) {
    res.status(200).send('ok');
    return;
  }

  const checkout: ShopifyCheckoutPayload = JSON.parse((req.body as Buffer).toString());
  const clickIds = extractClickIds(checkout as unknown as Record<string, unknown>, req.headers as Record<string, string>);

  const contents = checkout.line_items.map(item => ({
    id: `shopify_${item.product_id}_${item.variant_id}`,
    quantity: item.quantity,
    item_price: parseFloat(item.price),
  }));

  const capiInput: CAPIEventInput = {
    tenantId,
    eventName: 'InitiateCheckout',
    sourceId: checkout.token,
    shopifyWebhookId: webhookId,
    value: parseFloat(checkout.total_price),
    currency: checkout.currency,
    contentIds: checkout.line_items.map(i => `shopify_${i.product_id}_${i.variant_id}`),
    contents,
    numItems: checkout.line_items.reduce((s, i) => s + i.quantity, 0),
    email: checkout.email ?? checkout.customer?.email,
    phone: checkout.phone ?? checkout.customer?.phone,
    ...clickIds,
    rawPayload: checkout as unknown as Record<string, unknown>,
  };

  res.status(200).send('ok');

  capiRelay.relay(capiInput).catch(err => {
    logger.error({ tenantId, token: checkout.token, err }, 'CAPI relay error for InitiateCheckout');
  });
}

// ─── Handler : carts/create (AddToCart) ──────────────────

export async function handleCartCreate(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.params;
  const webhookId = req.headers['x-shopify-webhook-id'] as string;
  const hmac      = req.headers['x-shopify-hmac-sha256'] as string;

  const secret = await loadWebhookSecret(tenantId);
  if (!secret || !validateShopifyHmac(req.body as Buffer, hmac, secret)) {
    res.status(200).send('ok');
    return;
  }

  const cart = JSON.parse((req.body as Buffer).toString());
  const clickIds = extractClickIds(cart, req.headers as Record<string, string>);

  const capiInput: CAPIEventInput = {
    tenantId,
    eventName: 'AddToCart',
    sourceId: cart.token ?? cart.id?.toString(),
    shopifyWebhookId: webhookId,
    value: cart.line_items?.reduce(
      (s: number, i: any) => s + parseFloat(i.price) * i.quantity, 0
    ),
    currency: 'EUR',
    contentIds: cart.line_items?.map(
      (i: any) => `shopify_${i.product_id}_${i.variant_id}`
    ),
    numItems: cart.item_count,
    ...clickIds,
    rawPayload: cart,
  };

  res.status(200).send('ok');

  capiRelay.relay(capiInput).catch(err => {
    logger.error({ tenantId, err }, 'CAPI relay error for AddToCart');
  });
}

// ─── Registration des routes Express ─────────────────────

import { Router } from 'express';

export function registerShopifyWebhookRoutes(router: Router): void {
  // IMPORTANT : rawBody middleware DOIT être avant express.json()
  // pour pouvoir valider le HMAC sur le body brut
  const rawBodyMiddleware = (req: Request, _res: Response, next: () => void) => {
    req.body = req.body; // déjà Buffer si configuré dans app.ts
    next();
  };

  router.post(
    '/webhooks/shopify/:tenantId/orders/create',
    rawBodyMiddleware,
    handleOrderCreate
  );

  router.post(
    '/webhooks/shopify/:tenantId/checkouts/create',
    rawBodyMiddleware,
    handleCheckoutCreate
  );

  router.post(
    '/webhooks/shopify/:tenantId/carts/create',
    rawBodyMiddleware,
    handleCartCreate
  );

  logger.info('Shopify CAPI webhook routes registered');
}

// ─── Script de setup : enregistrer les webhooks chez Shopify ──

/**
 * À appeler lors du onboarding tenant pour enregistrer
 * les webhooks Shopify automatiquement.
 *
 * Usage : await setupShopifyWebhooks(tenantId, shopifyDomain, accessToken)
 */
export async function setupShopifyWebhooks(
  tenantId: string,
  shopifyDomain: string,   // ex: mystore.myshopify.com
  accessToken: string
): Promise<void> {
  const baseUrl = process.env.AEGIS_WEBHOOK_BASE_URL; // ex: https://api.aegis.app
  if (!baseUrl) throw new Error('AEGIS_WEBHOOK_BASE_URL not configured');

  const webhooks = [
    { topic: 'orders/create',    address: `${baseUrl}/webhooks/shopify/${tenantId}/orders/create` },
    { topic: 'checkouts/create', address: `${baseUrl}/webhooks/shopify/${tenantId}/checkouts/create` },
    { topic: 'carts/create',     address: `${baseUrl}/webhooks/shopify/${tenantId}/carts/create` },
  ];

  for (const wh of webhooks) {
    const response = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/webhooks.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhook: {
            topic: wh.topic,
            address: wh.address,
            format: 'json',
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      logger.warn({ topic: wh.topic, err }, 'Failed to register Shopify webhook');
    } else {
      logger.info({ topic: wh.topic, tenantId }, 'Shopify webhook registered ✓');
    }
  }
}
