/**
 * PINTEREST ADS CONNECTOR
 * =======================
 * Pinterest API v5
 *
 * Couvre : Campaigns · Ad Groups · Audiences · Reporting · Conversion Tags
 */

import { ConnectorBase, AdCampaign, PerformanceReport } from './connector.base';
import logger from '../utils/logger';

type PinterestObjective =
  | 'AWARENESS'
  | 'CONSIDERATION'
  | 'WEB_CONVERSION'
  | 'CATALOG_SALES'
  | 'VIDEO_VIEW';

interface PinterestCampaignParams {
  name:        string;
  objective:   PinterestObjective;
  budget:      number;
  startDate?:  string;
  endDate?:    string;
}

interface PinterestConversionEvent {
  event_name:   'checkout' | 'add_to_cart' | 'page_visit' | 'signup' | 'lead' | 'view_category' | 'custom';
  action_source: 'web' | 'app_android' | 'app_ios' | 'offline' | 'crm';
  event_time:   number;
  event_id?:    string;
  user_data: {
    em?:    string[];
    ph?:    string[];
    fn?:    string;
    ln?:    string;
    ge?:    string;
    db?:    string;
    ct?:    string;
    st?:    string;
    zp?:    string;
    country?: string;
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data?: {
    currency?:    string;
    value?:       number;
    order_id?:    string;
    content_ids?: string[];
    contents?:    Array<{ id: string; quantity: number; item_price: string }>;
    num_items?:   number;
    opt_out_type?: 'LDP';
  };
  app_data?: { application_tracking_enabled?: boolean };
}

export class PinterestConnector extends ConnectorBase {
  readonly platform = 'pinterest';
  readonly baseUrl  = 'https://api.pinterest.com/v5';

  protected buildAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.credentials?.accessToken}` };
  }

  protected async doTokenRefresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const r = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        scope:         'ads:read,ads:write,catalogs:read,catalogs:write',
      }),
    });

    const data = await r.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt:   new Date(Date.now() + data.expires_in * 1000),
    };
  }

  private get adAccountId(): string { return this.credentials?.accountId ?? ''; }

  async getCampaigns(): Promise<AdCampaign[]> {
    const r = await this.apiRequest<{ items: Array<Record<string, unknown>> }>(
      'GET', `/ad_accounts/${this.adAccountId}/campaigns`
    );

    return (r.items ?? []).map(c => ({
      id:          String(c.id),
      name:        String(c.name),
      status:      this.mapStatus(String(c.status)),
      budget:      Number(c.daily_spend_cap ?? 0) / 1_000_000, // Pinterest : micro-currency
      spend:       0, impressions: 0, clicks: 0,
      conversions: 0, revenue: 0, roas: 0,
      cpa: 0, cpm: 0, ctr: 0, startDate: String(c.start_time ?? ''),
    }));
  }

  async getPerformanceReport(fromDate: string, toDate: string): Promise<PerformanceReport> {
    const r = await this.apiRequest<{ value: Array<Record<string, unknown>> }>(
      'GET',
      `/ad_accounts/${this.adAccountId}/analytics?` +
      `start_date=${fromDate}&end_date=${toDate}&` +
      `columns=SPEND_IN_DOLLAR,TOTAL_CHECKOUT,TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR,` +
      `IMPRESSION_1,CLICK_1,CTR_2,TOTAL_CLICKTHROUGH,CPM_IN_DOLLAR,ROAS`
    );

    const row = r.value?.[0] ?? {};
    const campaigns = await this.getCampaigns();

    return {
      platform:    'pinterest',
      period:      { from: fromDate, to: toDate },
      spend:       Number(row.SPEND_IN_DOLLAR ?? 0),
      revenue:     Number(row.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0) / 1_000_000,
      roas:        Number(row.ROAS ?? 0),
      impressions: Number(row.IMPRESSION_1 ?? 0),
      clicks:      Number(row.CLICK_1 ?? 0),
      conversions: Number(row.TOTAL_CHECKOUT ?? 0),
      cpa:         0,
      cpm:         Number(row.CPM_IN_DOLLAR ?? 0),
      ctr:         Number(row.CTR_2 ?? 0),
      campaigns,
    };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('PATCH', `/ad_accounts/${this.adAccountId}/campaigns`, [{
      id: campaignId, status: 'PAUSED',
    }]);
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('PATCH', `/ad_accounts/${this.adAccountId}/campaigns`, [{
      id: campaignId, status: 'ACTIVE',
    }]);
  }

  async updateBudget(campaignId: string, newBudget: number): Promise<void> {
    await this.apiRequest('PATCH', `/ad_accounts/${this.adAccountId}/campaigns`, [{
      id: campaignId, daily_spend_cap: Math.round(newBudget * 1_000_000),
    }]);
  }

  async createCampaign(params: PinterestCampaignParams): Promise<{ id: string }> {
    const r = await this.apiRequest<{ id: string }>(
      'POST',
      `/ad_accounts/${this.adAccountId}/campaigns`,
      {
        name:          params.name,
        objective_type: params.objective,
        status:        'PAUSED',
        start_time:    params.startDate ?? Math.floor(Date.now() / 1000),
        end_time:      params.endDate,
      }
    );
    logger.info(`[PINTEREST] Campaign créée : ${r.id}`);
    return r;
  }

  // Pinterest Conversions API
  async sendConversionEvents(conversionAccessToken: string, adAccountId: string, events: PinterestConversionEvent[]): Promise<{
    num_events_received: number; num_events_failable: number;
  }> {
    const r = await fetch(`https://api.pinterest.com/v5/ad_accounts/${adAccountId}/events`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${conversionAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: events }),
    });
    const data = await r.json() as { num_events_received: number; num_events_failable: number };
    logger.info(`[PINTEREST CAPI] ${data.num_events_received} events reçus`);
    return data;
  }

  private mapStatus(s: string): AdCampaign['status'] {
    return ({ ACTIVE:'ACTIVE', PAUSED:'PAUSED', ARCHIVED:'ARCHIVED' } as Record<string, AdCampaign['status']>)[s] ?? 'PAUSED';
  }
}

