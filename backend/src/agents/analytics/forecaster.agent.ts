/**
 * AGENT_FORECASTER v3.6 — 14-day revenue/spend/stock projections
 * Runs every evening at 22:00. Anticipates before reacting.
 * Detects stock risks BEFORE rupture hits. Adjusts for seasonality.
 * Surfaces: "if you keep this spend rate, you'll run out of Bleu Marine in 8 days
 * and lose €3,400 in revenue" — before it happens.
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

interface DailyForecast {
  date:             string;
  revenue_low:      number;
  revenue_mid:      number;
  revenue_high:     number;
  spend_forecast:   number;
  roas_forecast:    number;
  cpa_forecast:     number;
  confidence:       number;
  flags:            string[];  // 'weekend_boost','promo','stock_risk','competitor_surge'
}

interface StockRisk {
  sku:               string;
  product_name:      string;
  current_stock:     number;
  daily_velocity:    number;
  days_until_stockout: number;
  revenue_at_risk:   number;  // revenue lost if stock hits 0 while ads running
  critical:          boolean;
}

export class AgentForecaster extends BaseAgent {
  readonly name = 'AGENT_FORECASTER';
  private claude: Anthropic;

  // Seasonality multipliers — day of week (0=Sun, 6=Sat)
  private readonly DOW_MULTIPLIERS = [1.08, 0.92, 0.94, 0.96, 1.02, 1.14, 1.12];
  // French public holidays 2026 (MM-DD format)
  private readonly FR_HOLIDAYS_2026 = ['01-01','04-06','05-01','05-08','05-14','06-05','07-14','08-15','11-01','11-11','12-25'];

  constructor(db: any, redis: any) {
    super(db, redis);
    this.claude = new Anthropic();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'generate':        return this.generateForecast(task);
      case 'stock_risk':      return this.computeStockRisks(task);
      case 'get_latest':      return this.getLatestForecast(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  private async generateForecast(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // 1. Fetch last 30 days of daily metrics
    const { rows: history } = await this.db.query(
      `SELECT DATE(recorded_at) AS day,
              SUM(revenue) AS revenue, SUM(spend) AS spend,
              AVG(roas) AS roas, AVG(cpa) AS cpa,
              COUNT(*) AS data_points
       FROM ad_metrics
       WHERE shop_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(recorded_at)
       ORDER BY day ASC`,
      [shop_id]
    );

    if (history.length < 7) {
      return { success: false, message: 'Need at least 7 days of history to forecast' };
    }

    // 2. Compute baseline stats
    const revenues = history.map(r => parseFloat(r.revenue));
    const spends   = history.map(r => parseFloat(r.spend));
    const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    const avgSpend   = spends.reduce((a, b) => a + b, 0)   / spends.length;
    const avgROAS    = avgSpend > 0 ? (revenues.reduce((a,b)=>a+b,0) / spends.reduce((a,b)=>a+b,0)) : 2.5;
    const avgCPA     = parseFloat(history.reduce((s,r)=>s+parseFloat(r.cpa??0),0)/history.length+'');

    // 3. Trend: simple linear regression on last 14 days
    const recent14 = revenues.slice(-14);
    const trend    = this.computeTrend(recent14);  // daily revenue delta

    // 4. Read world state for additional signals
    const world   = await this.getWorldState(shop_id);
    const signals = await this.recall(shop_id);

    // 5. Compute stock risks first (needed for flags)
    const stockRisks = await this.computeStockRisksInternal(shop_id, avgRevenue);

    // 6. Generate 14-day forecasts
    const dailyForecasts: DailyForecast[] = [];
    for (let i = 1; i <= 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);

      // Base estimate with trend
      const base = avgRevenue + (trend * i);

      // Seasonality adjustments
      const dowMult     = this.DOW_MULTIPLIERS[date.getDay()];
      const holidayMult = this.isHoliday(date) ? 1.35 : 1.0;  // holidays boost DTC
      const weekMult    = i <= 7 ? 1.0 : 0.95;  // confidence degrades beyond 7 days

      const mid  = base * dowMult * holidayMult;
      const low  = mid * 0.78;
      const high = mid * 1.28;

      const spendForecast = avgSpend * dowMult;
      const confidence    = Math.max(0.4, 0.92 - (i * 0.035)) * weekMult;

      // Flags
      const flags: string[] = [];
      if (date.getDay() === 0 || date.getDay() === 6) flags.push('weekend_boost');
      if (this.isHoliday(date)) flags.push('holiday_boost');
      if (stockRisks.some(r => r.days_until_stockout <= i)) flags.push('stock_risk');
      if ((signals as any)?.competitor_movement?.value?.alert) flags.push('competitor_surge');
      if (world?.empire_mode === 'aggressive') flags.push('scaling_active');

      dailyForecasts.push({
        date: dateStr,
        revenue_low: Math.max(0, low), revenue_mid: Math.max(0, mid), revenue_high: Math.max(0, high),
        spend_forecast: spendForecast,
        roas_forecast: spendForecast > 0 ? mid / spendForecast : avgROAS,
        cpa_forecast: avgCPA,
        confidence,
        flags,
      });
    }

    // 7. Aggregate totals
    const total14RevMid  = dailyForecasts.reduce((s, d) => s + d.revenue_mid, 0);
    const total14Spend   = dailyForecasts.reduce((s, d) => s + d.spend_forecast, 0);
    const avgROASForecast = total14Spend > 0 ? total14RevMid / total14Spend : avgROAS;

    // 8. Generate LLM narrative
    const narrative = await this.generateNarrative(
      dailyForecasts, stockRisks, world, avgRevenue, trend
    );

    // 9. Build opportunities list
    const opportunities = [];
    if (trend > 50) opportunities.push({ type: 'growth_momentum', text: `Revenue trending +€${trend.toFixed(0)}/day — consider scaling budgets` });
    const stockCrits = stockRisks.filter(r => r.critical);
    if (stockCrits.length) opportunities.push({ type: 'reorder_urgent', text: `Reorder ${stockCrits.map(r=>r.sku).join(', ')} — risk €${stockCrits.reduce((s,r)=>s+r.revenue_at_risk,0).toFixed(0)} revenue loss` });
    const peakDays = dailyForecasts.filter(d => d.flags.includes('weekend_boost') || d.flags.includes('holiday_boost'));
    if (peakDays.length) opportunities.push({ type: 'peak_days', text: `${peakDays.length} high-traffic days ahead — pre-scale budgets 24h before` });

    // 10. Persist forecast
    await this.db.query(
      `INSERT INTO forecasts
         (shop_id, forecast_horizon_days, daily_forecasts,
          total_revenue_mid, total_spend_mid, avg_roas_forecast,
          stock_risks, opportunities, lookback_days, seasonality_applied, confidence_overall)
       VALUES ($1,14,$2,$3,$4,$5,$6,$7,30,true,$8)`,
      [
        shop_id, JSON.stringify(dailyForecasts),
        total14RevMid.toFixed(2), total14Spend.toFixed(2), avgROASForecast.toFixed(3),
        JSON.stringify(stockRisks),
        JSON.stringify(opportunities),
        (dailyForecasts.reduce((s, d) => s + d.confidence, 0) / dailyForecasts.length).toFixed(2),
      ]
    );

    // 11. Deposit signals in memory
    await this.remember(shop_id, {
      memory_key:  'forecast_14d',
      memory_type: stockRisks.some(r=>r.critical) ? 'warning' : 'opportunity',
      value: {
        revenue_14d_mid: total14RevMid,
        stock_risks_count: stockRisks.length,
        critical_stock: stockCrits.length,
        trend_daily: trend,
        narrative_summary: narrative.slice(0, 200),
        severity: stockCrits.length > 0 ? 'warning' : 'info',
        message: narrative.slice(0, 150),
      },
      ttl_hours: 24,
    });

    return {
      success: true,
      data: {
        daily_forecasts: dailyForecasts,
        total_revenue_14d: total14RevMid,
        total_spend_14d: total14Spend,
        avg_roas: avgROASForecast,
        stock_risks: stockRisks,
        opportunities,
        narrative,
      },
    };
  }

  private async computeStockRisks(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: metrics } = await this.db.query(
      `SELECT SUM(revenue)/30 AS daily_rev FROM ad_metrics WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '30 days'`,
      [shop_id]
    );
    const risks = await this.computeStockRisksInternal(shop_id, parseFloat(metrics[0]?.daily_rev ?? 0));
    return { success: true, data: { stock_risks: risks } };
  }

  private async computeStockRisksInternal(shopId: string, avgDailyRevenue: number): Promise<StockRisk[]> {
    const { rows: skus } = await this.db.query(
      `SELECT sku, product_name, stock, velocity_per_day
       FROM inventory_skus WHERE shop_id = $1 AND is_active = true`,
      [shopId]
    );

    const risks: StockRisk[] = [];
    for (const sku of skus) {
      const stock    = parseInt(sku.stock ?? 0);
      const vel      = parseFloat(sku.velocity_per_day ?? 0.1);
      const daysLeft = vel > 0 ? Math.floor(stock / vel) : 999;

      if (daysLeft <= 30) {
        // Revenue at risk = daily revenue * days running with no stock
        // Assume 10 days to reorder as default
        const reorderDays = 10;
        const daysWithNoStock = Math.max(0, reorderDays - Math.max(0, daysLeft));
        const revenueAtRisk = daysWithNoStock * (avgDailyRevenue * 0.3); // 30% from this SKU est.

        risks.push({
          sku:                 sku.sku,
          product_name:        sku.product_name,
          current_stock:       stock,
          daily_velocity:      vel,
          days_until_stockout: daysLeft,
          revenue_at_risk:     Math.round(revenueAtRisk),
          critical:            daysLeft <= 10,
        });
      }
    }

    return risks.sort((a, b) => a.days_until_stockout - b.days_until_stockout);
  }

  private async getLatestForecast(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(
      `SELECT * FROM forecasts WHERE shop_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [task.shop_id]
    );
    return { success: true, data: rows[0] ?? null };
  }

  private computeTrend(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((y, x) => {
      num += (x - xMean) * (y - yMean);
      den += (x - xMean) ** 2;
    });
    return den === 0 ? 0 : num / den;
  }

  private isHoliday(date: Date): boolean {
    const mmdd = date.toISOString().slice(5, 10);
    return this.FR_HOLIDAYS_2026.includes(mmdd);
  }

  private async generateNarrative(
    forecasts: DailyForecast[], risks: StockRisk[],
    world: any, avgRevenue: number, trend: number
  ): Promise<string> {
    try {
      const total14 = forecasts.reduce((s, d) => s + d.revenue_mid, 0);
      const peakDay = forecasts.reduce((a, b) => b.revenue_mid > a.revenue_mid ? b : a);
      const riskSummary = risks.length > 0
        ? `Stock risks: ${risks.map(r => `${r.sku} (J+${r.days_until_stockout}, €${r.revenue_at_risk} at risk)`).join(', ')}.`
        : 'No stock risks in 30 days.';

      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 180,
        messages: [{
          role: 'user',
          content: `AEGIS 14-day forecast for DTC brand Blissal (FR market).
Avg daily revenue: €${avgRevenue.toFixed(0)}. Daily trend: ${trend > 0 ? '+' : ''}€${trend.toFixed(0)}/day.
Total 14-day projection: €${total14.toFixed(0)}.
Peak day: ${peakDay.date} (€${peakDay.revenue_mid.toFixed(0)}, flags: ${peakDay.flags.join(',')}).
Empire mode: ${world?.empire_mode ?? 'balanced'}.
${riskSummary}

Write a 2-sentence executive summary for the media buyer. Be specific, data-driven, actionable.`
        }]
      });
      return (resp.content[0] as {text: string}).text;
    } catch {
      return `14-day revenue projection: €${forecasts.reduce((s,d)=>s+d.revenue_mid,0).toFixed(0)} (mid scenario). ${risks.length > 0 ? `⚠ ${risks.length} SKU(s) at stock risk within the forecast window.` : 'No stock risks detected.'}`;
    }
  }
}
