/**
 * AGENT_SPY \u2014 D\u00e9tecteur de Gagnants Multi-Dimensionnel
 * \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
 *
 * MISSION : Trouver ce qui MARCHE VRAIMENT dans la niche.
 * Pas ce qui est populaire \u2014 ce qui CONVERTIT et G\u00c9N\u00c8RE DU REVENU.
 *
 * 3 axes de d\u00e9tection :
 *
 * \u2500\u2500 AXE 1 : VID\u00c9OS QUI CHIFFRENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *   Une vid\u00e9o "qui chiffre" = diffus\u00e9e depuis >14j sans interruption.
 *   Si un annonceur maintient une vid\u00e9o active >14j, c'est qu'elle est
 *   ROAS positive. On la d\u00e9tecte, on score le hook, on injecte le pattern.
 *
 *   Sources : TikTok Creative Hub, Meta Ad Library, YouTube Ads Transparency
 *   Score : dur\u00e9e_diffusion \u00d7 engagement_rate \u00d7 format_bonus
 *   Output : intel.viral_creatives + brief inject\u00e9 dans AGENT_CREATIVE_FACTORY
 *
 * \u2500\u2500 AXE 2 : CR\u00c9ATIVES QUI CHIFFRENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *   Une cr\u00e9ative "qui chiffre" = active >21j + coh\u00e9rence de format.
 *   On extrait : les 3 premi\u00e8res secondes (hook), le CTA, le format,
 *   les angles utilis\u00e9s, le style visuel.
 *   R\u00e9sultat : une "recette cr\u00e9ative" injectable dans les briefs.
 *
 *   Sources : Meta Ad Library (par dur\u00e9e), TikTok Top Ads, Pinterest Ads
 *   Score : dur\u00e9e \u00d7 format_match \u00d7 hook_strength \u00d7 cta_quality
 *   Output : intel.patterns (type=creative) + AGENT_CREATIVE_FACTORY brief
 *
 * \u2500\u2500 AXE 3 : BOUTIQUES QUI CHIFFRENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *   Une boutique "qui chiffre" = trafic estim\u00e9 \u00e9lev\u00e9 + d\u00e9pense ads maintenue.
 *   On d\u00e9tecte via : Facebook Ad spend estim\u00e9, SimilarWeb trafic,
 *   Shopify indicators (apps install\u00e9es, th\u00e8me, nombre de produits),
 *   corr\u00e9lation dur\u00e9e annonce + trafic store.
 *
 *   Sources : Meta Ad Library (pages), SimilarWeb, Shopify Store patterns
 *   Score : ad_spend_estimate \u00d7 traffic_estimate \u00d7 conversion_indicators
 *   Output : intel.winning_stores + analyse inject\u00e9e dans AGENT_MARKET_ANALYSE
 *
 * Architecture :
 *   Chaque axe est ind\u00e9pendant. Si l'un tombe, les deux autres continuent.
 *   Tout output devient un signal actionnable vers les agents op\u00e9rationnels.
 *   Le classement est recalcul\u00e9 \u00e0 chaque scan. Les gagnants d'hier peuvent
 *   tomber \u2014 les nouveaux entrants sont d\u00e9tect\u00e9s en temps r\u00e9el.
 */

import { AgentBase, AgentTask, AgentResult } from "../base/agent.base";
import { db } from "../../utils/db";

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface WinningVideo {
  id:              string;
  platform:        "tiktok" | "meta" | "youtube" | "pinterest";
  platformId:      string;
  advertiser:      string;
  productCategory: string;
  format:          "ugc" | "studio" | "animation" | "slideshow" | "unknown";
  hookText:        string;
  hookType:        "pain_point" | "curiosity" | "social_proof" | "transformation" | "question" | "shock" | "unknown";
  ctaText:         string;
  durationDays:    number;    // Jours depuis le lancement
  estimatedViews:  number;
  engagementRate:  number;    // 0-1
  viralScore:      number;    // 0-100
  angles:          string[];  // Angles marketing utilis\u00e9s
  thumbnailUrl:    string;
  videoUrl:        string;
  country:         string;
  detectedAt:      Date;
}

interface WinningCreative {
  id:              string;
  platform:        string;
  advertiser:      string;
  format:          string;
  hook:            string;    // Texte des 3 premi\u00e8res secondes
  hookCategory:    string;    // Type de hook
  cta:             string;
  duration:        number;    // Dur\u00e9e vid\u00e9o en secondes
  runDays:         number;    // Jours de diffusion active
  style:           string;    // "talking_head" | "voiceover" | "text_overlay" | "b_roll"
  angles:          string[];
  score:           number;    // Score composite 0-100
  brief:           CreativeBrief;  // Brief pr\u00eat \u00e0 injecter dans AGENT_CREATIVE_FACTORY
}

interface CreativeBrief {
  format:          string;
  hookTemplate:    string;    // Template du hook \u00e0 reproduire
  hookCategory:    string;
  ctaFormula:      string;
  styleGuidelines: string[];
  angles:          string[];
  doList:          string[];  // Ce qu'on DOIT faire
  dontList:        string[];  // Ce qu'on NE doit PAS faire
  referenceAd:     string;   // URL de l'annonce de r\u00e9f\u00e9rence
  confidenceScore: number;
}

interface WinningStore {
  id:                    string;
  domain:                string;
  pageName:              string;
  platform:              "shopify" | "woocommerce" | "prestashop" | "custom";
  niche:                 string;
  country:               string;
  // Indicateurs de performance
  estimatedMonthlyTraffic: number;
  estimatedAdSpend:      number;    // EUR/mois estim\u00e9
  activeAdsCount:        number;
  longestRunningAdDays:  number;    // Plus longue ad active
  avgAdDuration:         number;    // Dur\u00e9e moyenne des ads
  // Indicateurs boutique
  shopifyTheme:          string;
  installedApps:         string[];  // Judge.me, Klaviyo, Loox, etc.
  productCount:          number;
  estimatedRevenue:      string;    // "10K-50K" | "50K-200K" | "200K+" EUR/mois
  // Signaux de qualit\u00e9
  hasReviews:            boolean;
  hasUpsell:             boolean;
  hasEmail:              boolean;   // Klaviyo ou similaire
  trustScore:            number;    // 0-100
  performanceScore:      number;    // Score composite 0-100
  // Meta
  detectedAt:            Date;
  adsUrls:               string[];
}

