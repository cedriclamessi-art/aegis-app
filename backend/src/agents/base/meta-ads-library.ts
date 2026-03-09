/**
 * MetaAdsLibrary — Meta Ads Library API + Creative Analysis
 * ==========================================================
 * Inspired by: NiksHacks/meta-ads-library-scraper
 *            + EfrainTorres/armavita-meta-ads-mcp
 *
 * Combines:
 * - Official Meta Graph API v25.0 /ads_archive for structured ad data
 * - Sliding-window rate limiter with exponential backoff
 * - Creative fingerprinting & analysis (CTA, urgency, discount, tone)
 * - Campaign CRUD operations adapted from MCP server patterns
 * - Budget validation & bid strategy helpers
 * - Cursor-based pagination with deduplication
 */

import crypto from 'crypto';

// ── Types — Ad Record ──────────────────────────────────────────────

export interface MetaAdSpendRange {
  min: number | null;
  max: number | null;
  currency: string;
}

export interface MetaAdImpressionRange {
  min: number | null;
  max: number | null;
}

export interface MetaAdDemographic {
  percentage: string;
  age: string;
  gender: string;
}

export interface MetaAdCreative {
  bodies:           string[];
  linkCaptions:     string[];
  linkDescriptions: string[];
  linkTitles:       string[];
  imageUrls:        string[];
  videoUrls:        string[];
  snapshotUrl:      string | null;
  mediaType:        'IMAGE' | 'VIDEO' | 'MEME' | 'NONE' | 'MIXED';
}

export interface MetaAdTargeting {
  ageRange:    string | null;
  gender:      'Male' | 'Female' | 'All' | null;
  locations:   string[];
  platforms:   string[];
}

export interface MetaAdRecord {
  adLibraryId:          string;
  pageId:               string;
  pageName:             string;
  createdAt:            string;
  deliveryStartTime:    string;
  deliveryStopTime:     string | null;
  isActive:             boolean;
  creative:             MetaAdCreative;
  spend:                MetaAdSpendRange;
  impressions:          MetaAdImpressionRange;
  estimatedAudienceSize: MetaAdImpressionRange;
  targeting:            MetaAdTargeting;
  demographics:         MetaAdDemographic[];
  publisherPlatforms:   string[];
  languages:            string[];
  currency:             string;
  scrapedAt:            string;
  source:               'official_api' | 'graphql_interception' | 'manual';
  // AEGIS enrichments
  competitorId?:        string;
  creativeFingerprint?: string;
  creativeAnalysis?:    CreativeAnalysis;
}

// ── Types — Creative Analysis ──────────────────────────────────────

export interface CreativeAnalysis {
  fingerprint:     string;
  wordCount:       number;
  hasEmoji:        boolean;
  hasCTA:          boolean;
  ctaType:         string | null;
  hasUrl:          boolean;
  hasDiscount:     boolean;
  discountValue:   string | null;
  hasUrgency:      boolean;
  estimatedTone:   'promotional' | 'informational' | 'emotional' | 'neutral';
  mediaStrategy:   'image_only' | 'video_only' | 'mixed' | 'text_only';
  hookStrength:    number; // 0-10
}

// ── Types — Campaign Management ────────────────────────────────────

export type CampaignObjective =
  | 'OUTCOME_AWARENESS' | 'OUTCOME_ENGAGEMENT' | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' | 'OUTCOME_APP_PROMOTION';

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP' | 'LOWEST_COST_WITH_MIN_ROAS';

export interface CampaignCreateParams {
  adAccountId:         string;
  name:                string;
  objective:           CampaignObjective;
  status?:             'ACTIVE' | 'PAUSED';
  dailyBudget?:        number;     // In cents
  lifetimeBudget?:     number;     // In cents
  bidStrategy?:        BidStrategy;
  specialAdCategories?: string[];
}

export interface BudgetValidation {
  valid:    boolean;
  errors:   string[];
  warnings: string[];
}

// ── Types — Search ─────────────────────────────────────────────────

