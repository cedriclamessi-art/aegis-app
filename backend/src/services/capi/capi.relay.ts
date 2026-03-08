// ============================================================
// AEGIS — CAPI Relay Service
// Server-side conversion tracking : Meta + TikTok + Google
//
// Résout le problème iOS 14.5+ :
//   - Pixel client voit ~60% des conversions
//   - CAPI server-side récupère les ~40% manquants
//   - event_id identique → déduplication automatique côté plateforme
// ============================================================

import crypto from 'crypto';
import { db } from '../../utils/db';
import { logger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────

export interface ShopifyOrderPayload {
  id: number;
  email?: string;
  phone?: string;
  total_price: string;
  currency: string;
  line_items: Array<{
    product_id: number;
    variant_id: number;
    quantity: number;
    price: string;
    title: string;
  }>;
  customer?: {
    email?: string;
    phone?: string;
  };
  billing_address?: {
    phone?: string;
  };
  client_details?: {
    browser_ip?: string;
    user_agent?: string;
  };
  landing_site?: string;
  order_number: number;
  checkout_token?: string;
}

export interface ShopifyCheckoutPayload {
  token: string;
  email?: string;
  phone?: string;
  total_price: string;
  currency: string;
  line_items: Array<{
    product_id: number;
    variant_id: number;
    quantity: number;
    price: string;
    title: string;
  }>;
  customer?: {
    email?: string;
    phone?: string;
  };
}

export interface CAPIEventInput {
  tenantId: string;
  eventName: 'Purchase' | 'InitiateCheckout' | 'AddToCart' | 'ViewContent' | 'Lead';
  sourceId: string;          // order_id ou checkout_token
  shopifyWebhookId?: string;
  value?: number;
  currency?: string;
  contentIds?: string[];
  contents?: Array<{ id: string; quantity: number; item_price: number }>;
  numItems?: number;
  orderId?: string;

  // User data (brut — sera hashé ici)
  email?: string;
  phone?: string;
  ip?: string;
  userAgent?: string;

  // Click IDs (passés via cookies côté client → webhook enrichment)
  fbc?: string;   // _fbc cookie
  fbp?: string;   // _fbp cookie
  ttclid?: string;
  gclid?: string;

  rawPayload?: Record<string, unknown>;
}

export interface CAPIConfig {
  tenantId: string;
  metaEnabled: boolean;
  metaPixelId?: string;
  metaAccessToken?: string;
  tiktokEnabled: boolean;
  tiktokPixelId?: string;
  tiktokAccessToken?: string;
  googleEnabled: boolean;
  googleTagId?: string;
  googleApiSecret?: string;
  pinterestEnabled: boolean;
  pinterestAdAccountId?: string;
  pinterestAccessToken?: string;
  dedupWindowSeconds: number;
}

// ─── Utilitaires de hashing ──────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

function hashEmail(email?: string): string | null {
  if (!email) return null;
  return sha256(email);
}

function hashPhone(phone?: string): string | null {
  if (!phone) return null;
  // Normaliser : garder seulement chiffres + indicatif
  const normalized = phone.replace(/[\s\-().]/g, '').replace(/^00/, '+');
  return sha256(normalized);
}

/**
 * event_id déterministe : même input → même event_id
 * Garantit que pixel client ET CAPI server produisent le même event_id
 * → déduplication automatique côté Meta/TikTok
 */
function buildEventId(tenantId: string, sourceId: string, eventName: string): string {
  return sha256(`${tenantId}:${sourceId}:${eventName}`).substring(0, 32);
}

// ─── Classe principale ────────────────────────────────────

export class CAPIRelay {

  // ─── Entry point principal ────────────────────────────

  async relay(input: CAPIEventInput): Promise<void> {
    const eventId = buildEventId(input.tenantId, input.sourceId, input.eventName);

    // 1. Charger la config CAPI du tenant
    const config = await this.loadConfig(input.tenantId);
    if (!config) {
      logger.warn({ tenantId: input.tenantId }, 'CAPI config not found — skipping relay');
      return;
    }

    // 2. Déterminer les plateformes cibles
    const platformsTarget = this.resolvePlatforms(config);
    if (platformsTarget.length === 0) {
      logger.debug({ tenantId: input.tenantId }, 'No CAPI platforms enabled — skipping');
      return;
    }

    // 3. Insérer l'event (idempotent via UNIQUE constraint)
    const eventRow = await this.upsertEvent(input, eventId, platformsTarget);
    if (!eventRow) return; // déjà traité (webhook idempotence)

    // 4. Hasher les données utilisateur
    const userData = {
      emailHash: hashEmail(input.email),
      phoneHash: hashPhone(input.phone),
      ip: input.ip,
      userAgent: input.userAgent,
      fbc: input.fbc,
      fbp: input.fbp,
      ttclid: input.ttclid,
      gclid: input.gclid,
    };

    // 5. Envoyer en parallèle à toutes les plateformes
    const eventTime = Math.floor(Date.now() / 1000);

    const results = await Promise.allSettled([
      config.metaEnabled   ? this.sendToMeta(eventRow.id, input, userData, config, eventId, eventTime)      : Promise.resolve(null),
      config.tiktokEnabled ? this.sendToTikTok(eventRow.id, input, userData, config, eventId, eventTime)    : Promise.resolve(null),
      config.googleEnabled ? this.sendToGoogle(eventRow.id, input, userData, config, eventId, eventTime)    : Promise.resolve(null),
      config.pinterestEnabled ? this.sendToPinterest(eventRow.id, input, userData, config, eventId, eventTime) : Promise.resolve(null),
    ]);

    // 6. Consolider le statut
    await this.consolidateStatus(eventRow.id, platformsTarget, results);

    logger.info({
      tenantId: input.tenantId,
      eventName: input.eventName,
      eventId,
      value: input.value,
      platforms: platformsTarget,
    }, 'CAPI relay completed');
  }

  // ─── Meta Conversions API ─────────────────────────────

  private async sendToMeta(
    eventRowId: string,
    input: CAPIEventInput,
    userData: ReturnType<CAPIRelay['buildUserDataMeta']> extends never ? any : any,
    config: CAPIConfig,
    eventId: string,
    eventTime: number
  ): Promise<void> {
    if (!config.metaPixelId || !config.metaAccessToken) {
      throw new Error('Meta CAPI credentials missing');
    }

    const payload = {
      data: [{
        event_name: input.eventName,
        event_time: eventTime,
        event_id: eventId,                    // clé de déduplication avec pixel client
        event_source_url: null,
        action_source: 'website',
        user_data: {
          em: userData.emailHash ? [userData.emailHash] : undefined,
          ph: userData.phoneHash ? [userData.phoneHash] : undefined,
          client_ip_address: userData.ip,
          client_user_agent: userData.userAgent,
          fbc: userData.fbc,
          fbp: userData.fbp,
        },
        custom_data: {
          value: input.value,
          currency: input.currency ?? 'EUR',
          content_ids: input.contentIds,
          content_type: 'product',
          contents: input.contents,
          num_items: input.numItems,
          order_id: input.orderId,
        },
      }],
      test_event_code: process.env.META_TEST_EVENT_CODE, // null en prod
    };

    const url = `https://graph.facebook.com/v19.0/${config.metaPixelId}/events?access_token=${config.metaAccessToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      await this.updatePlatformResponse(eventRowId, 'meta', json, false);
      throw new Error(`Meta CAPI error: ${response.status} — ${JSON.stringify(json)}`);
    }

    await this.updatePlatformResponse(eventRowId, 'meta', json, true);
    logger.debug({ eventId, pixelId: config.metaPixelId }, 'Meta CAPI ✓');
  }

  // ─── TikTok Events API ────────────────────────────────

  private async sendToTikTok(
    eventRowId: string,
    input: CAPIEventInput,
    userData: any,
    config: CAPIConfig,
    eventId: string,
    eventTime: number
  ): Promise<void> {
    if (!config.tiktokPixelId || !config.tiktokAccessToken) {
      throw new Error('TikTok Events API credentials missing');
    }

    const payload = {
      pixel_code: config.tiktokPixelId,
      event: input.eventName === 'Purchase' ? 'CompletePayment' : input.eventName,  // mapping TikTok
      event_id: eventId,
      timestamp: new Date(eventTime * 1000).toISOString(),
      context: {
        user: {
          email: userData.emailHash,
          phone_number: userData.phoneHash,
          ip: userData.ip,
          user_agent: userData.userAgent,
          ttclid: userData.ttclid,
        },
        page: {
          url: null,
        },
      },
      properties: {
        value: input.value,
        currency: input.currency ?? 'EUR',
        content_id: input.contentIds,
        content_type: 'product',
        quantity: input.numItems,
        order_id: input.orderId,
      },
    };

    const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': config.tiktokAccessToken,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json() as Record<string, unknown>;

    const isOk = response.ok && (json as any)?.code === 0;
    await this.updatePlatformResponse(eventRowId, 'tiktok', json, isOk);

    if (!isOk) {
      throw new Error(`TikTok Events API error: ${JSON.stringify(json)}`);
    }

    logger.debug({ eventId, pixelId: config.tiktokPixelId }, 'TikTok Events API ✓');
  }

  // ─── Google Enhanced Conversions (Measurement Protocol GA4) ──

  private async sendToGoogle(
    eventRowId: string,
    input: CAPIEventInput,
    userData: any,
    config: CAPIConfig,
    eventId: string,
    eventTime: number
  ): Promise<void> {
    if (!config.googleTagId || !config.googleApiSecret) {
      throw new Error('Google Enhanced Conversions credentials missing');
    }

    // Measurement Protocol GA4
    const clientId = userData.gclid ?? crypto.randomUUID(); // fallback si pas de gclid
    const payload = {
      client_id: clientId,
      events: [{
        name: input.eventName === 'Purchase' ? 'purchase' : input.eventName.toLowerCase(),
        params: {
          transaction_id: input.orderId ?? eventId,   // déduplication Google
          value: input.value,
          currency: input.currency ?? 'EUR',
          items: input.contents?.map(c => ({
            item_id: c.id,
            quantity: c.quantity,
            price: c.item_price,
          })),
          engagement_time_msec: 100,
        },
      }],
      user_data: {
        sha256_email_address: userData.emailHash,
        sha256_phone_number: userData.phoneHash,
      },
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${config.googleTagId}&api_secret=${config.googleApiSecret}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // GA4 MP retourne toujours 204 (pas de body en prod)
    const isOk = response.status === 204 || response.status === 200;
    const json = isOk ? { status: 'accepted' } : { status: 'error', code: response.status };

    await this.updatePlatformResponse(eventRowId, 'google', json, isOk);

    if (!isOk) {
      throw new Error(`Google MP error: ${response.status}`);
    }

    logger.debug({ eventId, tagId: config.googleTagId }, 'Google Enhanced Conversions ✓');
  }

  // ─── Pinterest CAPI ────────────────────────────────────

  private async sendToPinterest(
    eventRowId: string,
    input: CAPIEventInput,
    userData: any,
    config: CAPIConfig,
    eventId: string,
    eventTime: number
  ): Promise<void> {
    if (!config.pinterestAdAccountId || !config.pinterestAccessToken) {
      throw new Error('Pinterest CAPI credentials missing');
    }

    const payload = {
      data: [{
        event_name: input.eventName === 'Purchase' ? 'checkout' : input.eventName.toLowerCase(),
        action_source: 'web',
        event_time: eventTime,
        event_id: eventId,
        user_data: {
          em: userData.emailHash ? [userData.emailHash] : undefined,
          ph: userData.phoneHash ? [userData.phoneHash] : undefined,
          client_ip_address: userData.ip,
          client_user_agent: userData.userAgent,
        },
        custom_data: {
          value: input.value?.toString(),
          currency: input.currency ?? 'EUR',
          content_ids: input.contentIds,
          contents: input.contents,
          num_items: input.numItems,
          order_id: input.orderId,
        },
      }],
    };

    const url = `https://api.pinterest.com/v5/ad_accounts/${config.pinterestAdAccountId}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.pinterestAccessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json() as Record<string, unknown>;
    await this.updatePlatformResponse(eventRowId, 'pinterest', json, response.ok);

    if (!response.ok) {
      throw new Error(`Pinterest CAPI error: ${JSON.stringify(json)}`);
    }

    logger.debug({ eventId }, 'Pinterest CAPI ✓');
  }

  // ─── DB helpers ───────────────────────────────────────

  private async loadConfig(tenantId: string): Promise<CAPIConfig | null> {
    // Charger config + décrypter tokens via vault
    const result = await db.query(
      `SELECT
        cc.*,
        meta_vault.token_enc  AS meta_token_enc,
        tt_vault.token_enc    AS tiktok_token_enc,
        pin_vault.token_enc   AS pinterest_token_enc
       FROM analytics.capi_config cc
       LEFT JOIN connectors.token_vault meta_vault
         ON meta_vault.id = cc.meta_access_token_vault_id
       LEFT JOIN connectors.token_vault tt_vault
         ON tt_vault.id = cc.tiktok_access_token_vault_id
       LEFT JOIN connectors.token_vault pin_vault
         ON pin_vault.id = cc.pinterest_access_token_vault_id
       WHERE cc.tenant_id = $1`,
      [tenantId]
    );

    if (!result.rows.length) return null;
    const row = result.rows[0];

    // Décryptage via vault (pgcrypto)
    const decryptToken = async (enc: string | null): Promise<string | null> => {
      if (!enc) return null;
      const dec = await db.query(
        `SELECT pgp_sym_decrypt($1::bytea, current_setting('app.encryption_key')) AS token`,
        [enc]
      );
      return dec.rows[0]?.token ?? null;
    };

    return {
      tenantId,
      metaEnabled: row.meta_enabled,
      metaPixelId: row.meta_pixel_id,
      metaAccessToken: await decryptToken(row.meta_token_enc),
      tiktokEnabled: row.tiktok_enabled,
      tiktokPixelId: row.tiktok_pixel_id,
      tiktokAccessToken: await decryptToken(row.tiktok_token_enc),
      googleEnabled: row.google_enabled,
      googleTagId: row.google_tag_id,
      googleApiSecret: row.google_api_secret,
      pinterestEnabled: row.pinterest_enabled,
      pinterestAdAccountId: row.pinterest_ad_account_id,
      pinterestAccessToken: await decryptToken(row.pinterest_token_enc),
      dedupWindowSeconds: row.dedup_window_seconds,
    };
  }

  private resolvePlatforms(config: CAPIConfig): string[] {
    const platforms: string[] = [];
    if (config.metaEnabled)      platforms.push('meta');
    if (config.tiktokEnabled)    platforms.push('tiktok');
    if (config.googleEnabled)    platforms.push('google');
    if (config.pinterestEnabled) platforms.push('pinterest');
    return platforms;
  }

  private async upsertEvent(
    input: CAPIEventInput,
    eventId: string,
    platformsTarget: string[]
  ): Promise<{ id: string } | null> {
    try {
      const result = await db.query(
        `INSERT INTO analytics.capi_events (
          tenant_id, event_name, event_id, source_id, shopify_webhook_id,
          value, currency, content_ids, contents, num_items, order_id,
          user_email_hash, user_phone_hash, user_ip, user_agent,
          fbc, fbp, ttclid, gclid,
          platforms_target, status, raw_payload
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9::jsonb, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, 'pending', $21::jsonb
        )
        ON CONFLICT (tenant_id, event_id) DO NOTHING
        RETURNING id`,
        [
          input.tenantId, input.eventName, eventId, input.sourceId, input.shopifyWebhookId ?? null,
          input.value ?? null, input.currency ?? 'EUR',
          input.contentIds ? `{${input.contentIds.join(',')}}` : null,
          JSON.stringify(input.contents ?? []),
          input.numItems ?? null, input.orderId ?? null,
          hashEmail(input.email), hashPhone(input.phone), input.ip ?? null, input.userAgent ?? null,
          input.fbc ?? null, input.fbp ?? null, input.ttclid ?? null, input.gclid ?? null,
          `{${platformsTarget.join(',')}}`,
          JSON.stringify(input.rawPayload ?? {}),
        ]
      );

      if (!result.rows.length) {
        logger.debug({ eventId, tenantId: input.tenantId }, 'CAPI event already processed — deduplicated');
        return null;
      }

      return result.rows[0];

    } catch (err: any) {
      // Webhook idempotence : shopify_webhook_id déjà présent
      if (err.code === '23505') {
        logger.debug({ shopifyWebhookId: input.shopifyWebhookId }, 'Duplicate Shopify webhook — skipping');
        return null;
      }
      throw err;
    }
  }

  private async updatePlatformResponse(
    eventRowId: string,
    platform: string,
    response: Record<string, unknown>,
    success: boolean
  ): Promise<void> {
    const column = `response_${platform}`;
    const okArray  = success ? `array_append(platforms_ok, '${platform}')` : 'platforms_ok';
    const failArray = !success ? `array_append(platforms_failed, '${platform}')` : 'platforms_failed';

    await db.query(
      `UPDATE analytics.capi_events
       SET
         ${column} = $1::jsonb,
         platforms_sent   = array_append(platforms_sent, '${platform}'),
         platforms_ok     = ${okArray},
         platforms_failed = ${failArray},
         updated_at       = NOW()
       WHERE id = $2`,
      [JSON.stringify(response), eventRowId]
    );
  }

  private async consolidateStatus(
    eventRowId: string,
    platformsTarget: string[],
    results: PromiseSettledResult<void | null>[]
  ): Promise<void> {
    const total    = platformsTarget.length;
    const settled  = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected').length;

    let status: string;
    if (settled === total)         status = 'sent';
    else if (settled > 0)          status = 'partial';
    else                           status = 'failed';

    const lastError = rejected > 0
      ? results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => (r.reason as Error).message)
          .join(' | ')
      : null;

    await db.query(
      `UPDATE analytics.capi_events
       SET status = $1, last_error = $2, sent_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [status, lastError, eventRowId]
    );
  }

  // ─── Retry des events failed ──────────────────────────

  async retryFailedEvents(tenantId: string): Promise<void> {
    const result = await db.query(
      `SELECT id, tenant_id, event_name, source_id, value, currency,
              content_ids, contents, num_items, order_id,
              user_email_hash, user_phone_hash, user_ip, user_agent,
              fbc, fbp, ttclid, gclid, raw_payload, event_id,
              platforms_target, platforms_ok
       FROM analytics.capi_events
       WHERE tenant_id = $1
         AND status IN ('failed', 'partial')
         AND retry_count < 3
         AND created_at > NOW() - INTERVAL '24 hours'
       FOR UPDATE SKIP LOCKED
       LIMIT 50`,
      [tenantId]
    );

    for (const row of result.rows) {
      // Retry seulement les plateformes qui ont échoué
      const failedPlatforms = row.platforms_target.filter(
        (p: string) => !row.platforms_ok.includes(p)
      );

      if (failedPlatforms.length === 0) continue;

      await db.query(
        `UPDATE analytics.capi_events
         SET retry_count = retry_count + 1, status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );

      // Re-relay uniquement les plateformes manquantes
      logger.info(
        { eventId: row.event_id, failedPlatforms, retry: row.retry_count + 1 },
        'Retrying CAPI event'
      );

      // Note : implémentation simplifiée du retry — en prod,
      // reconstruire le CAPIEventInput depuis raw_payload et relancer
      // les appels API pour les plateformes échouées uniquement
    }
  }

  // ─── Utilitaire buildUserDataMeta (typage) ────────────

  private buildUserDataMeta(userData: {
    emailHash: string | null;
    phoneHash: string | null;
    ip?: string;
    userAgent?: string;
    fbc?: string;
    fbp?: string;
  }) { return userData; }
}

// ─── Singleton ────────────────────────────────────────────
export const capiRelay = new CAPIRelay();