// \u2500\u2500 AGENT_SPY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class SpyAgent extends AgentBase {
  readonly agentId   = "AGENT_SPY";
  readonly taskTypes = [
    // Axe 1 \u2014 Vid\u00e9os qui chiffrent
    "spy.winning_videos",          // D\u00e9tecter les meilleures vid\u00e9os toutes plateformes
    "spy.winning_videos_tiktok",   // Focus TikTok
    "spy.winning_videos_meta",     // Focus Meta
    "spy.winning_videos_youtube",  // Focus YouTube

    // Axe 2 \u2014 Cr\u00e9atives qui chiffrent
    "spy.winning_creatives",       // D\u00e9tecter + scorer + extraire brief
    "spy.analyze_creative",        // Analyser une cr\u00e9ative sp\u00e9cifique (URL en input)
    "spy.extract_hook_pattern",    // Extraire le pattern d\'un hook via LLM vision

    // Axe 3 \u2014 Boutiques qui chiffrent
    "spy.winning_stores",          // D\u00e9tecter les boutiques qui chiffrent
    "spy.analyze_store",           // Analyser une boutique sp\u00e9cifique (domaine en input)
    "spy.track_store",             // Mettre une boutique sous surveillance continue

    // Scans combin\u00e9s
    "spy.full_scan",               // Les 3 axes en parall\u00e8le
    "spy.niche_deep_dive",         // Deep dive complet sur une niche
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();
    switch (task.taskType) {
      case "spy.winning_videos":          return this.detectWinningVideos(task);
      case "spy.winning_videos_tiktok":   return this.detectWinningVideosTikTok(task);
      case "spy.winning_videos_meta":     return this.detectWinningVideosMeta(task);
      case "spy.winning_videos_youtube":  return this.detectWinningVideosYouTube(task);
      case "spy.winning_creatives":       return this.detectWinningCreatives(task);
      case "spy.analyze_creative":        return this.analyzeCreative(task);
      case "spy.extract_hook_pattern":    return this.extractHookPattern(task);
      case "spy.winning_stores":          return this.detectWinningStores(task);
      case "spy.analyze_store":           return this.analyzeStore(task);
      case "spy.track_store":             return this.trackStore(task);
      case "spy.full_scan":               return this.fullScan(task);
      case "spy.niche_deep_dive":         return this.nicheDeepDive(task);
      default: return { success: false, error: `Unknown task: ${task.taskType}` };
    }
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // AXE 1 \u2014 VID\u00c9OS QUI CHIFFRENT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async detectWinningVideos(task: AgentTask): Promise<AgentResult> {
    await this.trace("info", "\ud83c\udfac SPY \u2014 D\u00e9tection vid\u00e9os gagnantes (toutes plateformes)", {}, task.id);

    const [tiktok, meta, youtube] = await Promise.allSettled([
      this.detectWinningVideosTikTok(task),
      this.detectWinningVideosMeta(task),
      this.detectWinningVideosYouTube(task),
    ]);

    const results = [tiktok, meta, youtube]
      .filter(r => r.status === "fulfilled")
      .map(r => (r as PromiseFulfilledResult<AgentResult>).value);

    const totalVideos  = results.reduce((s, r) => s + Number(r.output?.videosFound ?? 0), 0);
    const topGainers   = results.reduce((s, r) => s + Number(r.output?.topGainers ?? 0), 0);

    await this.trace("info",
      `\ud83c\udfac ${totalVideos} vid\u00e9os gagnantes d\u00e9tect\u00e9es \u2014 ${topGainers} class\u00e9es top`,
      { totalVideos, topGainers }, task.id
    );

    return { success: true, output: { totalVideos, topGainers, platforms: 3 } };
  }

  private async detectWinningVideosTikTok(task: AgentTask): Promise<AgentResult> {
    const { niche = "beauty", country = "FR" } = task.input as { niche?: string; country?: string };
    const videos: WinningVideo[] = [];

    try {
      // TikTok Creative Center \u2014 Top Ads par conversions
      const res = await fetch(
        "https://ads.tiktok.com/creative_radar_api/v1/top_ads/list?" +
        `period=30&industry_id=0&objective_type=CONVERSIONS&country_code=${country}&page=1&limit=50`,
        { headers: { "Access-Token": process.env.TIKTOK_ADS_TOKEN ?? "" } }
      );

      if (res.ok) {
        const json = await res.json() as {
          data?: { materials?: Array<{
            item_id:          string;
            advertiser_name:  string;
            ad_title:         string;
            video_info?:      { duration: number };
            like_count:       number;
            comment_count:    number;
            share_count:      number;
            play_count:       number;
            cta_type:         string;
            cover_image_url:  string;
            video_url:        string;
            industry_key:     string;
          }> };
        };

        const ads = json.data?.materials ?? [];

        for (const ad of ads) {
          const engRate = ad.play_count > 0
            ? (ad.like_count + ad.comment_count + ad.share_count) / ad.play_count
            : 0;

          // Score = engagement \u00d7 40 + bonus dur\u00e9e diffusion si disponible
          const viralScore = Math.min(100, Math.round(engRate * 1000 + (ad.like_count > 10000 ? 20 : 0)));

          const video: WinningVideo = {
            id:              ad.item_id,
            platform:        "tiktok",
            platformId:      ad.item_id,
            advertiser:      ad.advertiser_name,
            productCategory: ad.industry_key ?? niche,
            format:          "ugc",  // TikTok = majoritairement UGC
            hookText:        ad.ad_title ?? "",
            hookType:        this.classifyHookType(ad.ad_title ?? ""),
            ctaText:         ad.cta_type ?? "",
            durationDays:    30,     // Top ads 30j \u2192 actives depuis au moins 30j
            estimatedViews:  ad.play_count,
            engagementRate:  engRate,
            viralScore,
            angles:          await this.extractAnglesFromText(ad.ad_title ?? ""),
            thumbnailUrl:    ad.cover_image_url ?? "",
            videoUrl:        ad.video_url ?? "",
            country,
            detectedAt:      new Date(),
          };

          videos.push(video);
          await this.saveWinningVideo(video, task.tenantId);
        }
      }

      // Aussi scraper les vid\u00e9os organiques virales (tendances TikTok)
      const trendRes = await fetch(
        "https://open.tiktokapis.com/v2/research/video/query/",
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${process.env.TIKTOK_RESEARCH_TOKEN}`,
          },
          body: JSON.stringify({
            query: {
              and: [
                { operation: "IN", field_name: "region_code", field_values: [country] },
                { operation: "GT", field_name: "view_count",  field_values: ["500000"] },
              ],
            },
            start_date: this.nDaysAgo(30),
            end_date:   this.today(),
            max_count:  20,
            fields:     "id,username,create_time,region_code,video_description,music_id,like_count,comment_count,share_count,view_count,hashtag_names",
          }),
        }
      );

      if (trendRes.ok) {
        const trendJson = await trendRes.json() as {
          data?: { videos?: Array<{
            id: string; username: string; video_description: string;
            view_count: number; like_count: number; comment_count: number; share_count: number;
            hashtag_names: string[];
          }> };
        };

        for (const v of trendJson.data?.videos ?? []) {
          const engRate = v.view_count > 0
            ? (v.like_count + v.comment_count + v.share_count) / v.view_count
            : 0;

          if (engRate > 0.05) { // >5% engagement = vid\u00e9o organique exceptionnelle
            const video: WinningVideo = {
              id:              `tiktok_organic_${v.id}`,
              platform:        "tiktok",
              platformId:      v.id,
              advertiser:      `@${v.username}`,
              productCategory: niche,
              format:          "ugc",
              hookText:        v.video_description.substring(0, 150),
              hookType:        this.classifyHookType(v.video_description),
              ctaText:         "",
              durationDays:    0,
              estimatedViews:  v.view_count,
              engagementRate:  engRate,
              viralScore:      Math.min(100, Math.round(engRate * 500 + Math.log10(v.view_count) * 5)),
              angles:          v.hashtag_names?.map(h => `#${h}`) ?? [],
              thumbnailUrl:    "",
              videoUrl:        `https://tiktok.com/@${v.username}/video/${v.id}`,
              country,
              detectedAt:      new Date(),
            };
            videos.push(video);
            await this.saveWinningVideo(video, task.tenantId);
          }
        }
      }
    } catch (e) {
      await this.trace("warn", "TikTok spy partial failure", { error: String(e) }, task.id);
    }

    const topGainers = videos.filter(v => v.viralScore > 60).length;

    // \u00c9mettre signal si vid\u00e9os exceptionnelles trouv\u00e9es
    if (topGainers > 0) {
      const top3 = videos.sort((a, b) => b.viralScore - a.viralScore).slice(0, 3);
      await this.pushIntel({
        source:         "AGENT_SPY",
        signal_type:    "spy.tiktok_winning_videos",
        subject:        `${topGainers} vid\u00e9os TikTok gagnantes \u2014 ${niche}`,
        data: {
          niche, country, totalFound: videos.length, topGainers,
          top3Hooks: top3.map(v => ({ hook: v.hookText, score: v.viralScore, views: v.estimatedViews })),
        },
        confidence:     0.85,
        relevance_score: 8,
      }, task.tenantId);

      // Notifier CREATIVE_FACTORY directement
      await this.send({
        fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
        messageType: "ALERT", subject: "spy.tiktok_winning_hooks_available",
        payload: {
          message:     `${topGainers} hooks TikTok gagnants d\u00e9tect\u00e9s sur ${niche}`,
          niche, country,
          topHooks:    top3.map(v => ({
            hook:         v.hookText,
            hookType:     v.hookType,
            viralScore:   v.viralScore,
            views:        v.estimatedViews,
            engagementPct: (v.engagementRate * 100).toFixed(1),
            videoUrl:     v.videoUrl,
          })),
          instruction: "Utiliser ces hooks comme r\u00e9f\u00e9rences pour les prochains briefs UGC.",
        },
        tenantId: task.tenantId, priority: 8,
      });
    }

    return { success: true, output: { platform: "tiktok", videosFound: videos.length, topGainers } };
  }

  private async detectWinningVideosMeta(task: AgentTask): Promise<AgentResult> {
    const { keywords = [], country = "FR", minDays = 14 } = task.input as {
      keywords?: string[]; country?: string; minDays?: number;
    };

    const videos:   WinningVideo[] = [];
    const terms = keywords.length > 0 ? keywords : await this.getActiveNicheKeywords(task.tenantId);

    try {
      for (const term of terms.slice(0, 8)) {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/ads_archive?` +
          `search_terms=${encodeURIComponent(term)}&ad_type=VIDEO&ad_reached_countries=${country}` +
          `&fields=id,ad_creative_body,ad_delivery_start_time,ad_snapshot_url,page_name,` +
          `ad_creative_link_title,spend&limit=50` +
          `&access_token=${process.env.META_ADS_TOKEN}`
        );

        if (!res.ok) continue;
        const json = await res.json() as {
          data?: Array<{
            id:                       string;
            page_name:                string;
            ad_creative_body:         string;
            ad_creative_link_title:   string;
            ad_delivery_start_time:   string;
            ad_snapshot_url:          string;
            spend?:                   { lower_bound: string; upper_bound: string };
          }>;
        };

        for (const ad of json.data ?? []) {
          const start    = new Date(ad.ad_delivery_start_time);
          const runDays  = Math.floor((Date.now() - start.getTime()) / 86400000);

          // Filtre : seulement les vid\u00e9os actives depuis >= minDays
          if (runDays < minDays) continue;

          // Score bas\u00e9 sur la dur\u00e9e de diffusion (proxy du ROAS)
          // + bonus si spend \u00e9lev\u00e9
          const spendLower  = parseInt(ad.spend?.lower_bound ?? "0");
          const spendBonus  = spendLower > 1000 ? 20 : spendLower > 500 ? 10 : 0;
          const viralScore  = Math.min(100,
            Math.round(
              (runDays / 30) * 50   // 50 pts si 30j de diffusion
              + spendBonus          // bonus spend
              + (runDays > 30 ? 15 : 0) // bonus si >1 mois
              + (runDays > 60 ? 15 : 0) // bonus si >2 mois
            )
          );

          const bodyText = ad.ad_creative_body ?? ad.ad_creative_link_title ?? "";

          const video: WinningVideo = {
            id:              `meta_${ad.id}`,
            platform:        "meta",
            platformId:      ad.id,
            advertiser:      ad.page_name,
            productCategory: term,
            format:          "unknown",
            hookText:        bodyText.substring(0, 200),
            hookType:        this.classifyHookType(bodyText),
            ctaText:         "",
            durationDays:    runDays,
            estimatedViews:  0,
            engagementRate:  0,
            viralScore,
            angles:          await this.extractAnglesFromText(bodyText),
            thumbnailUrl:    ad.ad_snapshot_url ?? "",
            videoUrl:        ad.ad_snapshot_url ?? "",
            country,
            detectedAt:      new Date(),
          };

          videos.push(video);
          await this.saveWinningVideo(video, task.tenantId);
        }
      }
    } catch (e) {
      await this.trace("warn", "Meta spy partial failure", { error: String(e) }, task.id);
    }

    const topGainers = videos.filter(v => v.viralScore > 60).length;

    if (topGainers > 0) {
      const top3 = videos.sort((a, b) => b.viralScore - a.viralScore).slice(0, 3);
      await this.send({
        fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
        messageType: "ALERT", subject: "spy.meta_winning_videos_available",
        payload: {
          message:  `${topGainers} vid\u00e9os Meta actives depuis +${minDays}j d\u00e9tect\u00e9es`,
          topVideos: top3.map(v => ({
            hook:      v.hookText.substring(0, 100),
            hookType:  v.hookType,
            runDays:   v.durationDays,
            score:     v.viralScore,
            snapshotUrl: v.videoUrl,
          })),
          instruction: "Ces vid\u00e9os sont ROAS-positives prouv\u00e9es. Analyser les hooks pour les reproduire.",
        },
        tenantId: task.tenantId, priority: 9,
      });
    }

    return { success: true, output: { platform: "meta", videosFound: videos.length, topGainers } };
  }

  private async detectWinningVideosYouTube(task: AgentTask): Promise<AgentResult> {
    const { keywords = [], country = "FR" } = task.input as { keywords?: string[]; country?: string };
    const videos: WinningVideo[] = [];

    try {
      // YouTube Data API \u2014 Top vid\u00e9os par niche
      const terms = keywords.length > 0 ? keywords : await this.getActiveNicheKeywords(task.tenantId);

      for (const term of terms.slice(0, 5)) {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?` +
          `part=snippet&q=${encodeURIComponent(term)}&type=video` +
          `&order=viewCount&regionCode=${country}&maxResults=20` +
          `&videoDuration=short&publishedAfter=${this.nDaysAgoISO(30)}` +
          `&key=${process.env.YOUTUBE_API_KEY}`
        );

        if (!res.ok) continue;
        const json = await res.json() as {
          items?: Array<{
            id:      { videoId: string };
            snippet: { channelTitle: string; title: string; thumbnails: { high: { url: string } } };
          }>;
        };

        const videoIds = (json.items ?? []).map(i => i.id.videoId).join(",");
        if (!videoIds) continue;

        // R\u00e9cup\u00e9rer les stats des vid\u00e9os
        const statsRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?` +
          `part=statistics,contentDetails&id=${videoIds}&key=${process.env.YOUTUBE_API_KEY}`
        );

        if (!statsRes.ok) continue;
        const statsJson = await statsRes.json() as {
          items?: Array<{
            id: string;
            statistics: { viewCount: string; likeCount: string; commentCount: string };
            contentDetails: { duration: string };
          }>;
        };

        for (let i = 0; i < (json.items ?? []).length; i++) {
          const item  = json.items![i];
          const stats = statsJson.items?.find(s => s.id === item.id.videoId);
          if (!stats) continue;

          const views    = parseInt(stats.statistics.viewCount ?? "0");
          const likes    = parseInt(stats.statistics.likeCount ?? "0");
          const comments = parseInt(stats.statistics.commentCount ?? "0");
          const engRate  = views > 0 ? (likes + comments) / views : 0;

          if (views < 100000) continue; // Filtre : >100K vues minimum

          const viralScore = Math.min(100, Math.round(
            Math.log10(Math.max(views, 1)) * 10   // log scale vues
            + engRate * 500                        // engagement
            + (engRate > 0.05 ? 20 : 0)           // bonus si eng >5%
          ));

          const video: WinningVideo = {
            id:              `youtube_${item.id.videoId}`,
            platform:        "meta",  // Garder "meta" comme type g\u00e9n\u00e9rique fallback
            platformId:      item.id.videoId,
            advertiser:      item.snippet.channelTitle,
            productCategory: term,
            format:          "studio",
            hookText:        item.snippet.title,
            hookType:        this.classifyHookType(item.snippet.title),
            ctaText:         "",
            durationDays:    30,
            estimatedViews:  views,
            engagementRate:  engRate,
            viralScore,
            angles:          await this.extractAnglesFromText(item.snippet.title),
            thumbnailUrl:    item.snippet.thumbnails?.high?.url ?? "",
            videoUrl:        `https://youtube.com/watch?v=${item.id.videoId}`,
            country,
            detectedAt:      new Date(),
          };

          videos.push(video);
          await this.saveWinningVideo(video, task.tenantId);
        }
      }
    } catch (e) {
      await this.trace("warn", "YouTube spy partial failure", { error: String(e) }, task.id);
    }

    return { success: true, output: { platform: "youtube", videosFound: videos.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // AXE 2 \u2014 CR\u00c9ATIVES QUI CHIFFRENT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async detectWinningCreatives(task: AgentTask): Promise<AgentResult> {
    const { minRunDays = 21, country = "FR" } = task.input as {
      minRunDays?: number; country?: string;
    };

    await this.trace("info", `\ud83c\udfa8 SPY \u2014 D\u00e9tection cr\u00e9atives (min ${minRunDays}j diffusion)`, {}, task.id);

    const creatives: WinningCreative[] = [];
    const keywords = await this.getActiveNicheKeywords(task.tenantId);

    try {
      // Charger les vid\u00e9os d\u00e9j\u00e0 d\u00e9tect\u00e9es depuis intel.viral_creatives
      const existingR = await db.query(`
        SELECT * FROM intel.viral_creatives
        WHERE run_duration_days >= $1
          AND (country = $2 OR country IS NULL)
        ORDER BY viral_score DESC
        LIMIT 50
      `, [minRunDays, country]);

      for (const row of existingR.rows) {
        // Analyser chaque cr\u00e9ative via LLM pour extraire le brief
        const brief = await this.extractCreativeBrief({
          hookText:    row.hook_text ?? "",
          ctaText:     row.cta ?? "",
          format:      row.format ?? "unknown",
          runDays:     row.run_duration_days ?? minRunDays,
          platform:    row.source,
          advertiser:  row.advertiser ?? "",
          angles:      row.angles ?? [],
        });

        const creative: WinningCreative = {
          id:           row.id,
          platform:     row.source,
          advertiser:   row.advertiser ?? "",
          format:       row.format ?? "unknown",
          hook:         row.hook_text ?? "",
          hookCategory: this.classifyHookType(row.hook_text ?? ""),
          cta:          row.cta ?? "",
          duration:     0,
          runDays:      row.run_duration_days ?? minRunDays,
          style:        "unknown",
          angles:       row.angles ?? [],
          score:        row.viral_score ?? 0,
          brief,
        };

        creatives.push(creative);
      }

      // Aussi analyser les nouvelles vid\u00e9os d\u00e9tect\u00e9es dans cette session
      const freshR = await db.query(`
        SELECT * FROM intel.viral_creatives
        WHERE run_duration_days >= $1 AND detected_at > NOW() - INTERVAL '1 day'
        ORDER BY viral_score DESC LIMIT 20
      `, [minRunDays]);

      for (const row of freshR.rows) {
        if (creatives.find(c => c.id === row.id)) continue;

        const brief = await this.extractCreativeBrief({
          hookText:  row.hook_text ?? "",
          ctaText:   row.cta ?? "",
          format:    row.format ?? "unknown",
          runDays:   row.run_duration_days,
          platform:  row.source,
          advertiser: row.advertiser ?? "",
          angles:    row.angles ?? [],
        });

        creatives.push({
          id: row.id, platform: row.source, advertiser: row.advertiser ?? "",
          format: row.format ?? "unknown",
          hook: row.hook_text ?? "", hookCategory: this.classifyHookType(row.hook_text ?? ""),
          cta: row.cta ?? "", duration: 0, runDays: row.run_duration_days,
          style: "unknown", angles: row.angles ?? [],
          score: row.viral_score ?? 0, brief,
        });
      }

      // Sauvegarder les briefs comme patterns injectables
      for (const creative of creatives.slice(0, 10)) {
        await db.query(`
          INSERT INTO intel.patterns
            (tenant_id, pattern_type, title, data, score, win_rate)
          VALUES ($1, 'creative', $2, $3::jsonb, $4, $5)
          ON CONFLICT DO NOTHING
        `, [
          task.tenantId,
          `[${creative.platform.toUpperCase()}] ${creative.hook.substring(0, 80)}`,
          JSON.stringify({ creative, brief: creative.brief }),
          creative.score,
          Math.min(1, creative.runDays / 60),  // 60j = win_rate 1.0
        ]);
      }

      // Envoyer les top briefs \u00e0 CREATIVE_FACTORY
      const top5 = creatives.sort((a, b) => b.score - a.score).slice(0, 5);
      if (top5.length > 0) {
        await this.send({
          fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
          messageType: "COMMAND", subject: "spy.inject_winning_briefs",
          payload: {
            message:  `${top5.length} briefs cr\u00e9atifs gagnants inject\u00e9s depuis les cr\u00e9atives +${minRunDays}j`,
            briefs:   top5.map(c => ({
              source:       c.platform,
              runDays:      c.runDays,
              score:        c.score,
              hookTemplate: c.brief.hookTemplate,
              hookCategory: c.brief.hookCategory,
              ctaFormula:   c.brief.ctaFormula,
              doList:       c.brief.doList,
              dontList:     c.brief.dontList,
              referenceAd:  c.brief.referenceAd,
            })),
            instruction: "Ces briefs sont issus de cr\u00e9atives prouv\u00e9es. Priorit\u00e9 maximale pour les prochains tests.",
          },
          tenantId: task.tenantId, priority: 9,
        });
      }
    } catch (e) {
      await this.trace("error", "Winning creatives detection failed", { error: String(e) }, task.id);
    }

    return {
      success: true,
      output: { creativesFound: creatives.length, briefs: creatives.slice(0, 5).map(c => c.brief.hookTemplate) },
    };
  }

  private async analyzeCreative(task: AgentTask): Promise<AgentResult> {
    const { url, platform = "meta", context = "" } = task.input as {
      url: string; platform?: string; context?: string;
    };

    await this.trace("info", `\ud83d\udd2c SPY \u2014 Analyse cr\u00e9ative : ${url}`, {}, task.id);

    const analysis = await this.callLLM({
      system: `Tu es un expert en cr\u00e9atives publicitaires e-commerce.
Tu analyses des annonces pour en extraire les patterns qui font convertir.
JSON strict uniquement.`,
      user: `Analyse cette cr\u00e9ative publicitaire et extrait tout ce qui la rend efficace.

URL de l'annonce : ${url}
Plateforme : ${platform}
Contexte produit : ${context}

R\u00e9ponds uniquement en JSON :
{
  "hookText": "Texte exact des 3 premi\u00e8res secondes",
  "hookType": "pain_point|curiosity|social_proof|transformation|question|shock",
  "hookStrength": 0-10,
  "hookExplanation": "Pourquoi ce hook est efficace",
  "format": "ugc|studio|animation|slideshow|talking_head|voiceover",
  "style": "raw|polished|user_made|professional",
  "cta": "Texte exact du CTA",
  "ctaType": "shop_now|learn_more|get_offer|try_now|discover",
  "angles": ["angle 1", "angle 2"],
  "targetAudience": "Description de l\'audience cible",
  "emotionalTrigger": "fear|desire|belonging|status|curiosity|urgency",
  "objectionHandled": "Objection principale lev\u00e9e dans la cr\u00e9ative",
  "hookTemplate": "Template r\u00e9utilisable du hook (ex: Voici pourquoi [pain point]...)",
  "ctaFormula": "Formule CTA r\u00e9utilisable",
  "doList": ["Ce qu\'on doit reproduire"],
  "dontList": ["Ce qu\'on ne doit pas faire"],
  "estimatedScore": 0-100,
  "recommendation": "Comment l\'adapter \u00e0 notre produit"
}`,
      maxTokens: 800,
    });

    let analysisData: Record<string, unknown> = {};
    try { analysisData = JSON.parse(analysis); }
    catch { return { success: false, error: "LLM analysis parse failed" }; }

    // Sauvegarder l'analyse
    await db.query(`
      INSERT INTO intel.patterns (tenant_id, pattern_type, title, data, score)
      VALUES ($1, 'creative_analysis', $2, $3::jsonb, $4)
      ON CONFLICT DO NOTHING
    `, [
      task.tenantId,
      `[${platform.toUpperCase()}] ${String(analysisData.hookText ?? "").substring(0, 80)}`,
      JSON.stringify({ url, platform, analysis: analysisData }),
      Number(analysisData.estimatedScore ?? 50),
    ]);

    // Si score >70, injecter dans CREATIVE_FACTORY
    if (Number(analysisData.estimatedScore ?? 0) > 70) {
      await this.send({
        fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
        messageType: "ALERT", subject: "spy.high_score_creative_analyzed",
        payload: {
          url, platform, score: analysisData.estimatedScore,
          hookTemplate: analysisData.hookTemplate,
          ctaFormula:   analysisData.ctaFormula,
          doList:       analysisData.doList,
          dontList:     analysisData.dontList,
          recommendation: analysisData.recommendation,
        },
        tenantId: task.tenantId, priority: 8,
      });
    }

    return { success: true, output: analysisData };
  }

  private async extractHookPattern(task: AgentTask): Promise<AgentResult> {
    const { hooks = [] } = task.input as { hooks: string[] };

    const analysis = await this.callLLM({
      system: "Expert en copywriting et hooks publicitaires. JSON strict.",
      user: `Analyse ces ${hooks.length} hooks publicitaires gagnants et extrait les patterns communs.

HOOKS :
${hooks.map((h, i) => `${i + 1}. "${h}"`).join("\
")}

{
  "commonPatterns": ["pattern commun 1", "pattern commun 2"],
  "dominantHookType": "pain_point|curiosity|social_proof|transformation|question",
  "dominantEmotionalTrigger": "fear|desire|belonging|status|curiosity|urgency",
  "hookFormulas": [
    { "formula": "Template r\u00e9utilisable", "example": "Exemple concret", "score": 0-10 }
  ],
  "wordsToAlwaysUse": ["mot fort 1", "mot fort 2"],
  "wordsToAvoid": ["mot faible 1"],
  "topHook": "Le meilleur hook des ${hooks.length}",
  "topHookExplanation": "Pourquoi c\'est le meilleur",
  "recommendations": ["recommandation 1", "recommandation 2"]
}`,
      maxTokens: 700,
    });

    let patternData: Record<string, unknown> = {};
    try { patternData = JSON.parse(analysis); }
    catch { return { success: false, error: "Pattern extraction failed" }; }

    // Injecter les patterns dans CREATIVE_FACTORY et COPY
    await this.send({
      fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
      messageType: "COMMAND", subject: "spy.hook_patterns_extracted",
      payload: { patterns: patternData, source: "winning_hooks_analysis", hooksAnalyzed: hooks.length },
      tenantId: task.tenantId, priority: 7,
    });

    await this.send({
      fromAgent: this.agentId, toAgent: "AGENT_COPY",
      messageType: "COMMAND", subject: "spy.hook_patterns_extracted",
      payload: { patterns: patternData, source: "winning_hooks_analysis", hooksAnalyzed: hooks.length },
      tenantId: task.tenantId, priority: 7,
    });

    return { success: true, output: patternData };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // AXE 3 \u2014 BOUTIQUES QUI CHIFFRENT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async detectWinningStores(task: AgentTask): Promise<AgentResult> {
    const { niche = "beauty", country = "FR", minAdDays = 14 } = task.input as {
      niche?: string; country?: string; minAdDays?: number;
    };

    await this.trace("info", `\ud83c\udfea SPY \u2014 D\u00e9tection boutiques gagnantes (${niche})`, {}, task.id);

    const stores: WinningStore[] = [];

    try {
      // \u2500\u2500 \u00c9tape 1 : Trouver les pages Facebook avec ads actives depuis >14j \u2500\u2500
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/ads_archive?` +
        `search_terms=${encodeURIComponent(niche)}&ad_type=ALL&ad_reached_countries=${country}` +
        `&fields=id,page_id,page_name,ad_delivery_start_time,ad_snapshot_url,spend` +
        `&limit=100&access_token=${process.env.META_ADS_TOKEN}`
      );

      const pageAdCounts: Map<string, { name: string; count: number; maxDays: number; totalSpend: number; ads: string[] }> = new Map();

      if (pagesRes.ok) {
        const pagesJson = await pagesRes.json() as {
          data?: Array<{
            page_id: string; page_name: string;
            ad_delivery_start_time: string;
            ad_snapshot_url: string;
            spend?: { lower_bound: string };
          }>;
        };

        for (const ad of pagesJson.data ?? []) {
          const start   = new Date(ad.ad_delivery_start_time);
          const runDays = Math.floor((Date.now() - start.getTime()) / 86400000);

          if (runDays < minAdDays) continue;

          const pageId = ad.page_id;
          const existing = pageAdCounts.get(pageId) ?? {
            name: ad.page_name, count: 0, maxDays: 0, totalSpend: 0, ads: [],
          };

          existing.count++;
          existing.maxDays    = Math.max(existing.maxDays, runDays);
          existing.totalSpend += parseInt(ad.spend?.lower_bound ?? "0");
          if (existing.ads.length < 3) existing.ads.push(ad.ad_snapshot_url ?? "");

          pageAdCounts.set(pageId, existing);
        }
      }

      // \u2500\u2500 \u00c9tape 2 : Pour chaque page avec >2 ads actives, trouver le domaine \u2500\u2500
      for (const [pageId, pageData] of pageAdCounts) {
        if (pageData.count < 2) continue;  // Minimum 2 ads actives

        // R\u00e9cup\u00e9rer le domaine depuis la page Facebook
        const pageRes = await fetch(
          `https://graph.facebook.com/v19.0/${pageId}?` +
          `fields=name,website,link,category&access_token=${process.env.META_ADS_TOKEN}`
        );

        let domain = "";
        let pageName = pageData.name;

        if (pageRes.ok) {
          const pageJson = await pageRes.json() as {
            website?: string; name?: string; link?: string;
          };
          pageName = pageJson.name ?? pageName;
          const website = pageJson.website ?? "";
          domain = website.replace(/^https?:\/\//,"").replace(/\//,"").toLowerCase();
        }

        if (!domain) continue;

        // \u2500\u2500 \u00c9tape 3 : Analyser la boutique (Shopify indicators) \u2500\u2500
        const storeAnalysis = await this.analyzeShopifyStore(domain);

        // \u2500\u2500 \u00c9tape 4 : Estimer le trafic (SimilarWeb si disponible) \u2500\u2500
        const trafficEstimate = await this.estimateStoreTraffic(domain);

        // \u2500\u2500 \u00c9tape 5 : Scorer la boutique \u2500\u2500
        const performanceScore = this.scoreStore({
          adCount:        pageData.count,
          maxAdDays:      pageData.maxDays,
          estimatedSpend: pageData.totalSpend,
          traffic:        trafficEstimate,
          shopifyScore:   storeAnalysis.shopifyScore,
        });

        const store: WinningStore = {
          id:                      `store_${pageId}`,
          domain,
          pageName,
          platform:                storeAnalysis.platform as "shopify" | "woocommerce" | "prestashop" | "custom",
          niche,
          country,
          estimatedMonthlyTraffic: trafficEstimate,
          estimatedAdSpend:        pageData.totalSpend,
          activeAdsCount:          pageData.count,
          longestRunningAdDays:    pageData.maxDays,
          avgAdDuration:           Math.round(pageData.maxDays * 0.7),
          shopifyTheme:            storeAnalysis.theme ?? "",
          installedApps:           storeAnalysis.apps,
          productCount:            storeAnalysis.productCount,
          estimatedRevenue:        this.estimateRevenue(pageData.totalSpend, trafficEstimate),
          hasReviews:              storeAnalysis.apps.some(a => ["judge.me","loox","yotpo","okendo"].includes(a)),
          hasUpsell:               storeAnalysis.apps.some(a => ["reconvert","zipify","bold-upsell"].includes(a)),
          hasEmail:                storeAnalysis.apps.some(a => ["klaviyo","omnisend","mailchimp"].includes(a)),
          trustScore:              storeAnalysis.shopifyScore,
          performanceScore,
          detectedAt:              new Date(),
          adsUrls:                 pageData.ads,
        };

        stores.push(store);
        await this.saveWinningStore(store, task.tenantId);
      }

      // \u2500\u2500 \u00c9tape 6 : Classer et \u00e9mettre les signaux \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const topStores = stores
        .sort((a, b) => b.performanceScore - a.performanceScore)
        .slice(0, 10);

      if (topStores.length > 0) {
        await this.pushIntel({
          source:          "AGENT_SPY",
          signal_type:     "spy.winning_stores_detected",
          subject:         `${topStores.length} boutiques gagnantes d\u00e9tect\u00e9es \u2014 ${niche}`,
          data: {
            niche, country,
            topStores: topStores.map(s => ({
              domain:        s.domain,
              pageName:      s.pageName,
              activeAds:     s.activeAdsCount,
              maxAdDays:     s.longestRunningAdDays,
              revenue:       s.estimatedRevenue,
              score:         s.performanceScore,
              keyApps:       s.installedApps.slice(0, 3),
            })),
          },
          confidence:      0.80,
          relevance_score: 9,
        }, task.tenantId);

        // Notifier MARKET_ANALYSE et WINNER_DETECTOR
        await this.send({
          fromAgent: this.agentId, toAgent: "AGENT_MARKET_ANALYSE",
          messageType: "ALERT", subject: "spy.winning_stores_available",
          payload: {
            message:    `${topStores.length} boutiques qui chiffrent d\u00e9tect\u00e9es sur "${niche}"`,
            topStores:  topStores.slice(0, 5).map(s => ({
              domain:        s.domain,
              revenue:       s.estimatedRevenue,
              activeAds:     s.activeAdsCount,
              maxAdDays:     s.longestRunningAdDays,
              apps:          s.installedApps,
              score:         s.performanceScore,
            })),
            instruction: "Analyser ces boutiques pour identifier les gaps de positionnement et les opportunit\u00e9s.",
          },
          tenantId: task.tenantId, priority: 8,
        });

        await this.send({
          fromAgent: this.agentId, toAgent: "AGENT_WINNER_DETECTOR",
          messageType: "ALERT", subject: "spy.market_validation",
          payload: {
            message:   `${topStores.length} boutiques actives trouv\u00e9es sur "${niche}" \u2014 niche valid\u00e9e`,
            niche,
            validation: {
              competitorCount: topStores.length,
              maxAdDaysFound:  Math.max(...topStores.map(s => s.longestRunningAdDays)),
              avgActiveAds:    topStores.reduce((s, st) => s + st.activeAdsCount, 0) / topStores.length,
              topRevenue:      topStores[0]?.estimatedRevenue,
            },
            conclusion: `Niche "${niche}" a ${topStores.length} boutiques avec ads actives. March\u00e9 valid\u00e9.`,
          },
          tenantId: task.tenantId, priority: 8,
        });
      }
    } catch (e) {
      await this.trace("error", "Winning stores detection failed", { error: String(e) }, task.id);
    }

    return {
      success: true,
      output: {
        storesFound:   stores.length,
        topStore:      stores[0]?.domain,
        topRevenue:    stores[0]?.estimatedRevenue,
        avgAdDays:     stores.length > 0 ? Math.round(stores.reduce((s, st) => s + st.longestRunningAdDays, 0) / stores.length) : 0,
      },
    };
  }

  private async analyzeStore(task: AgentTask): Promise<AgentResult> {
    const { domain } = task.input as { domain: string };
    await this.trace("info", `\ud83d\udd2c SPY \u2014 Analyse boutique : ${domain}`, {}, task.id);

    const [shopify, traffic, adsRes] = await Promise.allSettled([
      this.analyzeShopifyStore(domain),
      this.estimateStoreTraffic(domain),
      this.getStoreMetaAds(domain),
    ]);

    const shopifyData  = shopify.status  === "fulfilled" ? shopify.value  : { apps: [], theme: "", productCount: 0, shopifyScore: 0, platform: "custom" };
    const trafficData  = traffic.status  === "fulfilled" ? traffic.value  : 0;
    const adsData      = adsRes.status   === "fulfilled" ? adsRes.value   : { count: 0, maxDays: 0 };

    const score = this.scoreStore({
      adCount:        adsData.count,
      maxAdDays:      adsData.maxDays,
      estimatedSpend: 0,
      traffic:        trafficData,
      shopifyScore:   shopifyData.shopifyScore,
    });

    const analysis = await this.callLLM({
      system: "Expert en analyse de boutiques e-commerce. JSON strict.",
      user: `Analyse cette boutique e-commerce et donne un diagnostic complet.

Domaine : ${domain}
Plateforme : ${shopifyData.platform}
Apps install\u00e9es : ${shopifyData.apps.join(", ")}
Th\u00e8me : ${shopifyData.theme}
Nombre produits : ${shopifyData.productCount}
Trafic mensuel estim\u00e9 : ${trafficData.toLocaleString()} visites
Ads actives : ${adsData.count} (max ${adsData.maxDays}j de diffusion)
Score performance : ${score}/100

{
  "verdict": "boutique_performante|boutique_active|boutique_faible",
  "strengths": ["force 1", "force 2"],
  "weaknesses": ["faiblesse 1"],
  "revenueRange": "10K-50K|50K-200K|200K+",
  "conversionRate": "estimation %",
  "topProductCategory": "cat\u00e9gorie principale estim\u00e9e",
  "marketingStrategy": "description de leur strat\u00e9gie",
  "opportunities": ["opportunit\u00e9 \u00e0 exploiter pour nous"],
  "recommendation": "Ce qu\'on peut copier ou faire mieux"
}`,
      maxTokens: 600,
    });

    let analysisData: Record<string, unknown> = {};
    try { analysisData = JSON.parse(analysis); } catch { /* continue */ }

    return {
      success: true,
      output: {
        domain, score,
        platform:    shopifyData.platform,
        apps:        shopifyData.apps,
        theme:       shopifyData.theme,
        traffic:     trafficData,
        activeAds:   adsData.count,
        maxAdDays:   adsData.maxDays,
        analysis:    analysisData,
      },
    };
  }

  private async trackStore(task: AgentTask): Promise<AgentResult> {
    const { domain, checkInterval = "daily" } = task.input as {
      domain: string; checkInterval?: string;
    };

    // Enregistrer la boutique pour surveillance continue
    await db.query(`
      INSERT INTO intel.market_data
        (tenant_id, source, data_type, subject, raw_data, expires_at)
      VALUES ($1, 'spy_tracking', 'store_watch', $2, $3::jsonb, NOW() + INTERVAL '90 days')
      ON CONFLICT DO NOTHING
    `, [
      task.tenantId,
      domain,
      JSON.stringify({ domain, checkInterval, trackedSince: new Date().toISOString() }),
    ]);

    await this.trace("info", `\ud83d\udc41\ufe0f  Boutique mise sous surveillance : ${domain}`, { checkInterval }, task.id);

    return {
      success: true,
      output: { domain, tracking: true, checkInterval },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // SCANS COMBIN\u00c9S
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async fullScan(task: AgentTask): Promise<AgentResult> {
    await this.trace("info", "\ud83d\udd75\ufe0f SPY FULL SCAN \u2014 Vid\u00e9os + Cr\u00e9atives + Boutiques", {}, task.id);

    const [videos, creatives, stores] = await Promise.allSettled([
      this.detectWinningVideos(task),
      this.detectWinningCreatives(task),
      this.detectWinningStores(task),
    ]);

    return {
      success: true,
      output: {
        videos:    videos.status    === "fulfilled" ? videos.value.output    : null,
        creatives: creatives.status === "fulfilled" ? creatives.value.output : null,
        stores:    stores.status    === "fulfilled" ? stores.value.output    : null,
      },
    };
  }

  private async nicheDeepDive(task: AgentTask): Promise<AgentResult> {
    const { niche = "beauty", country = "FR" } = task.input as {
      niche: string; country?: string;
    };

    await this.trace("info", `\ud83d\udd2d SPY NICHE DEEP DIVE : ${niche} (${country})`, {}, task.id);

    // Lancer tous les axes + toutes les sources en parall\u00e8le sur la niche
    const taskWithNiche: AgentTask = {
      ...task,
      input: { ...task.input, niche, country, keywords: [niche] },
    };

    const [videos, creatives, stores] = await Promise.allSettled([
      this.detectWinningVideos(taskWithNiche),
      this.detectWinningCreatives(taskWithNiche),
      this.detectWinningStores(taskWithNiche),
    ]);

    // Rapport de synth\u00e8se LLM
    const videosData    = videos.status    === "fulfilled" ? videos.value.output    : {};
    const creativesData = creatives.status === "fulfilled" ? creatives.value.output : {};
    const storesData    = stores.status    === "fulfilled" ? stores.value.output    : {};

    const synthesis = await this.callLLM({
      system: "Expert en analyse de march\u00e9 e-commerce. JSON strict.",
      user: `Synth\u00e8se deep dive sur la niche "${niche}" (${country}).

VID\u00c9OS GAGNANTES : ${JSON.stringify(videosData)}
CR\u00c9ATIVES : ${JSON.stringify(creativesData)}
BOUTIQUES : ${JSON.stringify(storesData)}

{
  "nicheHealth": "explosive|growing|mature|saturated",
  "entryDifficulty": "easy|medium|hard|very_hard",
  "topOpportunity": "La meilleure opportunit\u00e9 identifi\u00e9e",
  "dominantAngles": ["angle dominant 1", "angle dominant 2"],
  "dominantFormats": ["format dominant 1"],
  "winningPriceRange": "estimation fourchette prix gagnants",
  "recommendation": "Doit-on entrer sur cette niche ? Pourquoi ?",
  "nextSteps": ["action concr\u00e8te 1", "action concr\u00e8te 2", "action concr\u00e8te 3"]
}`,
      maxTokens: 600,
    });

    let synthData: Record<string, unknown> = {};
    try { synthData = JSON.parse(synthesis); } catch { /* continue */ }

    // Envoyer la synth\u00e8se \u00e0 CEO + WINNER_DETECTOR
    await this.send({
      fromAgent: this.agentId, toAgent: "AGENT_CEO",
      messageType: "EVENT", subject: "spy.niche_deep_dive_complete",
      payload: { niche, country, synthesis: synthData, raw: { videosData, creativesData, storesData } },
      tenantId: task.tenantId, priority: 7,
    });

    await this.send({
      fromAgent: this.agentId, toAgent: "AGENT_WINNER_DETECTOR",
      messageType: "EVENT", subject: "spy.niche_validated",
      payload: { niche, country, nicheHealth: synthData.nicheHealth,
                 difficulty: synthData.entryDifficulty, opportunity: synthData.topOpportunity },
      tenantId: task.tenantId, priority: 8,
    });

    return {
      success: true,
      output: { niche, country, videos: videosData, creatives: creativesData, stores: storesData, synthesis: synthData },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // HELPERS INTERNES
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private classifyHookType(text: string): WinningVideo["hookType"] {
    const t = text.toLowerCase();
    if (/pourquoi|why|raison|secret|v\u00e9rit\u00e9|truth/.test(t))              return "curiosity";
    if (/j\'ai|j\'ai test\u00e9|j\'ai essay\u00e9|r\u00e9sultat|avant.*apr\u00e8s/.test(t)) return "transformation";
    if (/personnes|avis|t\u00e9moignage|clients|stars/.test(t))              return "social_proof";
    if (/probl\u00e8me|souffre|douleur|arr\u00eater|fini|plus jamais/.test(t))    return "pain_point";
    if (/\?$|comment|combien|quel est/.test(t))                         return "question";
    if (/choc|incroyable|jamais vu|impossible|attention/.test(t))       return "shock";
    return "unknown";
  }

  private async extractAnglesFromText(text: string): Promise<string[]> {
    if (!text || text.length < 10) return [];
    const angles: string[] = [];
    const t = text.toLowerCase();
    if (/naturel|bio|organique|vegan|sans.*chimique/.test(t)) angles.push("naturalit\u00e9");
    if (/rapide|instant|imm\u00e9diat|vite|24h|48h/.test(t))       angles.push("rapidit\u00e9");
    if (/garanti|satisfait|rembours\u00e9|r\u00e9sultat/.test(t))        angles.push("garantie");
    if (/scientifique|prouv\u00e9|clinique|test\u00e9/.test(t))          angles.push("preuve scientifique");
    if (/exclusif|limit\u00e9|rare|unique/.test(t))                 angles.push("exclusivit\u00e9");
    if (/prix|solde|promo|offre|r\u00e9duction/.test(t))            angles.push("prix");
    if (/avis|client|\u00e9toile|recommande/.test(t))               angles.push("social proof");
    return angles;
  }

  private async extractCreativeBrief(params: {
    hookText: string; ctaText: string; format: string;
    runDays: number; platform: string; advertiser: string; angles: string[];
  }): Promise<CreativeBrief> {
    const analysis = await this.callLLM({
      system: "Expert copywriting. JSON strict.",
      user: `Extrait un brief cr\u00e9atif actionnable depuis cette annonce gagnante.

Hook : "${params.hookText}"
CTA : "${params.ctaText}"
Format : ${params.format}
Diffus\u00e9e depuis : ${params.runDays} jours (ROAS positif prouv\u00e9)
Plateforme : ${params.platform}
Annonceur : ${params.advertiser}
Angles : ${params.angles.join(", ")}

{
  "hookTemplate": "Template du hook (ex: [Douleur] ? Voici comment [Solution])",
  "hookCategory": "pain_point|curiosity|social_proof|transformation|question|shock",
  "ctaFormula": "Formule CTA r\u00e9utilisable",
  "styleGuidelines": ["guideline visuel 1", "guideline visuel 2"],
  "doList": ["faire 1", "faire 2", "faire 3"],
  "dontList": ["\u00e9viter 1", "\u00e9viter 2"],
  "confidence": 0.0-1.0
}`,
      maxTokens: 500,
    });

    try {
      const parsed = JSON.parse(analysis);
      return { ...parsed, angles: params.angles, referenceAd: "", confidenceScore: parsed.confidence ?? 0.7 };
    } catch {
      return {
        format: params.format, hookTemplate: params.hookText.substring(0, 100),
        hookCategory: this.classifyHookType(params.hookText),
        ctaFormula: params.ctaText, styleGuidelines: [], angles: params.angles,
        doList: [], dontList: [], referenceAd: "", confidenceScore: 0.5,
      };
    }
  }

  private async analyzeShopifyStore(domain: string): Promise<{
    platform: string; theme: string; apps: string[]; productCount: number; shopifyScore: number;
  }> {
    try {
      const res = await fetch(`https://${domain}`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr-FR,fr;q=0.9" },
      });
      if (!res.ok) return { platform: "unknown", theme: "", apps: [], productCount: 0, shopifyScore: 0 };

      const html = await res.text();

      // D\u00e9tection plateforme
      const isShopify    = /cdn\.shopify\.com|shopify\.com\/themes/.test(html);
      const isWooCommerce = /woocommerce|wp-content\/plugins/.test(html);

      // Extraction apps Shopify connues
      const apps: string[] = [];
      const APP_PATTERNS: Record<string, RegExp> = {
        "klaviyo":      /klaviyo/i,
        "judge.me":     /judge\.me/i,
        "loox":         /loox\.io/i,
        "yotpo":        /yotpo\.com/i,
        "okendo":       /okendo\.io/i,
        "omnisend":     /omnisend/i,
        "reconvert":    /reconvert/i,
        "zipify":       /zipify/i,
        "hotjar":       /hotjar/i,
        "lucky-orange": /luckyorange/i,
        "pagefly":      /pagefly/i,
        "gempages":     /gempages/i,
        "privy":        /privy/i,
        "trustpilot":   /trustpilot/i,
        "chat":         /tidio|gorgias|zendesk|intercom/i,
      };

      for (const [appName, pattern] of Object.entries(APP_PATTERNS)) {
        if (pattern.test(html)) apps.push(appName);
      }

      // Th\u00e8me Shopify
      const themeMatch = html.match(/Shopify\.theme\s*=\s*{"name":"([^"]+)"/);
      const theme      = themeMatch?.[1] ?? "";

      // Compter les produits (JSON-LD)
      const productCountMatch = html.match(/"numberOfItems"\s*:\s*(\d+)/);
      const productCount      = parseInt(productCountMatch?.[1] ?? "0");

      // Score Shopify (0-100) bas\u00e9 sur les signaux de s\u00e9rieux
      let shopifyScore = 0;
      if (isShopify)                                              shopifyScore += 20;
      if (apps.includes("klaviyo") || apps.includes("omnisend")) shopifyScore += 20;
      if (apps.includes("judge.me") || apps.includes("loox"))    shopifyScore += 15;
      if (apps.includes("chat"))                                  shopifyScore += 10;
      if (theme)                                                  shopifyScore += 10;
      if (apps.includes("hotjar") || apps.includes("lucky-orange")) shopifyScore += 10;
      if (apps.includes("reconvert") || apps.includes("zipify")) shopifyScore += 15;

      return {
        platform:     isShopify ? "shopify" : isWooCommerce ? "woocommerce" : "custom",
        theme, apps, productCount, shopifyScore,
      };
    } catch {
      return { platform: "unknown", theme: "", apps: [], productCount: 0, shopifyScore: 0 };
    }
  }

  private async estimateStoreTraffic(domain: string): Promise<number> {
    try {
      if (!process.env.SIMILARWEB_API_KEY) return 0;
      const res = await fetch(
        `https://api.similarweb.com/v1/website/${domain}/total-traffic-and-engagement/visits?` +
        `api_key=${process.env.SIMILARWEB_API_KEY}&start_date=${this.nMonthsAgo(1)}&end_date=${this.today()}&granularity=monthly`
      );
      if (!res.ok) return 0;
      const json = await res.json() as { visits?: Array<{ visits: number }> };
      return json.visits?.[0]?.visits ?? 0;
    } catch { return 0; }
  }

  private async getStoreMetaAds(domain: string): Promise<{ count: number; maxDays: number }> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/ads_archive?search_terms=${encodeURIComponent(domain)}` +
        `&ad_type=ALL&ad_reached_countries=FR&fields=ad_delivery_start_time&limit=50` +
        `&access_token=${process.env.META_ADS_TOKEN}`
      );
      if (!res.ok) return { count: 0, maxDays: 0 };
      const json = await res.json() as { data?: Array<{ ad_delivery_start_time: string }> };
      const ads  = json.data ?? [];
      const days = ads.map(ad => Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000));
      return { count: ads.length, maxDays: days.length > 0 ? Math.max(...days) : 0 };
    } catch { return { count: 0, maxDays: 0 }; }
  }

  private scoreStore(params: {
    adCount: number; maxAdDays: number; estimatedSpend: number; traffic: number; shopifyScore: number;
  }): number {
    let score = 0;
    // Ads actives (proxy ROAS)
    score += Math.min(30, params.adCount * 3);
    // Dur\u00e9e diffusion (proof of profitability)
    score += Math.min(25, params.maxAdDays * 0.5);
    // Spend estim\u00e9
    score += params.estimatedSpend > 5000 ? 20 : params.estimatedSpend > 1000 ? 10 : 0;
    // Trafic SimilarWeb
    score += params.traffic > 50000 ? 15 : params.traffic > 10000 ? 8 : 0;
    // Qualit\u00e9 boutique
    score += Math.round(params.shopifyScore * 0.1);
    return Math.min(100, Math.round(score));
  }

  private estimateRevenue(adSpend: number, traffic: number): string {
    const estimated = adSpend * 3 + traffic * 0.05;  // Proxy grossier
    if (estimated > 200000) return "200K+";
    if (estimated > 50000)  return "50K-200K";
    if (estimated > 10000)  return "10K-50K";
    return "<10K";
  }

  private async saveWinningVideo(video: WinningVideo, tenantId?: string): Promise<void> {
    await db.query(`
      INSERT INTO intel.viral_creatives
        (source, platform_id, advertiser, product_category, format,
         hook_text, cta, estimated_spend, run_duration_days,
         engagement_rate, viral_score, angles, country, detected_at, last_seen_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,NOW(),NOW())
      ON CONFLICT (source, platform_id) DO UPDATE SET
        viral_score    = GREATEST(intel.viral_creatives.viral_score, EXCLUDED.viral_score),
        last_seen_at   = NOW(),
        run_duration_days = EXCLUDED.run_duration_days
    `, [
      video.platform, video.platformId, video.advertiser, video.productCategory, video.format,
      video.hookText, video.ctaText, "0",
      video.durationDays, video.engagementRate, video.viralScore,
      JSON.stringify(video.angles), video.country,
    ]).catch(() => {});
  }

  private async saveWinningStore(store: WinningStore, tenantId?: string): Promise<void> {
    await db.query(`
      INSERT INTO intel.market_data
        (tenant_id, source, data_type, subject, raw_data, confidence, expires_at)
      VALUES ($1, 'spy_winning_stores', 'store', $2, $3::jsonb, $4, NOW() + INTERVAL '7 days')
      ON CONFLICT DO NOTHING
    `, [
      tenantId ?? null, store.domain,
      JSON.stringify(store), store.performanceScore / 100,
    ]).catch(() => {});
  }

  private async getActiveNicheKeywords(tenantId?: string): Promise<string[]> {
    const r = await db.query(`
      SELECT DISTINCT keyword FROM intel.trending_keywords
      WHERE (tenant_id = $1 OR tenant_id IS NULL)
        AND trend_direction IN ('rising','breakout')
      ORDER BY trend_score DESC LIMIT 8
    `, [tenantId ?? null]).catch(() => ({ rows: [] }));
    return r.rows.length > 0
      ? r.rows.map((row: { keyword: string }) => row.keyword)
      : ["beauty", "skincare", "wellness", "fitness"];
  }

  // Date helpers
  private today        = () => new Date().toISOString().split("T")[0];
  private nDaysAgo     = (n: number) => new Date(Date.now() - n*86400000).toISOString().split("T")[0];
  private nDaysAgoISO  = (n: number) => new Date(Date.now() - n*86400000).toISOString();
  private nMonthsAgo   = (n: number) => { const d = new Date(); d.setMonth(d.getMonth()-n); return d.toISOString().split("T")[0]; };

  protected async callLLM(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: opts.maxTokens,
        system:     opts.system,
        messages:   [{ role: "user", content: opts.user }],
      }),
    });
    const data = await res.json() as { content: { type: string; text: string }[] };
    return data.content.find(b => b.type === "text")?.text ?? "";
  }
}