// ══════════════════════════════════════════════════════════════════════════════

/**
 * SNAPCHAT ADS CONNECTOR
 * ======================
 * Snapchat Marketing API v1
 *
 * Couvre : Campaigns · Ad Squads · Snap Pixel · Conversions API · Audiences
 */

import { ConnectorBase as CB2, AdCampaign as AC2, PerformanceReport as PR2 } from './connector.base';

type SnapObjective =
  | 'AWARENESS'
  | 'APP_INSTALLS'
  | 'DRIVE_TRAFFIC_TO_WEBSITE'
  | 'PROMOTE_PLACES'
  | 'VIDEO_VIEWS'
  | 'LEAD_GENERATION'
  | 'CATALOG_SALES'
  | 'WEB_CONVERSIONS';

interface SnapCampaignParams {
  name:        string;
  objective:   SnapObjective;
  budget:      number;
  startTime:   string;
  endTime?:    string;
}

interface SnapPixelEvent {
  pixel_id:      string;
  event_type:    'PURCHASE' | 'ADD_CART' | 'START_CHECKOUT' | 'VIEW_CONTENT' | 'PAGE_VIEW' | 'SIGN_UP' | 'SEARCH';
  event_conversion_type: 'WEB' | 'OFFLINE' | 'APP';
  timestamp:     string;
  uuid_c1?:      string;   // _scid cookie
  event_id?:     string;
  user_data: {
    em?:         string[];
    ph?:         string[];
    fn?:         string;
    ln?:         string;
    ip_address?: string;
    user_agent?: string;
  };
  custom_data?: {
    currency:    string;
    price:       number;
    item_ids?:   string[];
    number_items?: number;
    transaction_id?: string;
  };
}

export class SnapchatConnector extends CB2 {
  readonly platform = 'snapchat';
  readonly baseUrl  = 'https://adsapi.snapchat.com/v1';

