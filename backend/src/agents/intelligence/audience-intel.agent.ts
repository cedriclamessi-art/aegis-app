/**
 * AGENT_AUDIENCE_INTEL v3.8
 * Analyzes performance by audience segment via Meta Insights API.
 * Detects saturation, high-performers, underexplored clusters.
 * Recommends: new audiences to test, exhausted ones to exclude, seeds to refresh.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentAudienceIntel extends BaseAgent {
  readonly name = 'AGENT_AUDIENCE_INTEL';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'analyze':       return this.analyze(task);
      case 'get_recs':      return this.getRecommendations(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async analyze(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const metaToken  = await this.getPlatformToken(shop_id, 'meta');
    const adAccountId = await this.getAdAccountId(shop_id);

    if (!metaToken || !adAccountId) {
      return { success: false, message: 'Meta credentials not configured' };
    }

    // Fetch breakdowns by age, gender, region from Meta Insights
    const [demoData, regionData, interestData] = await Promise.allSettled([
      this.fetchMetaBreakdown(metaToken, adAccountId, 'age,gender'),
      this.fetchMetaBreakdown(metaToken, adAccountId, 'region'),
      this.fetchMetaAudienceInsights(metaToken, adAccountId),
    ]);

    const segments: any[] = [];

    // Process demographic breakdowns
    if (demoData.status === 'fulfilled') {
      for (const row of demoData.value) {
        const key = `${row.gender}_${row.age}`;
        segments.push({
          shop_id, platform: 'meta',
          segment_type: 'demographic',
          segment_key: key,
          segment_label: `${row.gender} ${row.age}`,
          roas: parseFloat(row.purchase_roas?.[0]?.value ?? 0),
          cpa:  parseFloat(row.cost_per_action_type?.[0]?.value ?? 0),
          ctr:  parseFloat(row.ctr ?? 0) / 100,
          cvr:  parseFloat(row.actions?.[0]?.value ?? 0) / Math.max(1, parseInt(row.clicks ?? 1)),
          spend_total: parseFloat(row.spend ?? 0),
          conversions: parseInt(row.actions?.[0]?.value ?? 0),
          frequency: parseFloat(row.frequency ?? 0),
          saturation_pct: Math.min(100, parseFloat(row.reach ?? 0) / 100000 * 100), // rough estimate
        });
      }
    }

    // Process region breakdowns
    if (regionData.status === 'fulfilled') {
      for (const row of regionData.value) {
        segments.push({
          shop_id, platform: 'meta',
          segment_type: 'geo',
          segment_key: `fr_${row.region?.toLowerCase().replace(/\s/g,'_')}`,
          segment_label: row.region,
          roas: parseFloat(row.purchase_roas?.[0]?.value ?? 0),
          cpa:  parseFloat(row.cost_per_action_type?.[0]?.value ?? 0),
          ctr:  parseFloat(row.ctr ?? 0) / 100,
          cvr:  0, spend_total: parseFloat(row.spend ?? 0),
          conversions: parseInt(row.actions?.[0]?.value ?? 0),
          frequency: parseFloat(row.frequency ?? 0),
          saturation_pct: 0,
        });
      }
    }

    // Determine recommendation per segment
    for (const seg of segments) {
      seg.recommendation = this.computeRecommendation(seg);
    }

    // Upsert all segments
    for (const seg of segments) {
      await this.db.query(`
        INSERT INTO audience_segments
          (shop_id, platform, segment_type, segment_key, segment_label,
           roas, cpa, ctr, cvr, spend_total, conversions, frequency, saturation_pct, recommendation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (shop_id, platform, segment_type, segment_key) DO UPDATE SET
          roas=$6, cpa=$7, ctr=$8, cvr=$9, spend_total=$10, conversions=$11,
          frequency=$12, saturation_pct=$13, recommendation=$14, last_analyzed=NOW()`,
        [seg.shop_id, seg.platform, seg.segment_type, seg.segment_key, seg.segment_label,
         seg.roas, seg.cpa, seg.ctr, seg.cvr, seg.spend_total, seg.conversions,
         seg.frequency, seg.saturation_pct, seg.recommendation]);
    }

    // Generate actionable recommendations
    await this.generateRecommendations(shop_id, segments);

    // Deposit memory signal
    const topSegs  = segments.filter(s => s.recommendation === 'scale').slice(0,3);
    const riskSegs = segments.filter(s => s.recommendation === 'pause' || s.recommendation === 'exclude');

    await this.remember(shop_id, {
      memory_key: 'audience_intel', memory_type: riskSegs.length > 0 ? 'warning' : 'opportunity',
      value: {
        analyzed: segments.length,
        top_segments: topSegs.map(s => `${s.segment_label}: ROAS ${s.roas.toFixed(2)}×`),
        saturated: riskSegs.map(s => s.segment_label),
        message: topSegs[0]
          ? `Best audience: ${topSegs[0].segment_label} (ROAS ${topSegs[0].roas.toFixed(2)}×)`
          : 'Audience analysis complete',
        severity: riskSegs.length > 2 ? 'warning' : 'info',
      },
      ttl_hours: 48,
    });

    return { success: true, data: { segments_analyzed: segments.length, top: topSegs, at_risk: riskSegs } };
  }

  private computeRecommendation(seg: any): string {
    const roas = parseFloat(seg.roas ?? 0);
    const freq = parseFloat(seg.frequency ?? 0);
    const sat  = parseFloat(seg.saturation_pct ?? 0);
    const conv = parseInt(seg.conversions ?? 0);

    if (freq > 4.5 || sat > 70) return 'exclude';
    if (freq > 3.5 || sat > 50) return 'pause';
    if (roas > 3.5 && conv > 10) return 'scale';
    if (roas > 2.0 && conv > 5)  return 'maintain';
    if (conv < 3)                 return 'test';
    return 'maintain';
  }

  private async generateRecommendations(shopId: string, segments: any[]): Promise<void> {
    const scale  = segments.filter(s => s.recommendation === 'scale');
    const exclude = segments.filter(s => s.recommendation === 'exclude' || s.recommendation === 'pause');

    const recs: any[] = [];

    for (const seg of scale.slice(0, 2)) {
      recs.push({
        shop_id: shopId, rec_type: 'scale', priority: 'high',
        title: `Scale ${seg.segment_label}`,
        description: `${seg.segment_label} achieves ROAS ${seg.roas.toFixed(2)}× with ${seg.conversions} conversions. Increase budget allocation.`,
        estimated_impact: `+${((seg.roas - 2.5) * 20).toFixed(0)}% ROAS vs average`,
        segment_data: seg,
      });
    }

    for (const seg of exclude.slice(0, 2)) {
      recs.push({
        shop_id: shopId, rec_type: seg.recommendation === 'exclude' ? 'exclude' : 'pause', priority: 'high',
        title: `${seg.recommendation === 'exclude' ? 'Exclude' : 'Pause'} ${seg.segment_label}`,
        description: `Frequency ${seg.frequency.toFixed(1)}× — audience saturated. ${seg.recommendation === 'exclude' ? 'Add to exclusion list.' : 'Pause until refreshed.'}`,
        estimated_impact: `Recover ~€${(seg.spend_total * 0.2).toFixed(0)} wasted spend`,
        segment_data: seg,
      });
    }

    // Check for untested promising segments using LLM
    if (segments.length > 0) {
      try {
        const topPerformer = scale[0];
        if (topPerformer && topPerformer.segment_type === 'demographic') {
          const resp = await this.claude.messages.create({
            model: 'claude-sonnet-4-5', max_tokens: 150,
            messages: [{
              role: 'user',
              content: `Best performing segment for Blissal (FR exfoliating towels): ${topPerformer.segment_label} (ROAS ${topPerformer.roas.toFixed(2)}×). 
Suggest ONE adjacent audience to test next (similar profile, not yet saturated). 
Format: {"segment":"...","rationale":"one sentence"}`
            }]
          });
          const text = (resp.content[0] as any).text.replace(/```json|```/g,'').trim();
          const suggestion = JSON.parse(text);
          recs.push({
            shop_id: shopId, rec_type: 'new_audience', priority: 'medium',
            title: `Test: ${suggestion.segment}`,
            description: suggestion.rationale,
            estimated_impact: 'Unknown — new territory',
          });
        }
      } catch { /* non-critical */ }
    }

    for (const rec of recs) {
      await this.db.query(`
        INSERT INTO audience_recommendations
          (shop_id, rec_type, priority, title, description, estimated_impact, segment_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rec.shop_id, rec.rec_type, rec.priority, rec.title, rec.description,
         rec.estimated_impact ?? null, rec.segment_data ? JSON.stringify(rec.segment_data) : null]);
    }
  }

  private async getRecommendations(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM audience_recommendations
      WHERE shop_id = $1 AND actioned = false AND expires_at > NOW()
      ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               created_at DESC LIMIT 10`, [task.shop_id]);
    return { success: true, data: { recommendations: rows } };
  }

  private async fetchMetaBreakdown(token: string, accountId: string, breakdown: string): Promise<any[]> {
    const fields = 'spend,ctr,frequency,reach,actions,cost_per_action_type,purchase_roas,clicks';
    const res = await fetch(
      `https://graph.facebook.com/v18.0/act_${accountId}/insights?breakdowns=${breakdown}&fields=${fields}&date_preset=last_30d&access_token=${token}`
    );
    const data = await res.json() as any;
    return data.data ?? [];
  }

  private async fetchMetaAudienceInsights(token: string, accountId: string): Promise<any[]> {
    // Fetch custom audience performance
    const res = await fetch(
      `https://graph.facebook.com/v18.0/act_${accountId}/customaudiences?fields=name,approximate_count&access_token=${token}`
    );
    const data = await res.json() as any;
    return data.data ?? [];
  }

  private async getPlatformToken(shopId: string, platform: string): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT access_token FROM platform_credentials WHERE shop_id=$1 AND platform=$2`, [shopId, platform]);
    return rows[0]?.access_token ?? null;
  }

  private async getAdAccountId(shopId: string): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT meta_ad_account_id FROM shops WHERE id=$1`, [shopId]);
    return rows[0]?.meta_ad_account_id ?? null;
  }
}
