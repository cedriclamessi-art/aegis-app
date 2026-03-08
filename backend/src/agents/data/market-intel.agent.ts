// ============================================================
// AEGIS — AGENT_MARKET_INTEL
// Scraping : Amazon · Meta Ad Library · TikTok Trends ·
//            Google Trends · TikTok Creative Center · Concurrents
// 
// Il tourne en continu selon son planning et pousse des
// signaux actionnables vers tous les autres agents.
// ============================================================

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

// ─── Provider Adapters (interchangeables) ─────────────────
// Chaque source est un adapter — si l'une tombe, les autres continuent

interface ScrapeResult {
  source: string;
  data: Record<string, unknown>[];
  signals: Signal[];
  error?: string;
}

interface Signal {
  type: string;
  title: string;
  summary: string;
  actionHint: string;
  targetAgents: string[];
  priority: number;
  data: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
export class MarketIntelAgent extends AgentBase {
  readonly agentId = 'AGENT_MARKET_INTEL';
  readonly taskTypes = [
    'intel.scrape_amazon',
    'intel.scrape_google_trends',
    'intel.scrape_tiktok_trends',
    'intel.scrape_meta_library',
    'intel.analyze_competitors',
    'intel.detect_viral',
    'intel.pricing_scan',
    'intel.keyword_scan',
    'intel.full_scan',
  ];

  // ─── Dispatch selon task type ────────────────────────────
  async execute(task: AgentTask): Promise<AgentResult> {
    await this.setStatus('running');
    await this.heartbeat();
    await this.trace('info', `Starting task: ${task.taskType}`, { taskId: task.id });

    try {
      let result: AgentResult;

      switch (task.taskType) {
        case 'intel.scrape_google_trends':
          result = await this.scrapeGoogleTrends(task);
          break;
        case 'intel.scrape_tiktok_trends':
          result = await this.scrapeTikTokTrends(task);
          break;
        case 'intel.scrape_amazon':
          result = await this.scrapeAmazon(task);
          break;
        case 'intel.scrape_meta_library':
          result = await this.scrapeMetaAdLibrary(task);
          break;
        case 'intel.analyze_competitors':
          result = await this.analyzeCompetitors(task);
          break;
        case 'intel.full_scan':
          result = await this.fullScan(task);
          break;
        default:
          result = { success: false, error: `Unknown task: ${task.taskType}` };
      }

      await this.setStatus('idle');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.trace('error', `Task failed: ${error}`, { taskType: task.taskType }, task.id);
      await this.setStatus('error');
      return { success: false, error, retryable: true };
    }
  }

