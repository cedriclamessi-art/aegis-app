/**
 * TIKTOK ADS CONNECTOR
 * ====================
 * TikTok for Business API v1.3
 *
 * Couvre :
 *   - Campaigns CRUD
 *   - Ad Groups (targeting, budget)
 *   - Creatives (vidéos, images)
 *   - TikTok Pixel (web events)
 *   - Reporting (Basic Report API)
 *   - Audiences Lookalike
 *   - Token OAuth2 avec refresh
 */

import { ConnectorBase, AdCampaign, PerformanceReport } from './connector.base';
import logger from '../utils/logger';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

type TikTokObjective =
  | 'TRAFFIC'
  | 'CONVERSIONS'
  | 'REACH'
  | 'VIDEO_VIEWS'
  | 'ENGAGEMENT'
  | 'APP_PROMOTION'
  | 'LEAD_GENERATION';

type TikTokBudgetType = 'DAILY_BUDGET' | 'LIFETIME_BUDGET';

type TikTokOptimizationGoal =
  | 'CONVERT'
  | 'CLICK'
  | 'REACH'
  | 'IMPRESSION'
  | 'VIDEO_VIEW'
  | 'VALUE';

interface TikTokCampaignParams {
  name:             string;
  objective:        TikTokObjective;
  budget:           number;
  budgetType:       TikTokBudgetType;
  campaignType?:    'REGULAR_CAMPAIGN' | 'IOS14_CAMPAIGN';
}

interface TikTokAdGroupParams {
  campaignId:       string;
  name:             string;
  promotionType:    'WEBSITE' | 'APP_ANDROID' | 'APP_IOS';
  pixelId?:         string;
  externalAction?:  string;
  budget:           number;
  budgetType:       TikTokBudgetType;
  scheduleType:     'SCHEDULE_START_END' | 'SCHEDULE_FROM_NOW';
  startTime:        string;
  endTime?:         string;
  optimizationGoal: TikTokOptimizationGoal;
  bidType:          'BID_TYPE_NO_BID' | 'BID_TYPE_CUSTOM';
  bid?:             number;
  targeting:        TikTokTargeting;
}

interface TikTokTargeting {
  location_ids:         string[];           // pays/régions
  age_groups?:          string[];           // 'AGE_25_34', etc.
  genders?:             string[];           // 'GENDER_MALE' | 'GENDER_FEMALE'
  languages?:           string[];
  interest_category_ids?: string[];
  audience_ids?:        string[];           // Custom/Lookalike audiences
  excluded_audience_ids?: string[];
  device_price_ranges?: number[];
  operating_systems?:   string[];
  placements?:          string[];           // 'PLACEMENT_TIKTOK' | 'PLACEMENT_PANGLE'
}

interface TikTokPixelEvent {
  event:            string;                 // 'Purchase', 'AddToCart', etc.
  event_id?:        string;
  timestamp:        string;                 // ISO 8601
  context: {
    user_agent:     string;
    ip:             string;
    cookie: { ttclid?: string };
    referrer?: { url: string };
    page: { url: string };
  };
  properties?: {
    price?:         number;
    quantity?:      number;
    content_id?:    string;
    content_type?:  string;
    currency?:      string;
    order_id?:      string;
    value?:         number;
  };
  user?: {
    email?:         string[];
    phone_number?:  string[];
    external_id?:   string;
  };
}

export class TikTokConnector extends ConnectorBase {
  readonly platform = 'tiktok';
  readonly baseUrl  = TIKTOK_API_BASE;

  protected buildAuthHeaders(): Record<string, string> {
    return {
      'Access-Token': this.credentials?.accessToken ?? '',
    };
  }

  protected async doTokenRefresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const appId     = process.env.TIKTOK_APP_ID ?? '';
    const appSecret = process.env.TIKTOK_APP_SECRET ?? '';

