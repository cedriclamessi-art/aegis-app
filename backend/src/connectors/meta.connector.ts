/**
 * META ADS CONNECTOR
 * ==================
 * Graph API v18 · Business Manager · CAPI Server-Side
 *
 * Couvre :
 *   - Campaigns CRUD (CBO/ABO)
 *   - Ad Sets + Ads
 *   - Reporting (Insights API)
 *   - Custom Audiences & Lookalike
 *   - CAPI events (server-side)
 *   - Token refresh via System User
 */

import { ConnectorBase, AdCampaign, PerformanceReport } from './connector.base';
import { db } from '../utils/db';
import logger from '../utils/logger';

const META_API_VERSION = 'v18.0';

interface MetaCampaignCreateParams {
  name:          string;
  objective:     'OUTCOME_TRAFFIC' | 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_AWARENESS' | 'OUTCOME_ENGAGEMENT';
  budget:        number;         // daily budget en centimes
  budgetType:    'DAILY' | 'LIFETIME';
  bidStrategy:   'LOWEST_COST_WITHOUT_CAP' | 'COST_CAP' | 'MINIMUM_ROAS';
  bidAmount?:    number;
  startTime?:    string;
  endTime?:      string;
}

interface MetaAdSetParams {
  campaignId:    string;
  name:          string;
  targeting:     MetaTargeting;
  budget:        number;
  optimizationGoal: 'OFFSITE_CONVERSIONS' | 'REACH' | 'LINK_CLICKS' | 'VALUE';
  billingEvent:  'IMPRESSIONS' | 'LINK_CLICKS';
  pixelId:       string;
  customEventType?: string;
}

interface MetaTargeting {
  age_min?:           number;
  age_max?:           number;
  genders?:           number[];   // 1=male, 2=female
  geo_locations?:     { countries: string[] };
  custom_audiences?:  { id: string }[];
  lookalike_audiences?: { id: string }[];
  flexible_spec?:     Array<{ interests: Array<{ id: string; name: string }> }>;
  publisher_platforms?: string[];
  device_platforms?:  string[];
}

interface CAPIEvent {
  event_name:   'Purchase' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Lead' | 'Search';
  event_time:   number;  // Unix timestamp
  event_id?:    string;  // Pour dedup
  action_source: 'website' | 'app' | 'email' | 'phone_call';
  user_data:    {
    em?:  string[];    // emails hachés SHA256
    ph?:  string[];    // phones hachés
    fn?:  string[];    // first name haché
    ln?:  string[];    // last name haché
    ct?:  string[];    // city hachée
    country?: string[];
    fbc?: string;      // fb click id
    fbp?: string;      // fb browser id
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data?: {
    value?:     number;
    currency?:  string;
    content_ids?: string[];
    content_type?: string;
    order_id?:  string;
    num_items?: number;
  };
  event_source_url?: string;
  opt_out?: boolean;
}

export class MetaConnector extends ConnectorBase {
  readonly platform = 'meta';
  readonly baseUrl  = `https://graph.facebook.com/${META_API_VERSION}`;

  protected buildAuthHeaders(): Record<string, string> {
    return {}; // Meta : token en query param
  }

  protected async doTokenRefresh(_refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    // Meta System User tokens ne se refreshent pas via OAuth standard
    // → durée 60 jours ou illimitée selon configuration
    // On log juste l'avertissement
    logger.warn('[META] System User token — refresh manuel requis dans le BM');
    throw new Error('Meta tokens require manual renewal via Business Manager');
  }

  private get token(): string {
    return this.credentials?.accessToken ?? '';
  }

  private get adAccountId(): string {
    return this.credentials?.accountId ?? '';
  }

  // ── Campaigns ─────────────────────────────────────────────────────────

  async getCampaigns(): Promise<AdCampaign[]> {
    const data = await this.apiRequest<{ data: Array<Record<string, unknown>> }>(
      'GET',
      `/act_${this.adAccountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,insights{spend,impressions,clicks,conversions,purchase_roas,cpa,cpm,ctr}&access_token=${this.token}`
    );

    return data.data.map(c => {
      const ins = (c.insights as { data?: Array<Record<string, unknown>> })?.data?.[0] ?? {};
      return {
        id:          c.id as string,
        name:        c.name as string,
        status:      (c.status as string).toUpperCase() as AdCampaign['status'],
        budget:      Number(c.daily_budget ?? c.lifetime_budget ?? 0) / 100,
        spend:       Number(ins.spend ?? 0),
        impressions: Number(ins.impressions ?? 0),
        clicks:      Number(ins.clicks ?? 0),
        conversions: Number((ins.conversions as Array<{value:number}>)?.[0]?.value ?? 0),
        revenue:     Number((ins.purchase_roas as Array<{value:number}>)?.[0]?.value ?? 0) * Number(ins.spend ?? 0),
        roas:        Number((ins.purchase_roas as Array<{value:number}>)?.[0]?.value ?? 0),
        cpa:         Number(ins.cpa ?? 0),
        cpm:         Number(ins.cpm ?? 0),
        ctr:         Number(ins.ctr ?? 0),
        startDate:   c.start_time as string ?? '',
        endDate:     c.stop_time as string ?? undefined,
      };
    });
  }

