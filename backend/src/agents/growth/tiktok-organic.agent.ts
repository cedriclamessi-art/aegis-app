/**
 * AGENT_TIKTOK_ORGANIC — v3.4
 * Manages 10-account TikTok organic network for Blissal
 * Detects organic winners → triggers Spark Ad pipeline
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export interface TikTokAccount {
  id: string;
  persona: string;
  handle: string;
  status: 'warmup' | 'active' | 'winner' | 'trending';
  phase: 'warmup' | 'active' | 'full';
}

export interface TikTokVideo {
  videoId: string;
  accountId: string;
  views: number;
  engagement: number;
  retention: number;
  posted_at: Date;
}

export class AgentTikTokOrganic extends BaseAgent {
  readonly name = 'AGENT_TIKTOK_ORGANIC';
  readonly WINNER_THRESHOLD = 10_000; // views to trigger Spark Ad

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'scan_winners': return this.scanWinners(task);
      case 'generate_variations': return this.generateVariations(task);
      case 'trigger_spark_ad': return this.triggerSparkAd(task);
      case 'get_network_stats': return this.getNetworkStats(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  private async scanWinners(task: AgentTask): Promise<AgentResult> {
    // Fetch last 24h videos across all 10 accounts
    const videos = await this.db.query<TikTokVideo>(
      `SELECT * FROM tiktok_videos 
       WHERE shop_id = $1 
       AND posted_at > NOW() - INTERVAL '24 hours'
       AND views >= $2
       ORDER BY views DESC`,
      [task.shop_id, this.WINNER_THRESHOLD]
    );

    const winners = [];
    for (const video of videos.rows) {
      if (video.views >= this.WINNER_THRESHOLD) {
        // Flag as winner and trigger Spark Ad pipeline
        await this.flagWinner(video);
        winners.push(video);
        
        // Emit to orchestrator
        await this.emit('winner_detected', {
          videoId: video.videoId,
          views: video.views,
          engagement: video.engagement,
          action: 'trigger_spark_ad'
        });
      }
    }

    return {
      success: true,
      data: { winners_found: winners.length, winners },
      message: `${winners.length} winner(s) detected above ${this.WINNER_THRESHOLD} views`
    };
  }

  private async generateVariations(task: AgentTask): Promise<AgentResult> {
    const { source_url, accounts, modifications } = task.payload;
    
    const variations = accounts.map((acc: TikTokAccount, i: number) => ({
      account: acc.handle,
      persona: acc.persona,
      hook: `hook_variant_${i + 1}`,
      sound: `trending_sound_${i % 4}`,
      modifications: modifications || ['hook', 'sound', 'crop'],
      status: 'ready'
    }));

    return { success: true, data: { variations }, message: `${variations.length} variations generated` };
  }

  private async triggerSparkAd(task: AgentTask): Promise<AgentResult> {
    const { videoId, budget_per_day } = task.payload;
    
    // Delegate to AGENT_TIKTOK connector
    await this.emit('create_spark_ad', {
      video_id: videoId,
      budget: budget_per_day || 40,
      objective: 'CONVERSIONS',
      optimization_goal: 'PURCHASE'
    });

    return { success: true, data: { videoId, status: 'spark_ad_created' }, message: 'Spark Ad pipeline triggered' };
  }

  private async getNetworkStats(task: AgentTask): Promise<AgentResult> {
    const stats = await this.db.query(
      `SELECT 
         COUNT(*) as total_accounts,
         SUM(total_views) as total_views_30d,
         AVG(engagement_rate) as avg_engagement,
         COUNT(CASE WHEN status = 'winner' THEN 1 END) as winners
       FROM tiktok_accounts WHERE shop_id = $1`,
      [task.shop_id]
    );
    return { success: true, data: stats.rows[0] };
  }

  private async flagWinner(video: TikTokVideo): Promise<void> {
    await this.db.query(
      `UPDATE tiktok_videos SET is_winner = true, winner_flagged_at = NOW() WHERE video_id = $1`,
      [video.videoId]
    );
  }
}