    const r = await fetch(`${TIKTOK_API_BASE}/oauth2/refresh_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appid:         appId,
        secret:        appSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });

    const data = await r.json() as {
      data: { access_token: string; refresh_token: string; access_token_expire_in: number }
    };

    return {
      accessToken: data.data.access_token,
      expiresAt:   new Date(Date.now() + data.data.access_token_expire_in * 1000),
    };
  }

  private get advertiserId(): string {
    return this.credentials?.accountId ?? '';
  }

  // ── Campaigns ─────────────────────────────────────────────────────────

  async getCampaigns(): Promise<AdCampaign[]> {
    const r = await this.apiRequest<{
      data: { list: Array<Record<string, unknown>> }
    }>(
      'GET',
      `/campaign/get/?advertiser_id=${this.advertiserId}&fields=["campaign_id","campaign_name","status","budget","budget_mode"]`
    );

    return (r.data.list ?? []).map(c => ({
      id:          String(c.campaign_id),
      name:        String(c.campaign_name),
      status:      this.mapStatus(String(c.status)),
      budget:      Number(c.budget ?? 0),
      spend:       0,
      impressions: 0,
      clicks:      0,
      conversions: 0,
      revenue:     0,
      roas:        0,
      cpa:         0,
      cpm:         0,
      ctr:         0,
      startDate:   '',
    }));
  }

  async getPerformanceReport(fromDate: string, toDate: string): Promise<PerformanceReport> {
    const r = await this.apiRequest<{
      data: { list: Array<Record<string, unknown>> }
    }>(
      'POST',
      '/report/integrated/get/',
      {
        advertiser_id:  this.advertiserId,
        report_type:    'BASIC',
        dimensions:     ['stat_time_day'],
        metrics:        ['spend','impressions','clicks','conversions','revenue','real_time_roas','cpa','cpm','ctr'],
        start_date:     fromDate,
        end_date:       toDate,
        data_level:     'AUCTION_ADVERTISER',
      }
    );

    const rows    = r.data.list ?? [];
    const totals  = this.aggregateRows(rows);
    const campaigns = await this.getCampaigns();

    return {
      platform:    'tiktok',
      period:      { from: fromDate, to: toDate },
      ...totals,
      campaigns,
    };
  }

  private aggregateRows(rows: Array<Record<string, unknown>>) {
    return rows.reduce((acc, row) => {
      const m = (row.metrics ?? row) as Record<string, unknown>;
      return {
        spend:       acc.spend       + Number(m.spend       ?? 0),
        revenue:     acc.revenue     + Number(m.revenue     ?? 0),
        roas:        Number(m.real_time_roas ?? 0),
        impressions: acc.impressions + Number(m.impressions ?? 0),
        clicks:      acc.clicks      + Number(m.clicks      ?? 0),
        conversions: acc.conversions + Number(m.conversions ?? 0),
        cpa:         Number(m.cpa   ?? 0),
        cpm:         Number(m.cpm   ?? 0),
        ctr:         Number(m.ctr   ?? 0),
      };
    }, { spend:0, revenue:0, roas:0, impressions:0, clicks:0, conversions:0, cpa:0, cpm:0, ctr:0 });
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', '/campaign/status/update/', {
      advertiser_id: this.advertiserId,
      campaign_ids:  [campaignId],
      operation_status: 'DISABLE',
    });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', '/campaign/status/update/', {
      advertiser_id: this.advertiserId,
      campaign_ids:  [campaignId],
      operation_status: 'ENABLE',
    });
  }

  async updateBudget(campaignId: string, newBudget: number): Promise<void> {
    await this.apiRequest('POST', '/campaign/update/', {
      advertiser_id: this.advertiserId,
      campaign_id:   campaignId,
      budget:        newBudget,
    });
  }

  async createCampaign(params: TikTokCampaignParams): Promise<{ id: string }> {
    const r = await this.apiRequest<{ data: { campaign_id: string } }>(
      'POST',
      '/campaign/create/',
      {
        advertiser_id:  this.advertiserId,
        campaign_name:  params.name,
        objective_type: params.objective,
        budget:         params.budget,
        budget_mode:    params.budgetType,
        campaign_type:  params.campaignType ?? 'REGULAR_CAMPAIGN',
        operation_status: 'DISABLE', // Créé en pause
      }
    );
    logger.info(`[TIKTOK] Campaign créée : ${r.data.campaign_id}`);
    return { id: r.data.campaign_id };
  }

  async createAdGroup(params: TikTokAdGroupParams): Promise<{ id: string }> {
    const r = await this.apiRequest<{ data: { adgroup_id: string } }>(
      'POST',
      '/adgroup/create/',
      {
        advertiser_id:    this.advertiserId,
        campaign_id:      params.campaignId,
        adgroup_name:     params.name,
        promotion_type:   params.promotionType,
        pixel_id:         params.pixelId,
        external_action:  params.externalAction ?? 'PURCHASE',
        budget:           params.budget,
        budget_mode:      params.budgetType,
        schedule_type:    params.scheduleType,
        schedule_start_time: params.startTime,
        schedule_end_time:   params.endTime,
        optimization_goal:   params.optimizationGoal,
        bid_type:         params.bidType,
        bid:              params.bid,
        targeting:        params.targeting,
        operation_status: 'DISABLE',
      }
    );
    return { id: r.data.adgroup_id };
  }

  // ── TikTok Pixel Server-Side ──────────────────────────────────────────

  async sendPixelEvents(pixelCode: string, events: TikTokPixelEvent[]): Promise<{
    code: number; message: string;
  }> {
    const accessToken = process.env.TIKTOK_PIXEL_ACCESS_TOKEN ?? this.credentials?.accessToken ?? '';

    const r = await fetch(`https://business-api.tiktok.com/open_api/v1.3/pixel/track/`, {
      method: 'POST',
      headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pixel_code: pixelCode, event: events }),
    });

    const data = await r.json() as { code: number; message: string };
    logger.info(`[TIKTOK PIXEL] ${events.length} events — code ${data.code}`);
    return data;
  }

  // ── Lookalike Audiences ────────────────────────────────────────────────

  async createLookalike(sourceFileId: string, country: string, type: 'SIMILARITY' | 'REACH'): Promise<{ id: string }> {
    const r = await this.apiRequest<{ data: { audience_id: string } }>(
      'POST',
      '/dmp/custom_audience/lookalike/create/',
      {
        advertiser_id:    this.advertiserId,
        custom_audience_id: sourceFileId,
        lookalike_countries: [country],
        lookalike_spec:   { type },
      }
    );
    return { id: r.data.audience_id };
  }

  private mapStatus(s: string): AdCampaign['status'] {
    const map: Record<string, AdCampaign['status']> = {
      ENABLE:  'ACTIVE',
      DISABLE: 'PAUSED',
      DELETE:  'DELETED',
    };
    return map[s] ?? 'PAUSED';
  }
}