  protected buildAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.credentials?.accessToken}` };
  }

  protected async doTokenRefresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const r = await fetch('https://accounts.snapchat.com/login/oauth2/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.SNAPCHAT_CLIENT_ID ?? '',
        client_secret: process.env.SNAPCHAT_CLIENT_SECRET ?? '',
      }),
    });
    const data = await r.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt:   new Date(Date.now() + data.expires_in * 1000),
    };
  }

  private get adAccountId(): string { return this.credentials?.accountId ?? ''; }

  async getCampaigns(): Promise<AC2[]> {
    const r = await this.apiRequest<{ campaigns: Array<{ campaign: Record<string, unknown> }> }>(
      'GET', `/adaccounts/${this.adAccountId}/campaigns`
    );

    return (r.campaigns ?? []).map(({ campaign: c }) => ({
      id:          String(c.id),
      name:        String(c.name),
      status:      this.mapStatus(String(c.status)),
      budget:      Number(c.daily_budget_micro ?? 0) / 1_000_000,
      spend:       0, impressions: 0, clicks: 0,
      conversions: 0, revenue: 0, roas: 0,
      cpa: 0, cpm: 0, ctr: 0, startDate: String(c.start_time ?? ''),
    }));
  }

  async getPerformanceReport(fromDate: string, toDate: string): Promise<PR2> {
    const r = await this.apiRequest<{ request_status: string; rows: Array<Record<string, unknown>> }>(
      'GET',
      `/adaccounts/${this.adAccountId}/stats?` +
      `start_time=${fromDate}T00:00:00.000Z&end_time=${toDate}T23:59:59.999Z&` +
      `fields=spend,impressions,swipes,conversions,conversion_purchases_value,roas,ecpm,swipe_up_rate`
    );

    const row = r.rows?.[0] ?? {};
    const campaigns = await this.getCampaigns();

    return {
      platform:    'snapchat',
      period:      { from: fromDate, to: toDate },
      spend:       Number(row.spend ?? 0) / 1_000_000,
      revenue:     Number(row.conversion_purchases_value ?? 0) / 1_000_000,
      roas:        Number(row.roas ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks:      Number(row.swipes ?? 0),
      conversions: Number(row.conversions ?? 0),
      cpa:         0,
      cpm:         Number(row.ecpm ?? 0) / 1_000_000,
      ctr:         Number(row.swipe_up_rate ?? 0),
      campaigns,
    };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('PUT', `/campaigns/${campaignId}`, {
      campaigns: [{ id: campaignId, status: 'PAUSED' }],
    });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('PUT', `/campaigns/${campaignId}`, {
      campaigns: [{ id: campaignId, status: 'ACTIVE' }],
    });
  }

  async updateBudget(campaignId: string, newBudget: number): Promise<void> {
    await this.apiRequest('PUT', `/campaigns/${campaignId}`, {
      campaigns: [{ id: campaignId, daily_budget_micro: Math.round(newBudget * 1_000_000) }],
    });
  }

  async createCampaign(params: SnapCampaignParams): Promise<{ id: string }> {
    const r = await this.apiRequest<{ campaigns: [{ campaign: { id: string } }] }>(
      'POST',
      `/adaccounts/${this.adAccountId}/campaigns`,
      {
        campaigns: [{
          name:              params.name,
          objective:         params.objective,
          status:            'PAUSED',
          start_time:        params.startTime,
          end_time:          params.endTime,
          daily_budget_micro: Math.round(params.budget * 1_000_000),
        }],
      }
    );
    return { id: r.campaigns[0].campaign.id };
  }

  // Snap Conversions API (CAPI)
  async sendConversionEvents(pixelId: string, events: SnapPixelEvent[]): Promise<{ status: string }> {
    const r = await fetch(`https://tr.snapchat.com/v2/conversion`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${this.credentials?.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: events }),
    });
    const data = await r.json() as { status: string };
    logger.info(`[SNAP CAPI] ${events.length} events — status: ${data.status}`);
    return data;
  }

  private mapStatus(s: string): AC2['status'] {
    return ({ ACTIVE:'ACTIVE', PAUSED:'PAUSED', DELETED:'DELETED' } as Record<string, AC2['status']>)[s] ?? 'PAUSED';
  }
}

// ══════════════════════════════════════════════════════════════════════════════

