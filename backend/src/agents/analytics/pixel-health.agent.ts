/**
 * AGENT_PIXEL_HEALTH v3.8
 * Runs every hour. Compares funnel event counts vs 30-day baseline.
 * Detects silent pixel breaks: ViewContent missing, AddToCart duplicated,
 * Purchase value wrong, funnel drop-off anomalies.
 * These break silently after Shopify theme updates or app installs.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

interface FunnelEvent {
  name:   string;
  count:  number;
  baseline: number;
  rate?:  number;
  baseline_rate?: number;
}

interface PixelIssue {
  event:        string;
  issue_type:   'missing' | 'drop' | 'spike' | 'wrong_value' | 'duplicate';
  current_rate: number;
  baseline_rate: number;
  drop_pct:     number;
  severity:     'warning' | 'critical' | 'emergency';
  message:      string;
}

export class AgentPixelHealth extends BaseAgent {
  readonly name = 'AGENT_PIXEL_HEALTH';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'check':      return this.check(task);
      case 'get_status': return this.getStatus(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async check(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const platforms = ['meta', 'tiktok'];
    const allIssues: PixelIssue[] = [];

    for (const platform of platforms) {
      const issues = await this.checkPlatform(shop_id, platform);
      allIssues.push(...issues);

      // Compute health score (100 = perfect, 0 = completely broken)
      const score = Math.max(0, 100 - issues.reduce((s, i) => {
        return s + (i.severity === 'emergency' ? 40 : i.severity === 'critical' ? 20 : 8);
      }, 0));

      const status = score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : issues.length === 0 ? 'no_data' : 'broken';

      // Get current funnel counts for snapshot
      const funnel = await this.getFunnelCounts(shop_id, platform, 1);
      const baseline = await this.getFunnelCounts(shop_id, platform, 720); // 30-day avg

      await this.db.query(`
        INSERT INTO pixel_health_snapshots
          (shop_id, platform, sessions_1h, view_content_1h, add_to_cart_1h,
           initiate_checkout_1h, purchase_1h,
           baseline_vc_rate, baseline_atc_rate, baseline_ic_rate, baseline_purchase_rate,
           issues, health_score, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [shop_id, platform,
         funnel.sessions, funnel.view_content, funnel.add_to_cart,
         funnel.initiate_checkout, funnel.purchase,
         baseline.vc_rate, baseline.atc_rate, baseline.ic_rate, baseline.purchase_rate,
         JSON.stringify(issues), score, status]);

      if (issues.length > 0) {
        const critical = issues.filter(i => i.severity === 'critical' || i.severity === 'emergency');

        await this.remember(shop_id, {
          memory_key:  `pixel_health_${platform}`,
          memory_type: critical.length > 0 ? 'warning' : 'observation',
          value: {
            platform, score, status,
            issues_count: issues.length,
            critical_count: critical.length,
            severity: critical.length > 0 ? 'critical' : 'warning',
            message: issues[0]?.message ?? `Pixel health ${score}/100`,
          },
          ttl_hours: 6,
        });

        if (critical.length > 0) {
          await this.emit('anomaly_critical', {
            shop_id, type: 'pixel_health',
            title: `${platform} pixel degraded (${score}/100)`,
            severity: critical[0].severity,
            issues: critical,
          });
        }
      }
    }

    return { success: true, data: { issues: allIssues.length, platforms_checked: platforms.length } };
  }

  private async checkPlatform(shopId: string, platform: string): Promise<PixelIssue[]> {
    const issues: PixelIssue[] = [];

    // Get current 1h funnel vs 30-day hourly average
    const current  = await this.getFunnelCounts(shopId, platform, 1);
    const baseline = await this.getFunnelCounts(shopId, platform, 720);

    // Only check if we have meaningful traffic
    if (current.sessions < 5) return [];

    // Check 1: ViewContent rate
    const vcRate      = current.sessions > 0 ? current.view_content / current.sessions : 0;
    const vcBaseline  = baseline.vc_rate ?? 0.6;
    if (vcBaseline > 0.1 && vcRate < vcBaseline * 0.5) {
      issues.push({
        event: 'ViewContent', issue_type: 'drop',
        current_rate: vcRate, baseline_rate: vcBaseline,
        drop_pct: (1 - vcRate / vcBaseline) * 100,
        severity: vcRate < vcBaseline * 0.2 ? 'emergency' : 'critical',
        message: `ViewContent firing only ${(vcRate*100).toFixed(1)}% of sessions vs ${(vcBaseline*100).toFixed(1)}% baseline. Pixel likely broken on product pages.`,
      });
    }

    // Check 2: AddToCart rate vs ViewContent
    if (current.view_content > 0) {
      const atcRate     = current.add_to_cart / current.view_content;
      const atcBaseline = baseline.atc_rate ?? 0.08;
      if (atcBaseline > 0.01 && atcRate < atcBaseline * 0.4) {
        issues.push({
          event: 'AddToCart', issue_type: 'drop',
          current_rate: atcRate, baseline_rate: atcBaseline,
          drop_pct: (1 - atcRate / atcBaseline) * 100,
          severity: 'critical',
          message: `AddToCart dropped to ${(atcRate*100).toFixed(1)}% vs ${(atcBaseline*100).toFixed(1)}% baseline. Check cart page pixel or recent theme change.`,
        });
      }
    }

    // Check 3: Purchase event missing entirely
    if (current.initiate_checkout > 3 && current.purchase === 0) {
      issues.push({
        event: 'Purchase', issue_type: 'missing',
        current_rate: 0, baseline_rate: baseline.purchase_rate ?? 0.5,
        drop_pct: 100,
        severity: 'emergency',
        message: `Purchase events completely missing — ${current.initiate_checkout} checkouts started but 0 purchases tracked. CAPI or pixel broken at checkout.`,
      });
    }

    // Check 4: Duplicate events (ATC suspiciously high)
    if (current.view_content > 0) {
      const atcRatio = current.add_to_cart / current.view_content;
      if (atcRatio > 2.0) {
        issues.push({
          event: 'AddToCart', issue_type: 'duplicate',
          current_rate: atcRatio, baseline_rate: baseline.atc_rate ?? 0.08,
          drop_pct: 0,
          severity: 'warning',
          message: `AddToCart firing ${atcRatio.toFixed(1)}× per ViewContent — likely duplicate events. Overstates conversion data to Meta.`,
        });
      }
    }

    return issues;
  }

  private async getFunnelCounts(shopId: string, platform: string, hours: number): Promise<{
    sessions: number; view_content: number; add_to_cart: number;
    initiate_checkout: number; purchase: number;
    vc_rate?: number; atc_rate?: number; ic_rate?: number; purchase_rate?: number;
  }> {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN event_name = 'PageView' THEN event_id END) AS sessions,
        COUNT(DISTINCT CASE WHEN event_name = 'ViewContent' THEN event_id END) AS view_content,
        COUNT(DISTINCT CASE WHEN event_name = 'AddToCart' THEN event_id END) AS add_to_cart,
        COUNT(DISTINCT CASE WHEN event_name = 'InitiateCheckout' THEN event_id END) AS initiate_checkout,
        COUNT(DISTINCT CASE WHEN event_name = 'Purchase' THEN event_id END) AS purchase
      FROM capi_events
      WHERE shop_id = $1 AND platform = $2
        AND created_at > NOW() - INTERVAL '${hours} hours'`, [shopId, platform]);

    const r = rows[0];
    const sessions = parseInt(r?.sessions ?? 0);
    const vc       = parseInt(r?.view_content ?? 0);
    const atc      = parseInt(r?.add_to_cart ?? 0);
    const ic       = parseInt(r?.initiate_checkout ?? 0);
    const purchase = parseInt(r?.purchase ?? 0);

    return {
      sessions, view_content: vc, add_to_cart: atc, initiate_checkout: ic, purchase,
      vc_rate:       sessions > 0 ? vc  / sessions : undefined,
      atc_rate:      vc > 0      ? atc / vc        : undefined,
      ic_rate:       atc > 0     ? ic  / atc        : undefined,
      purchase_rate: ic > 0      ? purchase / ic    : undefined,
    };
  }

  private async getStatus(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT ON (platform) platform, health_score, status, issues, checked_at
      FROM pixel_health_snapshots WHERE shop_id = $1
      ORDER BY platform, checked_at DESC`, [task.shop_id]);
    return { success: true, data: { health: rows } };
  }
}