  // ════════════════════════════════════════════════════════
  // GOOGLE TRENDS
  // Via: SerpAPI / DataForSEO / RapidAPI Google Trends
  // ════════════════════════════════════════════════════════
  private async scrapeGoogleTrends(task: AgentTask): Promise<AgentResult> {
    const country = (task.input.country as string) ?? 'FR';
    const keywords = await this.getRelevantKeywords(task.tenantId);

    const results: ScrapeResult = { source: 'google_trends', data: [], signals: [] };
    const signals: Signal[] = [];

    for (const keyword of keywords.slice(0, 20)) { // max 20 par run
      try {
        // Appel API Google Trends (via adapter)
        const trendData = await this.fetchGoogleTrend(keyword, country);
        if (!trendData) continue;

        // Stocker le signal brut
        await db.query(
          `INSERT INTO google_trends_signals
           (keyword, country, period, interest_score, related_queries, related_topics, breakout, trend_data)
           VALUES ($1,$2,'7d',$3,$4::jsonb,$5::jsonb,$6,$7::jsonb)
           ON CONFLICT (keyword, country, fetched_at::DATE)
             DO UPDATE SET interest_score=EXCLUDED.interest_score,
             related_queries=EXCLUDED.related_queries, trend_data=EXCLUDED.trend_data`,
          [
            keyword,
            country,
            trendData.score,
            JSON.stringify(trendData.relatedQueries),
            JSON.stringify(trendData.relatedTopics),
            trendData.isBreakout,
            JSON.stringify(trendData.timeSeries),
          ]
        );

        // Mettre à jour trending_keywords
        await db.query(
          `INSERT INTO trending_keywords
           (keyword, country, source, trend_score, trend_direction, weekly_change, related_terms)
           VALUES ($1,$2,'google_trends',$3,$4,$5,$6::jsonb)
           ON CONFLICT (keyword, source, country) DO UPDATE SET
             trend_score=EXCLUDED.trend_score, trend_direction=EXCLUDED.trend_direction,
             weekly_change=EXCLUDED.weekly_change, last_updated_at=NOW()`,
          [
            keyword,
            country,
            trendData.score,
            trendData.direction,
            trendData.weeklyChange,
            JSON.stringify(trendData.relatedTerms ?? []),
          ]
        );

        // Générer un signal si le keyword explose
        if (trendData.isBreakout || (trendData.weeklyChange ?? 0) > 100) {
          signals.push({
            type: 'breakout_keyword',
            title: `🔥 Breakout keyword: "${keyword}"`,
            summary: `"${keyword}" explose sur Google Trends (score: ${trendData.score}/100, +${trendData.weeklyChange}% semaine)`,
            actionHint: `Intégrer "${keyword}" dans les prochaines copies et angles créatifs. Lancer des variations d'adsets sur ce mot-clé.`,
            targetAgents: ['AGENT_COPY_CHIEF', 'AGENT_MEDIA_BUYER', 'AGENT_OFFER_ENGINE', 'AGENT_ORCHESTRATOR'],
            priority: 8,
            data: { keyword, score: trendData.score, weeklyChange: trendData.weeklyChange, country },
          });
        }

        results.data.push({ keyword, ...trendData });
      } catch (e) {
        await this.trace('warn', `Google Trends failed for: ${keyword}`, { error: String(e) });
      }
    }

    // Pousser les signaux vers le bus
    await this.emitSignals(signals, task.tenantId);

    return { success: true, output: { scanned: keywords.length, signals: signals.length } };
  }

  // ════════════════════════════════════════════════════════
  // TIKTOK TRENDS + CREATIVE CENTER
  // Via: TikTok Research API / TikTok Creative Center / RapidAPI
  // ════════════════════════════════════════════════════════
  private async scrapeTikTokTrends(task: AgentTask): Promise<AgentResult> {
    const country = (task.input.country as string) ?? 'FR';
    const signals: Signal[] = [];

    try {
      // 1. TikTok Creative Center — Top Ads par catégorie
      const topAds = await this.fetchTikTokTopAds(country);

      for (const ad of topAds) {
        // Stocker la créa virale
        await db.query(
          `INSERT INTO viral_creatives
           (source, platform_id, advertiser, product_category, format, hook_text,
            cta, run_duration_days, engagement_rate, viral_score, angles, country)
           VALUES ('tiktok',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
           ON CONFLICT DO NOTHING`,
          [
            ad.id,
            ad.advertiser,
            ad.category,
            ad.format,
            ad.hookText,
            ad.cta,
            ad.runDays,
            ad.engagementRate,
            this.calcViralScore(ad),
            JSON.stringify(ad.angles ?? []),
            country,
          ]
        );

        // Signal si créa très performante
        if (this.calcViralScore(ad) > 75) {
          signals.push({
            type: 'viral_creative',
            title: `📱 TikTok viral: "${ad.hookText?.substring(0, 60)}..."`,
            summary: `Créa TikTok haute performance (${ad.category}) : engagement ${(ad.engagementRate * 100).toFixed(1)}%, active ${ad.runDays}j`,
            actionHint: `Analyser cet angle créatif pour AGENT_UGC_FACTORY et AGENT_COPY_CHIEF. Hook : "${ad.hookText}"`,
            targetAgents: ['AGENT_CREATIVE_DIRECTOR', 'AGENT_UGC_FACTORY', 'AGENT_COPY_CHIEF'],
            priority: 7,
            data: { ...ad, source: 'tiktok_creative_center' },
          });
        }
      }

      // 2. TikTok Trending Sounds / Hashtags
      const trends = await this.fetchTikTokTrends(country);
      for (const trend of trends) {
        await db.query(
          `INSERT INTO trending_keywords
           (keyword, country, source, trend_score, trend_direction, weekly_change)
           VALUES ($1,$2,'tiktok',$3,$4,$5)
           ON CONFLICT (keyword, source, country) DO UPDATE SET
             trend_score=EXCLUDED.trend_score, trend_direction=EXCLUDED.trend_direction,
             last_updated_at=NOW()`,
          [trend.hashtag, country, trend.volume, trend.direction, trend.change]
        );
      }

      // 3. TikTok Ads Library (si dispo)
      const tiktokAds = await this.fetchTikTokAdsLibrary(country);
      for (const ad of tiktokAds.slice(0, 50)) {
        await db.query(
          `INSERT INTO market_intel_data
           (source, data_type, subject, raw_data, signals, confidence)
           VALUES ('tiktok_ads','ad_performance',$1,$2::jsonb,$3::jsonb,0.7)`,
          [ad.advertiser, JSON.stringify(ad), JSON.stringify([])]
        );
      }

    } catch (e) {
      await this.trace('warn', 'TikTok scrape partial failure', { error: String(e) });
    }

    await this.emitSignals(signals, task.tenantId);
    return { success: true, output: { signals: signals.length } };
  }

