/**
 * MultiShopScheduler — AEGIS v3.5
 * Runs independently for N shops. Each shop has its own scheduler state.
 * No cross-shop interference. Supports different autopilot modes per shop.
 * Runs every 60 seconds. Only triggers shops whose next_evaluation_at <= NOW().
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { AgentOrchestrator } from './orchestrator.agent';

interface ShopState {
  shop_id:             string;
  is_active:           boolean;
  autopilot_mode:      string;
  next_evaluation_at:  Date;
  next_anomaly_scan_at: Date;
  errors_today:        number;
}

export class MultiShopScheduler {
  private db:           Pool;
  private redis:        Redis;
  private orchestrator: AgentOrchestrator;
  private isRunning = false;

  constructor(db: Pool, redis: Redis) {
    this.db           = db;
    this.redis        = redis;
    this.orchestrator = new AgentOrchestrator(db, redis);
  }

  /**
   * Start the scheduler loop. Checks all shops every 60 seconds.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[MultiShopScheduler] Started');
    this.loop();
  }

  stop(): void {
    this.isRunning = false;
    console.log('[MultiShopScheduler] Stopped');
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.tick();
      } catch (err) {
        console.error('[MultiShopScheduler] tick error:', err);
      }
      await new Promise(r => setTimeout(r, 60_000)); // 60 second interval
    }
  }

  private async tick(): Promise<void> {
    // Fetch all shops due for evaluation
    const { rows: shops } = await this.db.query<ShopState>(
      `SELECT shop_id, is_active, autopilot_mode, next_evaluation_at, next_anomaly_scan_at, errors_today
       FROM shop_scheduler_state
       WHERE is_active = true
         AND next_evaluation_at <= NOW()
         AND errors_today < 10        -- circuit breaker: stop if too many errors today
       ORDER BY next_evaluation_at ASC
       LIMIT 50`,                     // process max 50 shops per tick
    );

    console.log(`[MultiShopScheduler] ${shops.length} shop(s) due for evaluation`);

    // Process shops concurrently (but with a concurrency limit)
    await this.processWithConcurrencyLimit(shops, 5);
  }

  private async processWithConcurrencyLimit(shops: ShopState[], limit: number): Promise<void> {
    const queue = [...shops];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) {
        const shop = queue.shift();
        if (!shop) return;
        await this.processShop(shop);
      }
    });
    await Promise.allSettled(workers);
  }

  private async processShop(shop: ShopState): Promise<void> {
    const { shop_id, autopilot_mode } = shop;
    console.log(`[MultiShopScheduler] Processing shop ${shop_id} (mode: ${autopilot_mode})`);

    try {
      // Skip human mode — no autonomous actions
      if (autopilot_mode === 'human') {
        await this.updateNextRun(shop_id);
        return;
      }

      // Run orchestrator cycle for this shop
      await this.orchestrator.execute({
        type:     'run_cycle',
        shop_id,
        payload:  { autopilot_mode },
      });

    } catch (err) {
      console.error(`[MultiShopScheduler] Error for shop ${shop_id}:`, err);
      await this.db.query(
        `UPDATE shop_scheduler_state
         SET errors_today = errors_today + 1, updated_at = NOW()
         WHERE shop_id = $1`,
        [shop_id]
      );
    }
  }

  private async updateNextRun(shopId: string): Promise<void> {
    await this.db.query(
      `UPDATE shop_scheduler_state
       SET next_evaluation_at = NOW() + INTERVAL '15 minutes', updated_at = NOW()
       WHERE shop_id = $1`,
      [shopId]
    );
  }

  /**
   * Register a new shop in the scheduler.
   * Called when a shop first connects to AEGIS.
   */
  async registerShop(shopId: string, autopilotMode = 'semi'): Promise<void> {
    await this.db.query(
      `INSERT INTO shop_scheduler_state (shop_id, autopilot_mode)
       VALUES ($1, $2)
       ON CONFLICT (shop_id) DO UPDATE SET is_active = true, autopilot_mode = $2, updated_at = NOW()`,
      [shopId, autopilotMode]
    );
    console.log(`[MultiShopScheduler] Registered shop ${shopId}`);
  }

  /**
   * Pause all autonomous actions for a shop (e.g. user request, billing issue).
   */
  async pauseShop(shopId: string, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE shop_scheduler_state SET is_active = false, updated_at = NOW() WHERE shop_id = $1`, [shopId]
    );
    await this.redis.publish(`aegis:system:${shopId}`, JSON.stringify({ event: 'shop_paused', reason }));
    console.log(`[MultiShopScheduler] Shop ${shopId} paused: ${reason}`);
  }

  /**
   * Get scheduler status for all shops (admin view).
   */
  async getStatus(): Promise<ShopState[]> {
    const { rows } = await this.db.query<ShopState>(
      `SELECT * FROM shop_scheduler_state ORDER BY next_evaluation_at ASC`
    );
    return rows;
  }
}