export interface MetaAdsSearchParams {
  searchTerms?:         string;
  searchPageIds?:       string[];
  adReachedCountries:   string[];
  adType?:              'ALL' | 'POLITICAL_AND_ISSUE_ADS' | 'HOUSING_ADS';
  adActiveStatus?:      'ACTIVE' | 'INACTIVE' | 'ALL';
  deliveryDateMin?:     string;
  deliveryDateMax?:     string;
  mediaType?:           'ALL' | 'IMAGE' | 'VIDEO' | 'MEME' | 'NONE';
  publisherPlatforms?:  string[];
  languages?:           string[];
  searchType?:          'KEYWORD_UNORDERED' | 'KEYWORD_EXACT_PHRASE';
  limit?:               number;
}

// ── Sliding Window Rate Limiter ────────────────────────────────────

class SlidingWindowRateLimiter {
  private requests: number[] = [];

  constructor(
    private maxRequests: number = 30,
    private windowMs: number = 60_000,
  ) {}

  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.requests = this.requests.filter(t => now - t < this.windowMs);

      if (this.requests.length < this.maxRequests) {
        this.requests.push(now);
        return;
      }

      const oldest = Math.min(...this.requests);
      const waitTime = this.windowMs - (now - oldest) + 100;
      await new Promise(r => setTimeout(r, waitTime));
    }
  }

  getUsage(): { used: number; limit: number; windowMs: number } {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    return { used: this.requests.length, limit: this.maxRequests, windowMs: this.windowMs };
  }
}

// ── Creative Analyzer ──────────────────────────────────────────────

const CTA_PATTERNS = [
  /shop\s+now/i, /buy\s+now/i, /learn\s+more/i, /sign\s+up/i,
  /get\s+started/i, /order\s+now/i, /subscribe/i, /download/i,
  /book\s+now/i, /try\s+(it\s+)?free/i, /claim/i,
  /acheter/i, /commander/i, /d[eé]couvrir/i, /profiter/i,  // French CTAs
];

const URGENCY_PATTERNS = [
  /limited\s+time/i, /hurry/i, /last\s+chance/i,
  /ends?\s+(soon|today|tonight|tomorrow)/i,
  /only\s+\d+\s+left/i, /don'?t\s+miss/i,
  /flash\s+sale/i, /offre\s+limit[eé]e/i, /derni[eè]res?\s+heures?/i,
  /plus\s+que\s+\d+/i,  // French urgency
];

const DISCOUNT_PATTERN = /(\d+\s*%\s*(?:off|de r[eé]duction)|\$\d+\s*off|save\s*\$?\d+|BOGO|buy\s+\d+\s+get\s+\d+|-\d+%)/i;