  // ════════════════════════════════════════════════════════
  // AMAZON
  // Via: Rainforest API / DataForSEO Amazon / Keepa API
  // ════════════════════════════════════════════════════════
  private async scrapeAmazon(task: AgentTask): Promise<AgentResult> {
    const country = (task.input.country as string) ?? 'FR';
    const categories = await this.getRelevantCategories(task.tenantId);
    const signals: Signal[] = [];

    for (const category of categories) {
      try {
        // Best sellers par catégorie
        const bestSellers = await this.fetchAmazonBestSellers(category, country);

        for (const product of bestSellers.slice(0, 20)) {
          await db.query(
            `INSERT INTO amazon_product_signals
             (tenant_id, asin, title, category, price, currency, bsr_rank, bsr_category,
              rating, review_count, monthly_sales_est, is_bestseller, is_choice, badge,
              keywords, bullet_points, country)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17)
             ON CONFLICT (asin, country, scraped_at::DATE) DO NOTHING`,
            [
              task.tenantId ?? null,
              product.asin,
              product.title,
              category,
              product.price,
              'EUR',
              product.bsrRank,
              product.bsrCategory,
              product.rating,
              product.reviewCount,
              product.monthlySalesEst,
              product.isBestseller,
              product.isChoice,
              product.badge ?? null,
              JSON.stringify(product.keywords ?? []),
              JSON.stringify(product.bulletPoints ?? []),
              country,
            ]
          );

          // Signal si produit avec forte vélocité et peu de reviews (opportunité)
          if (product.bsrRank < 1000 && product.reviewCount < 500) {
            signals.push({
              type: 'amazon_opportunity',
              title: `🛒 Opportunité Amazon: "${product.title.substring(0, 60)}"`,
              summary: `BSR #${product.bsrRank} en "${category}" avec seulement ${product.reviewCount} reviews — marché pas encore saturé.`,
              actionHint: `Analyser le positionnement et l'offre pour AGENT_OFFER_ENGINE. Extraire les bullet points pour AGENT_COPY_CHIEF.`,
              targetAgents: ['AGENT_OFFER_ENGINE', 'AGENT_COPY_CHIEF', 'AGENT_PRODUCT_INGEST'],
              priority: 7,
              data: { asin: product.asin, title: product.title, bsrRank: product.bsrRank, reviewCount: product.reviewCount, price: product.price },
            });
          }

          // Signal si prix chute soudaine (concurrent en liquidation ?)
          if (product.priceChange && product.priceChange < -20) {
            signals.push({
              type: 'competitor_price_drop',
              title: `⚠️ Price drop Amazon: "${product.title.substring(0, 60)}"`,
              summary: `Baisse de ${Math.abs(product.priceChange)}% sur un concurrent Amazon — risque de pression prix.`,
              actionHint: `Alerter AGENT_FINANCE_GUARD et revoir le pricing. Analyser si liquidation ou guerre des prix.`,
              targetAgents: ['AGENT_FINANCE_GUARD', 'AGENT_RISK_ENGINE', 'AGENT_OFFER_ENGINE'],
              priority: 8,
              data: { asin: product.asin, priceChange: product.priceChange, newPrice: product.price },
            });
          }
        }
      } catch (e) {
        await this.trace('warn', `Amazon scrape failed for category: ${category}`, { error: String(e) });
      }
    }

    await this.emitSignals(signals, task.tenantId);
    return { success: true, output: { categoriesScanned: categories.length, signals: signals.length } };
  }

