export const PRICING = {
  tiers: {
    1: { name: 'Radar', price: 99, agents: 20, dailyMax: 100 },
    2: { name: 'Brand', price: 199, agents: 40, dailyMax: 500 },
    3: { name: 'Executive', price: 999, agents: 75, dailyMax: 2000 },
    4: { name: 'Suprematie', price: 2999, agents: 225, dailyMax: 10000 },
  },
};

export const GUARDRAILS = {
  stopLossROAS: 0.8,
  killROAS: 0.6,
  humanValidationThreshold: 1000,
  commissionMax: 0.03,
  scalingMultiplier: 3,
  scalingThreshold: 4.5,
};

export const FOUNDERS = (process.env.FOUNDER_EMAILS || '').split(',').map(e => e.trim());

export const PSYCHOMETRIC_MODELS = [
  'scarcity',
  'social_proof',
  'urgency',
  'FOMO',
  'anchoring',
  'reciprocity',
  'authority',
  'liking',
  'commitment',
  'consensus',
  'storytelling',
  'emotional_appeal',
  'loss_aversion',
  'social_proof_numbers',
  'limited_time_offer',
  'exclusive_access',
  'free_trial',
  'money_back_guarantee',
  'testimonials',
  'case_studies',
  'expert_endorsement',
  'celebrity_endorsement',
  'user_generated_content',
  'before_after',
  'problem_solution',
  'pain_point',
  'aspirational',
  'humor',
  'nostalgia',
  'fear_appeal',
  'trust_signals',
  'security_badges',
  'customer_reviews',
  'comparison',
  'demonstration',
  'how_to',
  'educational',
  'inspirational',
  'call_to_action',
  'countdown_timer',
  'stock_indicator',
  'personalization',
];

export const TRIAL_DAYS = 15;
