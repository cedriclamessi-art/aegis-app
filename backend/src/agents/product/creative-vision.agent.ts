/**
 * AGENT_CREATIVE_VISION v3.6
 * Uses Claude's vision API to automatically tag every creative asset.
 * Extracts: hook type, angle, emotion, face presence, visual style,
 *           text overlay, colors, background, energy level.
 * Builds a knowledge base: "transformation angle + female face + bathroom = 2.3x better CVR"
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';
import * as https from 'https';

const TAGGING_PROMPT = `You are a direct response advertising analyst. Analyze this ad creative and extract structured data.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "has_human_face": boolean,
  "face_gender": "female"|"male"|"multiple"|"none",
  "face_age_range": "18-24"|"25-34"|"35-44"|"45+"|"unknown",
  "emotion_primary": "joy"|"surprise"|"trust"|"fear"|"anticipation"|"neutral",
  "hook_type": "question"|"pov"|"before_after"|"testimonial"|"demo"|"shock"|"curiosity"|"urgency"|"none",
  "content_angle": "transformation"|"social_proof"|"pain"|"curiosity"|"urgency"|"authority"|"comparison"|"identity"|"unknown",
  "visual_style": "ugc"|"studio"|"lifestyle"|"animated"|"text_only"|"mixed",
  "has_text_overlay": boolean,
  "text_overlay_content": "string or null",
  "dominant_colors": ["#hex1", "#hex2"],
  "background_type": "bathroom"|"outdoor"|"studio"|"bedroom"|"kitchen"|"gym"|"none"|"other",
  "product_visible": boolean,
  "has_captions": boolean,
  "has_music": boolean,
  "energy_level": "calm"|"medium"|"high",
  "hook_strength": "weak"|"medium"|"strong",
  "first_frame_appeal": 1|2|3|4|5,
  "notes": "one sentence insight for the media buyer"
}`;

export class AgentCreativeVision extends BaseAgent {
  readonly name = 'AGENT_CREATIVE_VISION';
  private claude: Anthropic;

  constructor(db: any, redis: any) {
    super(db, redis);
    this.claude = new Anthropic();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'tag_creative':     return this.tagCreative(task);
      case 'tag_all_untagged': return this.tagAllUntagged(task);
      case 'update_performance': return this.updatePerformanceData(task);
      case 'get_insights':     return this.getCreativeInsights(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  /**
   * Tag a single creative using Claude vision.
   */
  private async tagCreative(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { creative_id, asset_url, asset_type, duration_seconds } = payload as any;

    // Fetch image/video thumbnail as base64
    let imageData: string;
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';

    try {
      imageData = await this.fetchImageAsBase64(asset_url);
    } catch (err) {
      return { success: false, message: `Could not fetch creative: ${err}` };
    }

    // Call Claude vision
    const resp = await this.claude.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageData },
          },
          {
            type: 'text',
            text: TAGGING_PROMPT + (asset_type === 'video' ? `\n\nNote: This is a ${duration_seconds || 'unknown'}s video (thumbnail shown). Consider typical video ad patterns.` : ''),
          },
        ],
      }],
    });

    const rawAnalysis = (resp.content[0] as { text: string }).text;

    // Parse JSON response
    let tags: Record<string, unknown> = {};
    try {
      const clean = rawAnalysis.replace(/```json|```/g, '').trim();
      tags = JSON.parse(clean);
    } catch {
      return { success: false, message: 'Failed to parse vision response', data: { raw: rawAnalysis } };
    }

    // Persist tags
    await this.db.query(
      `INSERT INTO creative_tags
         (shop_id, creative_id, asset_url, asset_type,
          has_human_face, face_gender, face_age_range, emotion_primary,
          hook_type, content_angle, visual_style, has_text_overlay,
          text_overlay_content, dominant_colors, background_type,
          product_visible, has_captions, has_music, energy_level,
          duration_seconds, raw_analysis, tagged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
       ON CONFLICT (shop_id, creative_id) DO UPDATE SET
         has_human_face      = EXCLUDED.has_human_face,
         face_gender         = EXCLUDED.face_gender,
         hook_type           = EXCLUDED.hook_type,
         content_angle       = EXCLUDED.content_angle,
         visual_style        = EXCLUDED.visual_style,
         raw_analysis        = EXCLUDED.raw_analysis,
         tagged_at           = NOW()`,
      [
        shop_id, creative_id, asset_url, asset_type,
        tags.has_human_face, tags.face_gender, tags.face_age_range, tags.emotion_primary,
        tags.hook_type, tags.content_angle, tags.visual_style, tags.has_text_overlay,
        tags.text_overlay_content, tags.dominant_colors, tags.background_type,
        tags.product_visible, tags.has_captions, tags.has_music, tags.energy_level,
        duration_seconds ?? null, rawAnalysis,
      ]
    );

    return { success: true, data: { creative_id, tags } };
  }

  /**
   * Tag all creatives in the library that haven't been tagged yet.
   * Runs daily.
   */
  private async tagAllUntagged(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: untagged } = await this.db.query(
      `SELECT c.id AS creative_id, c.asset_url, c.asset_type, c.duration_seconds
       FROM creatives c
       LEFT JOIN creative_tags ct ON ct.creative_id = c.id AND ct.shop_id = c.shop_id
       WHERE c.shop_id = $1 AND ct.id IS NULL
       LIMIT 50`,  // process max 50 at a time (API rate)
      [shop_id]
    );

    const results = { tagged: 0, failed: 0 };
    for (const creative of untagged) {
      const r = await this.tagCreative({
        ...task,
        payload: {
          creative_id:      creative.creative_id,
          asset_url:        creative.asset_url,
          asset_type:       creative.asset_type,
          duration_seconds: creative.duration_seconds,
        },
      });
      r.success ? results.tagged++ : results.failed++;

      // Small delay to avoid API rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    return { success: true, data: results };
  }

  /**
   * Update performance data (CTR, ROAS, hook rate) for tagged creatives.
   * Links ad performance back to creative tags for insight generation.
   */
  private async updatePerformanceData(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    await this.db.query(
      `UPDATE creative_tags ct
       SET avg_ctr           = m.avg_ctr,
           avg_roas          = m.avg_roas,
           total_impressions = m.total_impressions,
           total_conversions = m.total_conversions
       FROM (
         SELECT creative_id,
                AVG(ctr) AS avg_ctr, AVG(roas) AS avg_roas,
                SUM(impressions) AS total_impressions, SUM(conversions) AS total_conversions
         FROM ad_metrics_latest WHERE shop_id = $1
         GROUP BY creative_id
       ) m
       WHERE ct.creative_id = m.creative_id AND ct.shop_id = $1`,
      [shop_id]
    );
    return { success: true, message: 'Performance data updated' };
  }

  /**
   * Generate actionable insights from creative performance by tag dimension.
   * "Transformation angle + female face + bathroom background converts 2.3× better"
   */
  private async getCreativeInsights(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Refresh the materialized view first
    await this.db.query('REFRESH MATERIALIZED VIEW creative_tag_performance');

    const { rows: insights } = await this.db.query(
      `SELECT content_angle, hook_type, has_human_face, face_gender, visual_style,
              creative_count, avg_ctr, avg_roas, avg_hook_rate, total_impressions
       FROM creative_tag_performance
       WHERE shop_id = $1 AND total_impressions > 5000
       ORDER BY avg_roas DESC NULLS LAST
       LIMIT 20`,
      [shop_id]
    );

    if (!insights.length) {
      return { success: true, data: { insights: [], message: 'Not enough data yet. Need 5000+ impressions per tag combination.' } };
    }

    // Ask Claude to summarize the top patterns
    const topPatterns = insights.slice(0, 5).map(r =>
      `${r.content_angle} angle + ${r.hook_type} hook + face:${r.has_human_face}(${r.face_gender}) + ${r.visual_style}: ROAS ${parseFloat(r.avg_roas).toFixed(2)}× CTR ${(parseFloat(r.avg_ctr)*100).toFixed(2)}%`
    ).join('\n');

    let summary = '';
    try {
      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Top performing creative patterns for a DTC brand:
${topPatterns}

Bottom performing: ${insights.slice(-2).map(r => `${r.content_angle}+${r.hook_type}: ROAS ${parseFloat(r.avg_roas).toFixed(2)}×`).join(', ')}

Give 2-3 actionable recommendations for future creative production. Be specific and data-driven.`
        }]
      });
      summary = (resp.content[0] as {text: string}).text;
    } catch {
      summary = `Top pattern: ${insights[0]?.content_angle} + ${insights[0]?.hook_type} → ROAS ${parseFloat(insights[0]?.avg_roas).toFixed(2)}×`;
    }

    // Deposit in shared memory
    await this.remember(task.shop_id, {
      memory_key:  'creative_intelligence',
      memory_type: 'opportunity',
      value: { top_angle: insights[0]?.content_angle, top_hook: insights[0]?.hook_type, summary },
      ttl_hours: 24,
    });

    return { success: true, data: { insights, summary } };
  }

  private async fetchImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