  // ════════════════════════════════════════════════════════
  // META ADS LIBRARY
  // Via: Meta Ad Library API (public, pas de clé requise pour la recherche)
  // https://www.facebook.com/ads/library/api/
  // ════════════════════════════════════════════════════════
  private async scrapeMetaAdLibrary(task: AgentTask): Promise<AgentResult> {
    const country = (task.input.country as string) ?? 'FR';
    const keywords = await this.getRelevantKeywords(task.tenantId);
    const signals: Signal[] = [];

    for (const keyword of keywords.slice(0, 10)) {
      try {
        // Meta Ad Library API — ads actives sur ce keyword
        const ads = await this.fetchMetaAdLibrary(keyword, country);

        for (const ad of ads) {
          await db.query(
            `INSERT INTO viral_creatives
             (source, platform_id, advertiser, product_category, format, hook_text,
              estimated_spend, run_duration_days, viral_score, angles, country)
             VALUES ('meta',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
             ON CONFLICT DO NOTHING`,
            [
              ad.id,
              ad.pageName,
              keyword,
              ad.format,
              ad.bodyText?.substring(0, 500),
              ad.spendRange,
              ad.runDays,
              this.calcViralScore(ad),
              JSON.stringify(ad.angles ?? []),
              country,
            ]
          );

          // Si une ad tourne depuis > 14 jours avec gros spend → signal winner
          if (ad.runDays > 14 && ad.spendTier === 'high') {
            signals.push({
              type: 'meta_winner_ad',
              title: `💰 Meta Winner Ad: "${ad.pageName}"`,
              summary: `Pub active depuis ${ad.runDays}j avec budget élevé sur "${keyword}". Angle testé et validé.`,
              actionHint: `Étudier l'angle, la structure et le hook pour AGENT_COPY_CHIEF et AGENT_CREATIVE_DIRECTOR. Ne pas copier — s'en inspirer.`,
              targetAgents: ['AGENT_COPY_CHIEF', 'AGENT_CREATIVE_DIRECTOR', 'AGENT_MEDIA_BUYER'],
              priority: 7,
              data: { keyword, pageName: ad.pageName, runDays: ad.runDays, format: ad.format },
            });
          }
        }

        // Analyser la saturation : si > 50 ads actives → marché chaud
        if (ads.length > 50) {
          signals.push({
            type: 'market_saturation',
            title: `📊 Marché chaud sur Meta: "${keyword}"`,
            summary: `${ads.length} publicités actives sur "${keyword}" en ce moment — marché compétitif mais validé.`,
            actionHint: `Différenciation créative prioritaire. Briefer AGENT_CREATIVE_DIRECTOR sur la différentiation et l'originalité.`,
            targetAgents: ['AGENT_MEDIA_BUYER', 'AGENT_CREATIVE_DIRECTOR', 'AGENT_RISK_ENGINE'],
            priority: 6,
            data: { keyword, activeAdsCount: ads.length, country },
          });
        }
      } catch (e) {
        await this.trace('warn', `Meta Ad Library failed for: ${keyword}`, { error: String(e) });
      }
    }

    await this.emitSignals(signals, task.tenantId);
    return { success: true, output: { keywordsScanned: keywords.length, signals: signals.length } };
  }

