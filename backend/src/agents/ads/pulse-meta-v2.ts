// src/agents/ads/pulse-meta-v2.ts

import { BaseAgent, AgentConfig, TaskResult } from '../base';
import { PsychologyTrigger } from '../../core/cro/psychology';

interface PulseMetaV2Config extends AgentConfig {
  platform: 'meta';
  adAccountId: string;
  psychologyFocus: PsychologyTrigger[];
}

export class PulseMetaV2Agent extends BaseAgent {
  readonly code = 'PULSE-META-V2';
  readonly module = 'ADS';
  
  private config: PulseMetaV2Config;
  
  async initialize(config: PulseMetaV2Config): Promise<void> {
    await super.initialize(config);
    this.config = config;
    this.validatePsychologyConfig();
  }
  
  async execute(task: CreateCampaignTask): Promise<CampaignResult> {
    // 1. Analyse psychologique audience
    const psychologyProfile = await this.psyche.analyze(
      task.targetAudience
    );
    
    // 2. Sélection trigger optimal
    const primaryTrigger = this.selectOptimalTrigger(
      psychologyProfile,
      this.config.psychologyFocus
    );
    
    // 3. Génération créatifs
    const creatives = await this.creativeFactory.generate({
      count: task.creativeCount,
      psychology: primaryTrigger,
      formats: ['carousel', 'video', 'single_image']
    });
    
    // 4. Création campagne Meta
    const campaign = await this.metaApi.createCampaign({
      name: `[CRO] ${task.brandName} - ${primaryTrigger}`,
      objective: 'CONVERSIONS',
      creatives: creatives,
      targeting: this.buildTargeting(psychologyProfile),
      budget: task.budget
    });
    
    return {
      campaignId: campaign.id,
      psychologyTrigger: primaryTrigger,
      expectedRoas: this.predictRoas(campaign)
    };
  }
  
  private selectOptimalTrigger(
    profile: PsychologyProfile,
    available: PsychologyTrigger[]
  ): PsychologyTrigger {
    // Algorithm de sélection basé sur données historiques
    const scores = available.map(trigger => ({
      trigger,
      score: this.calculateTriggerFit(trigger, profile)
    }));
    
    return scores.sort((a, b) => b.score - a.score)[0].trigger;
  }
}