/**
 * GOOGLE ADS CONNECTOR
 * ====================
 * Google Ads API v15 (REST)
 *
 * Couvre : Campaigns · Ad Groups · Shopping · Reporting GAQL · Conversions
 */

import { ConnectorBase as CB3, AdCampaign as AC3, PerformanceReport as PR3 } from './connector.base';

type GoogleCampaignType =
  | 'SEARCH'
  | 'DISPLAY'
  | 'SHOPPING'
  | 'PERFORMANCE_MAX'
  | 'VIDEO'
  | 'SMART';

interface GoogleCampaignParams {
  name:         string;
  campaignType: GoogleCampaignType;
  budget:       number;      // daily micro (€ * 1_000_000)
  targetRoas?:  number;      // ROAS cible (ex: 3.5)
  targetCpa?:   number;      // CPA cible en micros
}

export class GoogleAdsConnector extends CB3 {
  readonly platform = 'google';
  readonly baseUrl  = 'https://googleads.googleapis.com/v15';

  protected buildAuthHeaders(): Record<string, string> {
    return {
      'Authorization':      `Bearer ${this.credentials?.accessToken}`,
      'developer-token':    process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
      'login-customer-id':  process.env.GOOGLE_ADS_MCC_ID ?? '',
    };
  }

  protected async doTokenRefresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.GOOGLE_CLIENT_ID     ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      }),
    });
    const data = await r.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt:   new Date(Date.now() + data.expires_in * 1000),
    };
  }

  private get customerId(): string {
    return this.credentials?.accountId?.replace(/-/g, '') ?? '';
  }

  // ── GAQL Query Helper ─────────────────────────────────────────────────

  private async gaqlQuery<T>(query: string): Promise<{ results: T[] }> {
    return this.apiRequest('POST', `/customers/${this.customerId}/googleAds:search`, { query });
  }

  async getCampaigns(): Promise<AC3[]> {
    const r = await this.gaqlQuery<{ campaign: Record<string, unknown>; metrics: Record<string, unknown> }>(
      `SELECT
         campaign.id, campaign.name, campaign.status,
         campaign_budget.amount_micros,
         metrics.cost_micros, metrics.impressions, metrics.clicks,
         metrics.conversions, metrics.conversions_value,
         metrics.average_cpc, metrics.average_cpm, metrics.ctr
       FROM campaign
       WHERE segments.date DURING LAST_7_DAYS`
    );

    return r.results.map(({ campaign: c, metrics: m }) => {
      const spend = Number(m.cost_micros ?? 0) / 1_000_000;
      const revenue = Number(m.conversions_value ?? 0);
      return {
        id:          String(c.id),
        name:        String(c.name),
        status:      this.mapStatus(String(c.status)),
        budget:      Number((c as { campaign_budget?: { amount_micros?: number } }).campaign_budget?.amount_micros ?? 0) / 1_000_000,
        spend,
        impressions: Number(m.impressions ?? 0),
        clicks:      Number(m.clicks ?? 0),
        conversions: Number(m.conversions ?? 0),
        revenue,
        roas:        spend > 0 ? revenue / spend : 0,
        cpa:         Number(m.conversions ?? 0) > 0 ? spend / Number(m.conversions) : 0,
        cpm:         Number(m.average_cpm ?? 0) / 1_000_000,
        ctr:         Number(m.ctr ?? 0) * 100,
        startDate:   '',
      };
    });
  }

  async getPerformanceReport(fromDate: string, toDate: string): Promise<PR3> {
    const r = await this.gaqlQuery<{ metrics: Record<string, unknown> }>(
      `SELECT
         metrics.cost_micros, metrics.impressions, metrics.clicks,
         metrics.conversions, metrics.conversions_value,
         metrics.average_cpm, metrics.ctr
       FROM customer
       WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'`
    );

    const totals = r.results.reduce((acc, { metrics: m }) => {
      const spend = Number(m.cost_micros ?? 0) / 1_000_000;
      const revenue = Number(m.conversions_value ?? 0);
      return {
        spend:       acc.spend + spend,
        revenue:     acc.revenue + revenue,
        impressions: acc.impressions + Number(m.impressions ?? 0),
        clicks:      acc.clicks + Number(m.clicks ?? 0),
        conversions: acc.conversions + Number(m.conversions ?? 0),
        cpm:         Number(m.average_cpm ?? 0) / 1_000_000,
        ctr:         Number(m.ctr ?? 0) * 100,
      };
    }, { spend:0, revenue:0, impressions:0, clicks:0, conversions:0, cpm:0, ctr:0 });

    const campaigns = await this.getCampaigns();

    return {
      platform:  'google',
      period:    { from: fromDate, to: toDate },
      roas:      totals.spend > 0 ? totals.revenue / totals.spend : 0,
      cpa:       totals.conversions > 0 ? totals.spend / totals.conversions : 0,
      ...totals,
      campaigns,
    };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', `/customers/${this.customerId}/campaigns:mutate`, {
      operations: [{ update: { resourceName: `customers/${this.customerId}/campaigns/${campaignId}`, status: 'PAUSED' }, updateMask: 'status' }],
    });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', `/customers/${this.customerId}/campaigns:mutate`, {
      operations: [{ update: { resourceName: `customers/${this.customerId}/campaigns/${campaignId}`, status: 'ENABLED' }, updateMask: 'status' }],
    });
  }

  async updateBudget(campaignId: string, newBudget: number): Promise<void> {
    // Google : on met à jour le campaign budget, pas la campagne directement
    await this.apiRequest('POST', `/customers/${this.customerId}/campaignBudgets:mutate`, {
      operations: [{
        update: {
          resourceName: `customers/${this.customerId}/campaignBudgets/${campaignId}`,
          amountMicros: Math.round(newBudget * 1_000_000),
        },
        updateMask: 'amountMicros',
      }],
    });
  }

  async createCampaign(params: GoogleCampaignParams): Promise<{ id: string }> {
    // 1. Crée un budget
    const budgetR = await this.apiRequest<{ results: [{ resourceName: string }] }>(
      'POST',
      `/customers/${this.customerId}/campaignBudgets:mutate`,
      { operations: [{ create: { amountMicros: Math.round(params.budget * 1_000_000), deliveryMethod: 'STANDARD' } }] }
    );
    const budgetResource = budgetR.results[0].resourceName;

    // 2. Crée la campagne
    const body: Record<string, unknown> = {
      name:              params.name,
      advertisingChannelType: params.campaignType === 'SHOPPING' ? 'SHOPPING' : params.campaignType === 'PERFORMANCE_MAX' ? 'PERFORMANCE_MAX' : 'SEARCH',
      status:            'PAUSED',
      campaignBudget:    budgetResource,
    };

    if (params.targetRoas) {
      body.targetRoas = { targetRoas: params.targetRoas };
    } else if (params.targetCpa) {
      body.targetCpa  = { targetCpaMicros: Math.round(params.targetCpa * 1_000_000) };
    } else {
      body.maximizeConversions = {};
    }

    const r = await this.apiRequest<{ results: [{ resourceName: string }] }>(
      'POST',
      `/customers/${this.customerId}/campaigns:mutate`,
      { operations: [{ create: body }] }
    );

    const campaignId = r.results[0].resourceName.split('/').pop() ?? '';
    logger.info(`[GOOGLE] Campaign créée : ${campaignId} (${params.campaignType})`);
    return { id: campaignId };
  }

  // Google Conversions (offline conversion upload)
  async uploadConversion(conversionActionId: string, gclid: string, conversionValue: number, currency = 'EUR'): Promise<void> {
    await this.apiRequest('POST', `/customers/${this.customerId}/conversionActions:mutate`, {
      operations: [{
        create: {
          conversionAction: `customers/${this.customerId}/conversionActions/${conversionActionId}`,
          gclid,
          conversionValue,
          currencyCode: currency,
          conversionDateTime: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000',
        },
      }],
    });
  }

  private mapStatus(s: string): AC3['status'] {
    return ({ ENABLED:'ACTIVE', PAUSED:'PAUSED', REMOVED:'DELETED' } as Record<string, AC3['status']>)[s] ?? 'PAUSED';
  }
}