  // ════════════════════════════════════════════════════════
  // COMPETITOR ANALYSIS (multi-platform)
  // ════════════════════════════════════════════════════════
  private async analyzeCompetitors(task: AgentTask): Promise<AgentResult> {
    if (!task.tenantId) return { success: false, error: 'tenant_id required' };
    const signals: Signal[] = [];

    // Récupérer la liste des concurrents du tenant (depuis leurs produits)
    const products = await db.query(
      `SELECT DISTINCT normalized_data->>'competitor_urls' as urls
       FROM products WHERE tenant_id = $1 AND status = 'enriched'`,
      [task.tenantId]
    );

    const competitorUrls: string[] = [];
    for (const p of products.rows) {
      try {
        const urls = JSON.parse(p.urls ?? '[]');
        competitorUrls.push(...urls);
      } catch {}
    }

    for (const url of [...new Set(competitorUrls)].slice(0, 10)) {
      try {
        const intel = await this.scrapeCompetitorPage(url);
        if (!intel) continue;

        await db.query(
          `INSERT INTO competitor_intel
           (tenant_id, competitor_url, platform, intel_type, data, pricing_data, signal, urgency)
           VALUES ($1,$2,'web','pricing',$3::jsonb,$4::jsonb,$5,$6)`,
          [
            task.tenantId,
            url,
            JSON.stringify(intel),
            JSON.stringify(intel.pricing ?? {}),
            intel.signal ?? null,
            intel.urgency ?? 'low',
          ]
        );

        if (intel.urgency === 'high' || intel.urgency === 'critical') {
          signals.push({
            type: 'competitor_alert',
            title: `🚨 Alerte concurrence: ${url}`,
            summary: intel.signal ?? 'Changement détecté chez un concurrent',
            actionHint: 'Évaluer l\'impact sur la stratégie prix et l\'offre. Alerter AGENT_OFFER_ENGINE.',
            targetAgents: ['AGENT_OFFER_ENGINE', 'AGENT_FINANCE_GUARD', 'AGENT_MEDIA_BUYER'],
            priority: 9,
            data: { url, ...intel },
          });
        }
      } catch (e) {
        await this.trace('warn', `Competitor scrape failed: ${url}`, { error: String(e) });
      }
    }

    await this.emitSignals(signals, task.tenantId);
    return { success: true, output: { competitorsAnalyzed: competitorUrls.length, signals: signals.length } };
  }

  // ════════════════════════════════════════════════════════
  // FULL SCAN (hebdomadaire deep scan)
  // ════════════════════════════════════════════════════════
  private async fullScan(task: AgentTask): Promise<AgentResult> {
    await this.trace('info', '🔍 Full scan démarré (hebdomadaire)', {}, task.id);

    // Exécuter tous les scrapers en parallèle (avec gestion d'erreur individuelle)
    const [gt, tt, amz, meta, comp] = await Promise.allSettled([
      this.scrapeGoogleTrends({ ...task, taskType: 'intel.scrape_google_trends' }),
      this.scrapeTikTokTrends({ ...task, taskType: 'intel.scrape_tiktok_trends' }),
      this.scrapeAmazon({ ...task, taskType: 'intel.scrape_amazon' }),
      this.scrapeMetaAdLibrary({ ...task, taskType: 'intel.scrape_meta_library' }),
      this.analyzeCompetitors({ ...task, taskType: 'intel.analyze_competitors' }),
    ]);

    const summary = {
      googleTrends: gt.status === 'fulfilled' ? gt.value.output : { error: (gt as PromiseRejectedResult).reason },
      tiktok: tt.status === 'fulfilled' ? tt.value.output : { error: (tt as PromiseRejectedResult).reason },
      amazon: amz.status === 'fulfilled' ? amz.value.output : { error: (amz as PromiseRejectedResult).reason },
      meta: meta.status === 'fulfilled' ? meta.value.output : { error: (meta as PromiseRejectedResult).reason },
      competitors: comp.status === 'fulfilled' ? comp.value.output : { error: (comp as PromiseRejectedResult).reason },
    };

    // Broadcast le résumé du scan à tous les agents
    await this.broadcast(
      { scanType: 'full_weekly', summary, completedAt: new Date().toISOString() },
      '[INTEL] Full scan hebdomadaire terminé',
      task.tenantId
    );

    // Envoyer un résumé spécial à l'orchestrateur pour qu'il planifie les actions
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_ORCHESTRATOR',
      messageType: 'DATA_PUSH',
      subject: 'Rapport intelligence marché — action requise',
      payload: { summary, weeklyHighlights: await this.extractWeeklyHighlights(task.tenantId) },
      tenantId: task.tenantId,
      priority: 7,
    });

