/**
 * AGENT_GA4 v4.1
 * Pulls session and conversion data from Google Analytics 4.
 * Cross-validates against Meta/TikTok pixel data.
 * Detects divergences that indicate pixel problems or attribution gaps.
 * Truth from both sides = better decisions.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentGA4 extends BaseAgent {
  readonly name = 'AGENT_GA4';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'sync':              return this.sync(task);
      case 'check_divergence':  return this.checkDivergence(task);
      case 'get_report':        return this.getReport(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Daily sync — pull last 7 days from GA4 Data API. */
  private async sync(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const creds = await this.getGA4Credentials(shop_id);
    if (!creds) return { success: false, message: 'GA4 not configured — add property_id and service_account in settings' };

    const rows = await this.fetchGA4Report(creds.property_id, creds.access_token);

    for (const row of rows) {
      await this.db.query(`
        INSERT INTO ga4_sessions
          (shop_id, session_date, source, medium, campaign,
           sessions, users, new_users, bounce_rate, pages_per_session,
           avg_session_duration, transactions, revenue)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (shop_id, session_date, source, medium, campaign) DO UPDATE SET
          sessions=$6, users=$7, new_users=$8, bounce_rate=$9,
          pages_per_session=$10, avg_session_duration=$11,
          transactions=$12, revenue=$13`,
        [shop_id, row.date, row.source, row.medium, row.campaign,
         row.sessions, row.users, row.new_users, row.bounce_rate,
         row.pages_per_session, row.avg_session_duration,
         row.transactions, row.revenue]);
    }

    await this.checkDivergence({ ...task, type: 'check_divergence' });

    return { success: true, data: { rows_synced: rows.length } };
  }

  /**
   * Cross-validates GA4 conversions vs pixel events.
   * Divergence > 20% = likely pixel issue.
   */
  private async checkDivergence(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const platforms = ['meta', 'tiktok'];
    const issues: any[] = [];

    for (const platform of platforms) {
      // GA4: transactions from paid social matching platform
      const mediumMap: Record<string, string> = { meta: 'cpc', tiktok: 'paid_social' };
      const { rows: ga4 } = await this.db.query(`
        SELECT
          session_date,
          SUM(sessions)     AS sessions,
          SUM(transactions) AS conversions
        FROM ga4_sessions
        WHERE shop_id=$1
          AND (medium=$2 OR source ILIKE $3)
          AND session_date > CURRENT_DATE - INTERVAL '7 days'
        GROUP BY session_date`, [shop_id, mediumMap[platform], `%${platform}%`]);

      // Pixel: purchase events from platform
      const { rows: pixel } = await this.db.query(`
        SELECT
          DATE(created_at) AS session_date,
          COUNT(DISTINCT CASE WHEN event_name='PageView' THEN event_id END)  AS sessions,
          COUNT(DISTINCT CASE WHEN event_name='Purchase' THEN event_id END)  AS conversions
        FROM capi_events
        WHERE shop_id=$1 AND platform=$2 AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)`, [shop_id, platform]);

      // Match by date and compute divergence
      for (const ga of ga4) {
        const pix = pixel.find((p: any) => p.session_date === ga.session_date);
        if (!pix) continue;

        const ga4Conv  = parseInt(ga.conversions ?? 0);
        const pixConv  = parseInt(pix.conversions ?? 0);
        const divPct   = ga4Conv > 0 ? Math.abs(pixConv - ga4Conv) / ga4Conv * 100 : 0;

        await this.db.query(`
          INSERT INTO ga4_pixel_divergence
            (shop_id, divergence_date, platform, ga4_sessions, pixel_sessions, ga4_conversions, pixel_conversions)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (shop_id, divergence_date, platform) DO UPDATE SET
            ga4_sessions=$4, pixel_sessions=$5, ga4_conversions=$6, pixel_conversions=$7`,
          [shop_id, ga.session_date, platform, ga.sessions, pix.sessions, ga4Conv, pixConv]);

        if (divPct > 20) {
          issues.push({ platform, date: ga.session_date, ga4: ga4Conv, pixel: pixConv, pct: divPct.toFixed(1) });
        }
      }
    }

    if (issues.length > 0) {
      await this.remember(shop_id, {
        memory_key: 'ga4_pixel_divergence', memory_type: 'warning',
        value: {
          issues: issues.length,
          worst: issues.sort((a,b) => b.pct - a.pct)[0],
          message: `Divergence GA4/pixel détectée: ${issues[0].platform} ${issues[0].pct}% le ${issues[0].date}`,
          severity: issues.some((i: any) => i.pct > 40) ? 'critical' : 'warning',
        },
        ttl_hours: 24,
      });

      if (issues.some((i: any) => i.pct > 40)) {
        await this.emit('anomaly_critical', {
          shop_id, type: 'ga4_pixel_divergence',
          title: `Divergence GA4/pixel critique (${issues[0].platform}: ${issues[0].pct}%)`,
          severity: 'critical', details: issues,
        });
      }
    }

    return { success: true, data: { divergences: issues } };
  }

  private async getReport(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM ga4_pixel_divergence
      WHERE shop_id=$1 ORDER BY divergence_date DESC LIMIT 30`, [task.shop_id]);
    return { success: true, data: { divergences: rows } };
  }

  private async fetchGA4Report(propertyId: string, accessToken: string): Promise<any[]> {
    try {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            dimensions: [
              { name: 'date' },
              { name: 'sessionSource' },
              { name: 'sessionMedium' },
              { name: 'sessionCampaignName' },
            ],
            metrics: [
              { name: 'sessions' },
              { name: 'activeUsers' },
              { name: 'newUsers' },
              { name: 'bounceRate' },
              { name: 'screenPageViewsPerSession' },
              { name: 'averageSessionDuration' },
              { name: 'transactions' },
              { name: 'purchaseRevenue' },
            ],
          }),
        }
      );
      const data = await res.json() as any;
      if (!data.rows) return [];

      return data.rows.map((row: any) => {
        const d  = row.dimensionValues.map((v: any) => v.value);
        const m  = row.metricValues.map((v: any) => parseFloat(v.value));
        return {
          date: d[0], source: d[1], medium: d[2], campaign: d[3] || '(none)',
          sessions: m[0], users: m[1], new_users: m[2], bounce_rate: m[3],
          pages_per_session: m[4], avg_session_duration: Math.round(m[5]),
          transactions: m[6], revenue: m[7],
        };
      });
    } catch {
      return [];
    }
  }

  private async getGA4Credentials(shopId: string): Promise<{ property_id: string; access_token: string } | null> {
    const { rows } = await this.db.query(
      `SELECT property_id, access_token FROM platform_credentials WHERE shop_id=$1 AND platform='ga4'`,
      [shopId]);
    return rows[0] ?? null;
  }
}
