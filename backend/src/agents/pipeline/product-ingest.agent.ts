/**
 * AGENT_PRODUCT_INGEST
 * ====================
 * Point d'entrée du pipeline : coller un lien produit → normaliser.
 *
 * Responsabilités :
 *   - Récupérer les données brutes depuis AliExpress / Amazon / Shopify /
 *     TikTok Shop / tout domaine Shopify tiers
 *   - Normaliser en un ProductRecord unifié
 *   - Déclencher les jobs downstream (copy, images, analyse)
 *   - Fallback gracieux si le scraping échoue (mode "manual upload")
 */
import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

interface IngestInput {
  productUrl:  string;
  sourceHint?: 'aliexpress' | 'amazon' | 'shopify' | 'tiktok' | 'other';
  manualData?: {
    name:        string;
    description: string;
    price:       number;
    images:      string[];
  };
}

interface ProductRecord {
  name:           string;
  description:    string;
  price:          number;
  currency:       string;
  images:         string[];
  category:       string | null;
  rating:         number | null;
  reviewCount:    number | null;
  supplier:       string | null;
  shippingDays:   number | null;
  rawData:        Record<string, unknown>;
}

export class ProductIngestAgent extends AgentBase {
  readonly agentId = 'AGENT_PRODUCT_INGEST';
  readonly taskTypes = [
    'ingest.product_url',    // URL → ProductRecord + jobs downstream
    'ingest.manual_product', // Données manuelles → ProductRecord
    'ingest.refresh',        // Rafraîchir un produit existant
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'ingest.product_url':    return this.ingestUrl(task);
      case 'ingest.manual_product': return this.ingestManual(task);
      case 'ingest.refresh':        return this.refreshProduct(task);
      default: return { success: false, error: `Unknown task: ${task.taskType}` };
    }
  }

  // ── 1. Ingest depuis URL ────────────────────────────────────────────────

  private async ingestUrl(task: AgentTask): Promise<AgentResult> {
    const { productUrl, sourceHint } = task.input as IngestInput;

    // Quota check
    const quota = await db.query(
      `SELECT * FROM billing.check_quota($1, 'jobs')`, [task.tenantId]
    );
    if (!quota.rows[0]?.allowed) {
      return { success: false, error: quota.rows[0]?.message || 'Quota dépassé' };
    }

    const source = sourceHint ?? this.detectSource(productUrl);
    logger.info(`[INGEST] ${source} — ${productUrl}`);

    let product: ProductRecord;

    try {
      product = await this.scrapeProduct(productUrl, source);
    } catch (err) {
      // Fallback : créer un record vide avec l'URL, laisser l'humain compléter
      logger.warn(`[INGEST] Scraping failed, fallback to manual — ${err}`);
      product = this.emptyRecord(productUrl);
    }

    return this.persistAndDispatch(task, productUrl, source, product);
  }

  // ── 2. Ingest manuel ───────────────────────────────────────────────────

  private async ingestManual(task: AgentTask): Promise<AgentResult> {
    const { productUrl, manualData } = task.input as IngestInput;
    if (!manualData) return { success: false, error: 'manualData requis' };

    const product: ProductRecord = {
      ...manualData,
      currency: 'EUR',
      category: null,
      rating: null,
      reviewCount: null,
      supplier: null,
      shippingDays: null,
      rawData: { source: 'manual' },
    };

    return this.persistAndDispatch(task, productUrl ?? 'manual', 'other', product);
  }

  // ── 3. Refresh ─────────────────────────────────────────────────────────

  private async refreshProduct(task: AgentTask): Promise<AgentResult> {
    const { productId } = task.input as { productId: string };
    const r = await db.query(
      `SELECT source_url, source_platform FROM store.products WHERE id = $1 AND tenant_id = $2`,
      [productId, task.tenantId]
    );
    if (!r.rows[0]) return { success: false, error: 'Produit introuvable' };

    return this.ingestUrl({
      ...task,
      input: { productUrl: r.rows[0].source_url, sourceHint: r.rows[0].source_platform },
    } as AgentTask);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private detectSource(url: string): string {
    if (url.includes('aliexpress'))  return 'aliexpress';
    if (url.includes('amazon'))      return 'amazon';
    if (url.includes('tiktok'))      return 'tiktok';
    // Shopify : myshopify.com ou domaines custom avec /products/
    if (url.includes('myshopify') || url.match(/\/products\//)) return 'shopify';
    return 'other';
  }

  private async scrapeProduct(url: string, source: string): Promise<ProductRecord> {
    // En v1 : appel à un scraper service interne ou Puppeteer worker
    // Le scraper est un microservice séparé pour isoler les dépendances
    const scraperUrl = process.env.SCRAPER_SERVICE_URL;
    if (!scraperUrl) throw new Error('SCRAPER_SERVICE_URL non configuré');

    const resp = await fetch(`${scraperUrl}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
      body: JSON.stringify({ url, source }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) throw new Error(`Scraper ${resp.status}: ${await resp.text()}`);
    return resp.json() as Promise<ProductRecord>;
  }

  private emptyRecord(url: string): ProductRecord {
    return {
      name: 'Produit à compléter',
      description: '',
      price: 0,
      currency: 'EUR',
      images: [],
      category: null,
      rating: null,
      reviewCount: null,
      supplier: null,
      shippingDays: null,
      rawData: { source_url: url, status: 'manual_required' },
    };
  }

  private async persistAndDispatch(
    task: AgentTask,
    url: string,
    source: string,
    product: ProductRecord
  ): Promise<AgentResult> {
    // Persiste le produit
    const r = await db.query<{ id: string }>(
      `INSERT INTO store.products
         (tenant_id, name, description, price, currency, images,
          category, rating, review_count, source_url, source_platform, raw_data, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ingested')
       ON CONFLICT (tenant_id, source_url) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         price = EXCLUDED.price, images = EXCLUDED.images,
         raw_data = EXCLUDED.raw_data, updated_at = NOW()
       RETURNING id`,
      [
        task.tenantId, product.name, product.description, product.price,
        product.currency, JSON.stringify(product.images),
        product.category, product.rating, product.reviewCount,
        url, source, JSON.stringify(product.rawData),
      ]
    );

    const productId = r.rows[0].id;

    // Dispatch jobs downstream via agents.messages
    const downstreamJobs = [
      { to: 'AGENT_MARKET_INTEL',    type: 'analyse.market',     priority: 3 },
      { to: 'AGENT_WINNER_DETECTOR', type: 'validate.economics',  priority: 3 },
      { to: 'AGENT_COPY_CHIEF',      type: 'generate.copy',       priority: 5 },
      { to: 'AGENT_IMAGE_FACTORY',   type: 'generate.images',     priority: 5 },
    ];

    for (const job of downstreamJobs) {
      await db.query(
        `SELECT agents.send_message($1,$2,$3,$4,$5,$6)`,
        [this.agentId, job.to, job.type, JSON.stringify({ productId }), task.tenantId, job.priority]
      );
    }

    await db.query(`SELECT billing.increment_usage($1, 'jobs', 1)`, [task.tenantId]);

    logger.info(`[INGEST] Product ${productId} ingested — ${downstreamJobs.length} jobs dispatched`);

    return {
      success: true,
      output: { productId, source, name: product.name, jobsDispatched: downstreamJobs.length },
    };
  }
}