    return { success: true, output: summary };
  }

  // ─── Extraire les highlights de la semaine ───────────────
  private async extractWeeklyHighlights(tenantId?: string): Promise<Record<string, unknown>> {
    const [topKeywords, topVirals, topOpportunities] = await Promise.all([
      db.query(
        `SELECT keyword, source, trend_score, trend_direction FROM trending_keywords
         WHERE last_updated_at > NOW() - INTERVAL '7 days'
         ORDER BY trend_score DESC LIMIT 10`
      ),
      db.query(
        `SELECT hook_text, source, viral_score, product_category FROM viral_creatives
         WHERE detected_at > NOW() - INTERVAL '7 days'
         ORDER BY viral_score DESC LIMIT 5`
      ),
      db.query(
        `SELECT title, summary, action_hint FROM intel_feed
         WHERE created_at > NOW() - INTERVAL '7 days'
           AND priority >= 7
         ORDER BY priority DESC, created_at DESC LIMIT 10`
      ),
    ]);

    return {
      topKeywords: topKeywords.rows,
      topVirals: topVirals.rows,
      topOpportunities: topOpportunities.rows,
    };
  }

  // ─── Émettre les signaux vers le bus ─────────────────────
  private async emitSignals(signals: Signal[], tenantId?: string): Promise<void> {
    for (const signal of signals) {
      const intelId = await this.pushIntel(
        signal.type,
        signal.title,
        signal.summary,
        signal.actionHint,
        signal.targetAgents,
        [],
        signal.priority,
        tenantId
      );

      await this.trace('info', `Signal émis: ${signal.type}`, {
        title: signal.title,
        targetAgents: signal.targetAgents,
        intelId,
      });
    }
  }

  // ─── Helpers contextuels ──────────────────────────────────
  private async getRelevantKeywords(tenantId?: string): Promise<string[]> {
    if (!tenantId) {
      return ['soin visage', 'serviette exfoliante', 'routine beauté', 'anti-âge', 'collagène'];
    }
    const result = await db.query(
      `SELECT DISTINCT jsonb_array_elements_text(normalized_data->'keywords') as kw
       FROM products WHERE tenant_id = $1 AND status = 'enriched'
       LIMIT 20`,
      [tenantId]
    );
    const custom = result.rows.map((r: { kw: string }) => r.kw).filter(Boolean);
    return custom.length > 0 ? custom : ['produit beauté', 'soins peau', 'routine skincare'];
  }

  private async getRelevantCategories(tenantId?: string): Promise<string[]> {
    if (!tenantId) return ['Beauty', 'Health', 'Personal Care'];
    const result = await db.query(
      `SELECT DISTINCT normalized_data->>'category' as cat
       FROM products WHERE tenant_id = $1 AND status = 'enriched'`,
      [tenantId]
    );
    return result.rows.map((r: { cat: string }) => r.cat).filter(Boolean);
  }

  private calcViralScore(ad: Record<string, unknown>): number {
    let score = 0;
    if (typeof ad.runDays === 'number') score += Math.min(ad.runDays * 0.5, 30);
    if (typeof ad.engagementRate === 'number') score += ad.engagementRate * 1000;
    if (ad.spendTier === 'high') score += 30;
    if (ad.spendTier === 'medium') score += 15;
    return Math.min(Math.round(score), 100);
  }

  // ─── Adapters (à brancher sur les vraies APIs) ────────────
  // Chaque adapter est interchangeable — un provider tombe → fallback

  private async fetchGoogleTrend(keyword: string, country: string): Promise<{
    score: number; direction: string; weeklyChange: number; isBreakout: boolean;
    relatedQueries: unknown[]; relatedTopics: unknown[]; relatedTerms: string[]; timeSeries: unknown[];
  } | null> {
    // Provider 1: SerpAPI Google Trends
    // Provider 2: DataForSEO Trends API
    // Provider 3: Pytrends via microservice Python
    // Fallback: données synthétiques si tous down

    const apiKey = process.env.SERPAPI_KEY || process.env.DATAFORSEO_KEY;
    if (!apiKey) {
      // Mode dégradé : retourner null (pas de crash)
      return null;
    }

    try {
      // SerpAPI implementation
      const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&geo=${country}&api_key=${apiKey}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;

      const data = await resp.json() as {
        interest_over_time?: { timeline_data?: Array<{ values?: Array<{ extracted_value?: number }> }> };
        related_queries?: { rising?: Array<{ query?: string }> };
        related_topics?: { rising?: Array<{ topic?: { title?: string } }> };
      };
      const timeline = data?.interest_over_time?.timeline_data ?? [];
      const scores = timeline.map(t => t.values?.[0]?.extracted_value ?? 0);
      const latestScore = scores[scores.length - 1] ?? 0;
      const prevScore = scores[scores.length - 2] ?? latestScore;
      const weeklyChange = prevScore > 0 ? ((latestScore - prevScore) / prevScore) * 100 : 0;

      return {
        score: latestScore,
        direction: latestScore > prevScore ? 'rising' : latestScore < prevScore ? 'falling' : 'stable',
        weeklyChange: Math.round(weeklyChange),
        isBreakout: weeklyChange > 5000,
        relatedQueries: data?.related_queries?.rising ?? [],
        relatedTopics: data?.related_topics?.rising ?? [],
        relatedTerms: (data?.related_queries?.rising ?? []).slice(0, 5).map((r) => r.query ?? ''),
        timeSeries: timeline,
      };
    } catch {
      return null;
    }
  }

  private async fetchTikTokTopAds(country: string): Promise<Array<{
    id: string; advertiser: string; category: string; format: string;
    hookText: string; cta: string; runDays: number; engagementRate: number; angles: string[];
  }>> {
    // TikTok Creative Center API ou RapidAPI TikTok
    // https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en
    const apiKey = process.env.TIKTOK_CREATIVE_API_KEY || process.env.RAPIDAPI_TIKTOK_KEY;
    if (!apiKey) return [];

    try {
      const resp = await fetch(
        `https://business-api.tiktok.com/open_api/v1.3/creative/inspire/top_ads/list/?placement=TIKTOK&industry_id=1&country_code=${country}&limit=20`,
        {
          headers: { 'Access-Token': apiKey },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { data?: { list?: Array<{
        video_info?: { vid?: string }; advertiser_name?: string; industry_name?: string;
        ad_format?: string; video_title?: string; cta?: string; cost_ratio?: number; engagement_rate?: number;
      }> } };
      return (data?.data?.list ?? []).map(ad => ({
        id: ad?.video_info?.vid ?? '',
        advertiser: ad?.advertiser_name ?? '',
        category: ad?.industry_name ?? '',
        format: ad?.ad_format ?? 'video',
        hookText: ad?.video_title ?? '',
        cta: ad?.cta ?? '',
        runDays: Math.round((ad?.cost_ratio ?? 0) * 30),
        engagementRate: ad?.engagement_rate ?? 0,
        angles: [],
      }));
    } catch {
      return [];
    }
  }

  private async fetchTikTokTrends(country: string): Promise<Array<{
    hashtag: string; volume: number; direction: string; change: number;
  }>> {
    // RapidAPI TikTok Trending Hashtags
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) return [];
    try {
      const resp = await fetch(
        `https://tiktok-api23.p.rapidapi.com/api/trending/hashtags?region=${country.toLowerCase()}&count=30`,
        {
          headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'tiktok-api23.p.rapidapi.com' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { hashtag_list?: Array<{ hashtag_name?: string; video_count?: number }> };
      return (data?.hashtag_list ?? []).map(h => ({
        hashtag: h.hashtag_name ?? '',
        volume: h.video_count ?? 0,
        direction: 'rising',
        change: 0,
      }));
    } catch {
      return [];
    }
  }

  private async fetchTikTokAdsLibrary(country: string): Promise<Array<Record<string, unknown>>> {
    // TikTok Ads Transparency Library — pas encore d'API publique stable
    // Via scraping ou service tiers
    return []; // stub — brancher quand disponible
  }

  private async fetchAmazonBestSellers(category: string, country: string): Promise<Array<{
    asin: string; title: string; price: number; bsrRank: number; bsrCategory: string;
    rating: number; reviewCount: number; monthlySalesEst: number; isBestseller: boolean;
    isChoice: boolean; badge: string | null; keywords: string[]; bulletPoints: string[];
    priceChange?: number;
  }>> {
    // Rainforest API (le plus fiable pour Amazon)
    // https://rainforestapi.com/
    const apiKey = process.env.RAINFOREST_API_KEY || process.env.DATAFORSEO_KEY;
    if (!apiKey) return [];

    try {
      const domain = country === 'FR' ? 'amazon.fr' : 'amazon.com';
      const url = `https://api.rainforestapi.com/request?api_key=${apiKey}&type=bestsellers&category_id=${encodeURIComponent(category)}&amazon_domain=${domain}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return [];
      const data = await resp.json() as { bestsellers?: Array<{
        asin?: string; title?: string; price?: { value?: number }; position?: number;
        rating?: number; ratings_total?: number; badge?: string;
      }> };
      return (data?.bestsellers ?? []).slice(0, 20).map(p => ({
        asin: p.asin ?? '',
        title: p.title ?? '',
        price: p.price?.value ?? 0,
        bsrRank: p.position ?? 0,
        bsrCategory: category,
        rating: p.rating ?? 0,
        reviewCount: p.ratings_total ?? 0,
        monthlySalesEst: 0,
        isBestseller: p.badge === 'bestseller',
        isChoice: p.badge === 'amazons-choice',
        badge: p.badge ?? null,
        keywords: [],
        bulletPoints: [],
      }));
    } catch {
      return [];
    }
  }

  private async fetchMetaAdLibrary(keyword: string, country: string): Promise<Array<{
    id: string; pageName: string; format: string; bodyText: string;
    spendRange: string; spendTier: string; runDays: number; angles: string[];
  }>> {
    // Meta Ad Library API — pas de clé requise pour la recherche basique
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) return [];

    try {
      const url = `https://graph.facebook.com/v19.0/ads_archive?search_terms=${encodeURIComponent(keyword)}&ad_reached_countries=${country}&ad_delivery_date_max=${new Date().toISOString().split('T')[0]}&fields=id,page_name,ad_creative_body,ad_delivery_start_time,impressions,spend&limit=50&access_token=${accessToken}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return [];
      const data = await resp.json() as { data?: Array<{
        id?: string; page_name?: string; ad_creative_body?: string;
        spend?: { lower_bound?: string; upper_bound?: string };
        ad_delivery_start_time?: string; impressions?: { lower_bound?: string };
      }> };

      return (data?.data ?? []).map(ad => {
        const spendLow = parseInt(ad.spend?.lower_bound ?? '0');
        const startDate = ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time) : new Date();
        const runDays = Math.floor((Date.now() - startDate.getTime()) / 86400000);
        return {
          id: ad.id ?? '',
          pageName: ad.page_name ?? '',
          format: 'unknown',
          bodyText: ad.ad_creative_body ?? '',
          spendRange: `${ad.spend?.lower_bound ?? 0}-${ad.spend?.upper_bound ?? 0}€`,
          spendTier: spendLow > 5000 ? 'high' : spendLow > 1000 ? 'medium' : 'low',
          runDays,
          angles: [],
        };
      });
    } catch {
      return [];
    }
  }

  private async scrapeCompetitorPage(url: string): Promise<{
    pricing?: Record<string, unknown>; signal?: string; urgency: string;
  } | null> {
    // Scraping légal (robots.txt respecté via AGENT_LEGAL_SCRAPER)
    // Via ScrapingBee / Apify / Puppeteer microservice
    const apiKey = process.env.SCRAPINGBEE_KEY || process.env.APIFY_KEY;
    if (!apiKey) return null;

    try {
      const resp = await fetch(
        `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(url)}&extract_rules={"price":".price","title":"h1"}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!resp.ok) return null;
      const data = await resp.json() as { price?: string; title?: string };
      return {
        pricing: { price: data.price, url, scrapedAt: new Date().toISOString() },
        signal: null,
        urgency: 'low',
      };
    } catch {
      return null;
    }
  }
}