  async getPerformanceReport(fromDate: string, toDate: string): Promise<PerformanceReport> {
    const data = await this.apiRequest<{ data: Array<Record<string, unknown>> }>(
      'GET',
      `/act_${this.adAccountId}/insights?` +
      `fields=spend,impressions,clicks,conversions,purchase_roas,cpa,cpm,ctr&` +
      `time_range={"since":"${fromDate}","until":"${toDate}"}` +
      `&access_token=${this.token}`
    );

    const ins = data.data[0] ?? {};
    const campaigns = await this.getCampaigns();

    return {
      platform:    'meta',
      period:      { from: fromDate, to: toDate },
      spend:       Number(ins.spend ?? 0),
      revenue:     Number((ins.purchase_roas as Array<{value:number}>)?.[0]?.value ?? 0) * Number(ins.spend ?? 0),
      roas:        Number((ins.purchase_roas as Array<{value:number}>)?.[0]?.value ?? 0),
      impressions: Number(ins.impressions ?? 0),
      clicks:      Number(ins.clicks ?? 0),
      conversions: Number((ins.conversions as Array<{value:number}>)?.[0]?.value ?? 0),
      cpa:         Number(ins.cpa ?? 0),
      cpm:         Number(ins.cpm ?? 0),
      ctr:         Number(ins.ctr ?? 0),
      campaigns,
    };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', `/${campaignId}`, {
      status: 'PAUSED',
      access_token: this.token,
    });
    logger.info(`[META] Campaign ${campaignId} paused`);
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.apiRequest('POST', `/${campaignId}`, {
      status: 'ACTIVE',
      access_token: this.token,
    });
  }

  async updateBudget(campaignId: string, newBudget: number): Promise<void> {
    await this.apiRequest('POST', `/${campaignId}`, {
      daily_budget: Math.round(newBudget * 100), // en centimes
      access_token: this.token,
    });
    logger.info(`[META] Campaign ${campaignId} budget → €${newBudget}`);
  }

  async createCampaign(params: MetaCampaignCreateParams): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name:        params.name,
      objective:   params.objective,
      status:      'PAUSED', // Toujours créer en pause pour validation humaine
      bid_strategy: params.bidStrategy,
      access_token: this.token,
    };

    if (params.budgetType === 'DAILY') {
      body.daily_budget    = Math.round(params.budget * 100);
    } else {
      body.lifetime_budget = Math.round(params.budget * 100);
    }

    const r = await this.apiRequest<{ id: string }>(
      'POST',
      `/act_${this.adAccountId}/campaigns`,
      body
    );

    logger.info(`[META] Campaign créée : ${r.id} (${params.name}) — statut PAUSED`);
    return r;
  }

  async createAdSet(params: MetaAdSetParams): Promise<{ id: string }> {
    return this.apiRequest('POST', `/act_${this.adAccountId}/adsets`, {
      ...params,
      campaign_id:       params.campaignId,
      daily_budget:      Math.round(params.budget * 100),
      promoted_object:   { pixel_id: params.pixelId, custom_event_type: params.customEventType ?? 'PURCHASE' },
      targeting:         params.targeting,
      optimization_goal: params.optimizationGoal,
      billing_event:     params.billingEvent,
      status:            'PAUSED',
      access_token:      this.token,
    });
  }

  // ── CAPI Server-Side Events ────────────────────────────────────────────

  async sendCAPIEvents(pixelId: string, events: CAPIEvent[], testCode?: string): Promise<{
    events_received: number; messages: string[];
  }> {
    const body: Record<string, unknown> = {
      data: events,
      access_token: this.token,
    };

    if (testCode) body.test_event_code = testCode;

    const r = await this.apiRequest<{ events_received: number; messages: string[] }>(
      'POST',
      `/${pixelId}/events`,
      body
    );

    // Persiste les events CAPI pour réconciliation
    for (const ev of events) {
      await db.query(
        `INSERT INTO ads.capi_events
           (tenant_id, event_name, event_id, event_time, user_data_hash, custom_data, platform)
         VALUES ($1,$2,$3,to_timestamp($4),$5,$6,'meta')
         ON CONFLICT (event_id, platform) DO NOTHING`,
        [
          this.tenantId,
          ev.event_name,
          ev.event_id ?? null,
          ev.event_time,
          JSON.stringify(ev.user_data),
          JSON.stringify(ev.custom_data ?? {}),
        ]
      ).catch(() => {});
    }

    logger.info(`[META CAPI] ${r.events_received} events reçus`);
    return r;
  }

  // ── Custom Audiences ──────────────────────────────────────────────────

  async createCustomAudience(name: string, description: string): Promise<{ id: string }> {
    return this.apiRequest('POST', `/act_${this.adAccountId}/customaudiences`, {
      name,
      description,
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      access_token: this.token,
    });
  }

  async createLookalike(sourceAudienceId: string, country: string, ratio: number): Promise<{ id: string }> {
    return this.apiRequest('POST', `/act_${this.adAccountId}/customaudiences`, {
      name: `Lookalike ${ratio * 100}% ${country} from ${sourceAudienceId}`,
      subtype: 'LOOKALIKE',
      origin_audience_id: sourceAudienceId,
      lookalike_spec: { type: 'similarity', starting_ratio: 0, ratio, country },
      access_token: this.token,
    });
  }
}