export function analyzeCreative(ad: MetaAdRecord): CreativeAnalysis {
  const allText = [
    ...ad.creative.bodies,
    ...ad.creative.linkTitles,
    ...ad.creative.linkDescriptions,
  ].join(' ');

  const ctaMatch = CTA_PATTERNS.find(p => p.test(allText));
  const discountMatch = allText.match(DISCOUNT_PATTERN);
  const hasUrgency = URGENCY_PATTERNS.some(p => p.test(allText));

  const hasImages = ad.creative.imageUrls.length > 0 || !!ad.creative.snapshotUrl;
  const hasVideos = ad.creative.videoUrls.length > 0;

  let mediaStrategy: CreativeAnalysis['mediaStrategy'] = 'text_only';
  if (hasImages && hasVideos) mediaStrategy = 'mixed';
  else if (hasVideos) mediaStrategy = 'video_only';
  else if (hasImages) mediaStrategy = 'image_only';

  // Tone estimation
  const promoWords = (allText.match(/sale|deal|discount|offer|save|free|bonus|exclusive|promo|soldes/gi) ?? []).length;
  const emotionalWords = (allText.match(/love|amazing|incredible|dream|transform|life.?changing|r[eê]v/gi) ?? []).length;
  const infoWords = (allText.match(/learn|discover|find out|how to|guide|tips|research|d[eé]couvr/gi) ?? []).length;

  let estimatedTone: CreativeAnalysis['estimatedTone'] = 'neutral';
  const max = Math.max(promoWords, emotionalWords, infoWords);
  if (max > 0) {
    if (max === promoWords) estimatedTone = 'promotional';
    else if (max === emotionalWords) estimatedTone = 'emotional';
    else estimatedTone = 'informational';
  }

  // Hook strength (0-10): measures attention-grabbing power
  let hookStrength = 0;
  if (ctaMatch) hookStrength += 2;
  if (hasUrgency) hookStrength += 2;
  if (discountMatch) hookStrength += 2;
  if (/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}]/u.test(allText)) hookStrength += 1;
  if (allText.length > 0 && allText[0] === allText[0].toUpperCase()) hookStrength += 1;
  if (/\?/.test(allText.split('.')[0] ?? '')) hookStrength += 1; // Opens with question
  if (hasVideos) hookStrength += 1;
  hookStrength = Math.min(hookStrength, 10);

  // Content fingerprint for deduplication
  const normalized = allText.toLowerCase().replace(/\s+/g, ' ').trim();
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${ad.pageId}:${normalized}`)
    .digest('hex')
    .substring(0, 16);

  return {
    fingerprint,
    wordCount: allText.split(/\s+/).filter(Boolean).length,
    hasEmoji: /[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(allText),
    hasCTA: !!ctaMatch,
    ctaType: ctaMatch ? ctaMatch.source.replace(/\\s\+/g, ' ').replace(/[/\\]/g, '') : null,
    hasUrl: /https?:\/\//.test(allText),
    hasDiscount: !!discountMatch,
    discountValue: discountMatch ? discountMatch[1] : null,
    hasUrgency,
    estimatedTone,
    mediaStrategy,
    hookStrength,
  };
}

// ── Meta Ads Library Service ───────────────────────────────────────

const META_API_VERSION = 'v25.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const DEFAULT_AD_FIELDS = [
  'id', 'ad_creation_time', 'ad_creative_bodies',
  'ad_creative_link_captions', 'ad_creative_link_descriptions',
  'ad_creative_link_titles', 'ad_delivery_start_time',
  'ad_delivery_stop_time', 'ad_snapshot_url', 'estimated_audience_size',
  'impressions', 'languages', 'page_id', 'page_name',
  'publisher_platforms', 'demographic_distribution',
  'spend', 'currency', 'target_ages', 'target_gender', 'target_locations',
].join(',');

class MetaAdsLibraryService {
  private rateLimiter: SlidingWindowRateLimiter;
  private seenFingerprints = new Set<string>();

  constructor(
    private accessToken: string,
    opts?: { maxRequestsPerMinute?: number },
  ) {
    this.rateLimiter = new SlidingWindowRateLimiter(
      opts?.maxRequestsPerMinute ?? 30,
    );
  }

  // ── Search Ads Library ────────────────────────────────────────

  async searchAds(params: MetaAdsSearchParams): Promise<MetaAdRecord[]> {
    const allAds: MetaAdRecord[] = [];
    let afterCursor: string | null = null;
    const maxAds = params.limit ?? 100;

    do {
      await this.rateLimiter.waitForSlot();

      const qp: Record<string, string> = {
        access_token: this.accessToken,
        fields: DEFAULT_AD_FIELDS,
        ad_reached_countries: JSON.stringify(params.adReachedCountries),
        limit: String(Math.min(maxAds - allAds.length, 25)),
      };

      if (params.searchTerms) qp.search_terms = params.searchTerms;
      if (params.searchPageIds?.length) qp.search_page_ids = JSON.stringify(params.searchPageIds);
      if (params.adType && params.adType !== 'ALL') qp.ad_type = params.adType;
      if (params.adActiveStatus) qp.ad_active_status = params.adActiveStatus;
      if (params.deliveryDateMin) qp.ad_delivery_date_min = params.deliveryDateMin;
      if (params.deliveryDateMax) qp.ad_delivery_date_max = params.deliveryDateMax;
      if (params.mediaType) qp.media_type = params.mediaType;
      if (params.publisherPlatforms?.length) qp.publisher_platforms = JSON.stringify(params.publisherPlatforms);
      if (params.languages?.length) qp.languages = JSON.stringify(params.languages);
      if (params.searchType) qp.search_type = params.searchType;
      if (afterCursor) qp.after = afterCursor;

      const response = await this.apiRequest('GET', 'ads_archive', qp);
      if (!response.data || response.data.length === 0) break;

      for (const raw of response.data) {
        const record = this.transformAdRecord(raw);
        // Deduplicate by fingerprint
        const analysis = analyzeCreative(record);
        if (!this.seenFingerprints.has(analysis.fingerprint)) {
          this.seenFingerprints.add(analysis.fingerprint);
          record.creativeFingerprint = analysis.fingerprint;
          record.creativeAnalysis = analysis;
          allAds.push(record);
        }
      }

      afterCursor = response.paging?.cursors?.after ?? null;

      // Prune dedup set if too large
      if (this.seenFingerprints.size > 1000) {
        const arr = Array.from(this.seenFingerprints);
        this.seenFingerprints = new Set(arr.slice(-500));
      }

      // Jittered delay
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    } while (afterCursor && allAds.length < maxAds);

    return allAds;
  }

  // ── Competitor Ads ────────────────────────────────────────────

  async getCompetitorAds(
    pageIds: string[],
    countries: string[] = ['FR'],
    daysBack = 30,
  ): Promise<MetaAdRecord[]> {
    const dateMin = new Date();
    dateMin.setDate(dateMin.getDate() - daysBack);

    return this.searchAds({
      searchPageIds: pageIds,
      adReachedCountries: countries,
      adActiveStatus: 'ALL',
      deliveryDateMin: dateMin.toISOString().split('T')[0],
    });
  }

  // ── Campaign CRUD ─────────────────────────────────────────────

  async createCampaign(params: CampaignCreateParams): Promise<unknown> {
    const validation = validateBudgetConfig(params);
    if (!validation.valid) {
      throw new Error(`Budget validation failed: ${validation.errors.join(', ')}`);
    }

    const accountId = params.adAccountId.startsWith('act_')
      ? params.adAccountId : `act_${params.adAccountId}`;

    const payload: Record<string, string> = {
      name: params.name,
      objective: params.objective,
      status: params.status ?? 'PAUSED',
      special_ad_categories: JSON.stringify(params.specialAdCategories ?? ['NONE']),
    };

    if (params.dailyBudget) payload.daily_budget = String(params.dailyBudget);
    if (params.lifetimeBudget) payload.lifetime_budget = String(params.lifetimeBudget);
    if (params.bidStrategy) payload.bid_strategy = params.bidStrategy;

    if (!params.dailyBudget && !params.lifetimeBudget) {
      payload.daily_budget = '2000'; // $20 default
    }

    return this.apiRequest('POST', `${accountId}/campaigns`, payload);
  }

  // ── Insights ──────────────────────────────────────────────────

  async getInsights(objectId: string, opts?: {
    dateRange?: string | { since: string; until: string };
    level?: 'account' | 'campaign' | 'adset' | 'ad';
    breakdowns?: string[];
    limit?: number;
  }): Promise<unknown> {
    const params: Record<string, string> = {
      fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,action_values,conversions,cost_per_action_type',
      level: opts?.level ?? 'ad',
      limit: String(opts?.limit ?? 25),
    };

    if (!opts?.dateRange || typeof opts.dateRange === 'string') {
      params.date_preset = (opts?.dateRange as string) ?? 'last_30d';
    } else {
      params.time_range = JSON.stringify(opts.dateRange);
    }

    if (opts?.breakdowns?.length) {
      params.breakdowns = opts.breakdowns.join(',');
    }

    return this.apiRequest('GET', `${objectId}/insights`, params);
  }

  // ── Private Helpers ───────────────────────────────────────────

  private async apiRequest(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, string> = {},
    retries = 3,
  ): Promise<any> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.rateLimiter.waitForSlot();

        const url = endpoint.startsWith('http') ? endpoint : `${META_API_BASE}/${endpoint}`;
        params.access_token = this.accessToken;

        let response: Response;
        if (method === 'GET') {
          const qs = new URLSearchParams(params).toString();
          response = await fetch(`${url}?${qs}`, {
            headers: { 'User-Agent': 'aegis-meta-ads/1.0' },
            signal: AbortSignal.timeout(30_000),
          });
        } else {
          response = await fetch(url, {
            method,
            headers: {
              'User-Agent': 'aegis-meta-ads/1.0',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(params),
            signal: AbortSignal.timeout(30_000),
          });
        }

        const body = await response.json() as Record<string, any>;

        if (!response.ok) {
          const errorCode = body?.error?.code;

          // Rate limited (613) — exponential backoff
          if (errorCode === 613 || response.status === 429) {
            const backoff = Math.pow(2, attempt) * 5000 + Math.random() * 5000;
            await new Promise(r => setTimeout(r, backoff));
            continue;
          }

          // Invalid token (190)
          if (errorCode === 190) {
            throw new Error('Invalid or expired Meta API access token');
          }

          // Server errors — retry
          if (attempt < retries && response.status >= 500) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
            continue;
          }

          throw new Error(`Meta API error ${response.status}: ${JSON.stringify(body?.error)}`);
        }

        return body;
      } catch (err) {
        if (attempt === retries) throw err;
      }
    }
  }

  private transformAdRecord(raw: any): MetaAdRecord {
    return {
      adLibraryId:       raw.id,
      pageId:            raw.page_id,
      pageName:          raw.page_name,
      createdAt:         raw.ad_creation_time,
      deliveryStartTime: raw.ad_delivery_start_time,
      deliveryStopTime:  raw.ad_delivery_stop_time ?? null,
      isActive:          !raw.ad_delivery_stop_time,
      creative: {
        bodies:           raw.ad_creative_bodies ?? [],
        linkCaptions:     raw.ad_creative_link_captions ?? [],
        linkDescriptions: raw.ad_creative_link_descriptions ?? [],
        linkTitles:       raw.ad_creative_link_titles ?? [],
        imageUrls:        [],
        videoUrls:        [],
        snapshotUrl:      raw.ad_snapshot_url ?? null,
        mediaType:        'MIXED',
      },
      spend: {
        min: raw.spend?.lower_bound ?? null,
        max: raw.spend?.upper_bound ?? null,
        currency: raw.currency ?? 'EUR',
      },
      impressions: {
        min: raw.impressions?.lower_bound ?? null,
        max: raw.impressions?.upper_bound ?? null,
      },
      estimatedAudienceSize: {
        min: raw.estimated_audience_size?.lower_bound ?? null,
        max: raw.estimated_audience_size?.upper_bound ?? null,
      },
      targeting: {
        ageRange: raw.target_ages?.length
          ? `${raw.target_ages[0]}-${raw.target_ages[raw.target_ages.length - 1]}` : null,
        gender: raw.target_gender ?? null,
        locations: (raw.target_locations ?? []).map((l: any) => l.name),
        platforms: raw.publisher_platforms ?? [],
      },
      demographics: (raw.demographic_distribution ?? []).map((d: any) => ({
        percentage: d.percentage, age: d.age, gender: d.gender,
      })),
      publisherPlatforms: raw.publisher_platforms ?? [],
      languages:          raw.languages ?? [],
      currency:           raw.currency ?? 'EUR',
      scrapedAt:          new Date().toISOString(),
      source:             'official_api',
    };
  }
}

// ── Budget Validation ──────────────────────────────────────────────

export function validateBudgetConfig(params: {
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidStrategy?: string;
}): BudgetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (params.dailyBudget && params.lifetimeBudget) {
    errors.push('Cannot set both daily_budget and lifetime_budget');
  }

  if (params.bidStrategy === 'LOWEST_COST_WITH_BID_CAP') {
    warnings.push('LOWEST_COST_WITH_BID_CAP requires bid_amount on the ad set');
  }

  if (params.dailyBudget && params.dailyBudget < 100) {
    errors.push('daily_budget must be at least 100 cents ($1.00)');
  }

  if (params.lifetimeBudget && params.lifetimeBudget < 100) {
    errors.push('lifetime_budget must be at least 100 cents ($1.00)');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Factory ────────────────────────────────────────────────────────

export function createMetaAdsLibrary(
  accessToken?: string,
  opts?: { maxRequestsPerMinute?: number },
): MetaAdsLibraryService {
  const token = accessToken ?? process.env.META_ADS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? '';
  return new MetaAdsLibraryService(token, opts);
}

export { MetaAdsLibraryService, SlidingWindowRateLimiter };
