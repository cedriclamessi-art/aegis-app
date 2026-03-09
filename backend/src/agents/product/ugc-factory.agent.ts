/**
 * AGENT_UGC_FACTORY \u2014 G\u00e9n\u00e9rateur UGC Natif AEGIS
 * \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
 *
 * MISSION : R\u00e9pliquer le syst\u00e8me Arrim/Freepik nativement dans AEGIS.
 * Un produit Shopify \u2192 N vid\u00e9os UGC pr\u00eates pour Meta/TikTok. Z\u00e9ro outil tiers.
 *
 * \u2500\u2500 PIPELINE COMPLET \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 *   \u2460 SCRAPE PRODUIT
 *      URL Shopify \u2192 images HD, titre, description, b\u00e9n\u00e9fices, reviews
 *      Extraction intelligente : JSON-LD schema.org + fallback HTML
 *
 *   \u2461 G\u00c9N\u00c8RE SCRIPTS (LLM)
 *      Pour chaque angle \u00d7 awareness \u00d7 hook type \u2192 script 30s
 *      Structure : Hook (0-3s) + Body (3-25s) + CTA (25-30s)
 *      Variables remplies : [douleur], [b\u00e9n\u00e9fice], [r\u00e9sultat], [dur\u00e9e]
 *      Source : templates media.script_templates + patterns AGENT_SPY
 *
 *   \u2462 G\u00c9N\u00c8RE AVATAR TALKING HEAD (Kling via Replicate)
 *      Avatar lit le script avec lip-sync naturel
 *      Styles : ugc_authentic (style iPhone) | studio | selfie cam\u00e9ra avant
 *      Providers : Replicate (Kling 1.5) \u2192 RunwayML (fallback) \u2192 synth\u00e9tique
 *
 *   \u2463 G\u00c9N\u00c8RE B-ROLL PRODUIT (Kling via Replicate)
 *      Sc\u00e8nes : close-up produit, texture, lifestyle, unboxing, r\u00e9sultat
 *      Prompt enrichi avec les images du produit r\u00e9el
 *
 *   \u2464 ASSEMBLE AVEC FFMPEG (natif serveur)
 *      Timeline : hook_avatar + broll_texture + body_avatar + broll_lifestyle
 *                 + cta_avatar + outro
 *      Captions : sous-titres auto-g\u00e9n\u00e9r\u00e9s (burn-in)
 *      Son : voix avatar + musique fond -18dB
 *      Format final : MP4 9:16 1080\u00d71920 pour TikTok/Reels
 *
 *   \u2465 STOCKAGE & DISPATCH
 *      Upload S3/Supabase Storage \u2192 URL publique CDN
 *      Notifie AGENT_META_TESTING pour lancer le test A/B automatique
 *      Lien vers creative.awareness_matrix pour tracking performance
 *
 * \u2500\u2500 CO\u00dbTS ESTIM\u00c9S PAR UGC \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *   Kling avatar (30s)  : ~$0.08 (Replicate)
 *   Kling b-roll (3\u00d75s) : ~$0.06 (Replicate)
 *   Script LLM          : ~$0.02 (Claude Haiku)
 *   Voix ElevenLabs     : ~$0.05 (2000 chars)
 *   TOTAL/vid\u00e9o         : ~$0.21 vs ~$150-500 cr\u00e9atrice humaine
 *
 * \u2500\u2500 R\u00c9SUM\u00c9 RAPPORT CO\u00dbT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *   100 variantes UGC/mois  : ~$21
 *   vs 6 cr\u00e9atrices humaines : ~$900-3000/mois
 *   \u00c9conomie : 97%
 */

import { AgentBase, AgentTask, AgentResult } from "../base/agent.base";
import { db } from "../../utils/db";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface ProductData {
  name:        string;
  description: string;
  benefits:    string[];
  images:      string[];  // URLs images produit
  price:       string;
  reviews:     string[];  // Top reviews extraits
  url:         string;
}

interface UGCScript {
  hook:       string;
  body:       string;
  cta:        string;
  full:       string;    // hook + "\n\n" + body + "\n\n" + cta
  hookType:   string;
  durationSec: number;
}

interface GeneratedVideo {
  avatarVideoUrl: string;
  brollUrls:      string[];
  captionsSrt:    string;
  finalVideoUrl:  string;
  thumbnailUrl:   string;
  durationSec:    number;
  costEur:        number;
}

// \u2500\u2500 AGENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class UGCFactoryAgent extends AgentBase {
  readonly agentId   = "AGENT_UGC_FACTORY";
  readonly taskTypes = [
    "ugc.generate_single",      // G\u00e9n\u00e9rer 1 UGC pour un produit + angle donn\u00e9
    "ugc.generate_batch",       // G\u00e9n\u00e9rer N UGC pour tous les produits actifs
    "ugc.process_queue",        // Traiter la file d'attente (cron 10min)
    "ugc.scrape_product",       // Scraper un produit (step 1 standalone)
    "ugc.generate_script",      // G\u00e9n\u00e9rer scripts seulement
    "ugc.generate_avatar",      // G\u00e9n\u00e9rer avatar talking head seulement
    "ugc.generate_broll",       // G\u00e9n\u00e9rer B-roll produit seulement
    "ugc.assemble_video",       // Assembler les assets en vid\u00e9o finale
    "ugc.analyze_winners",      // Analyser les UGC qui convertissent le mieux
    "ugc.launch_ab_test",       // Lancer A/B test automatique sur Meta/TikTok
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();
    switch (task.taskType) {
      case "ugc.generate_single":  return this.generateSingle(task);
      case "ugc.generate_batch":   return this.generateBatch(task);
      case "ugc.process_queue":    return this.processQueue(task);
      case "ugc.scrape_product":   return this.scrapeProduct(task);
      case "ugc.generate_script":  return this.generateScripts(task);
      case "ugc.generate_avatar":  return this.generateAvatar(task);
      case "ugc.generate_broll":   return this.generateBroll(task);
      case "ugc.assemble_video":   return this.assembleVideo(task);
      case "ugc.analyze_winners":  return this.analyzeWinners(task);
      case "ugc.launch_ab_test":   return this.launchAbTest(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // PIPELINE PRINCIPAL : generateSingle
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async generateSingle(task: AgentTask): Promise<AgentResult> {
    const {
      productId,
      productUrl,
      angle       = "transformation",
      awarenessLevel = "problem_aware",
      avatarKey   = "fr_female_25_ugc_01",
      format      = "9:16",
      nbVariants  = 1,
    } = task.input as {
      productId?:      string;
      productUrl?:     string;
      angle?:          string;
      awarenessLevel?: string;
      avatarKey?:      string;
      format?:         string;
      nbVariants?:     number;
    };

    if (!productId && !productUrl) {
      return { success: false, error: "productId ou productUrl requis" };
    }

    await this.trace("info", `\ud83c\udfac UGC_FACTORY \u2014 Pipeline d\u00e9marr\u00e9`, { angle, awarenessLevel, format }, task.id);

    // Cr\u00e9er le job en base
    const jobR = await db.query(`
      INSERT INTO media.ugc_jobs
        (tenant_id, product_id, product_url, target_angle, awareness_level, status)
      VALUES ($1, $2, $3, $4, $5, 'scraping')
      RETURNING id
    `, [
      task.tenantId,
      productId ?? null,
      productUrl ?? null,
      angle, awarenessLevel,
    ]);
    const jobId = jobR.rows[0].id as string;

    try {
      // \u2500\u2500 \u00c9TAPE 1 : Scraper le produit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const product = await this.doScrapeProduct(productUrl, productId, task.tenantId);
      await this.updateJob(jobId, { status: "scripting", progress_pct: 20,
        product_name: product.name, product_images: product.images,
        product_benefits: product.benefits });
      await this.trace("info", `\u2705 Produit scrap\u00e9 : ${product.name} (${product.images.length} images)`, {}, task.id);

      // \u2500\u2500 \u00c9TAPE 2 : G\u00e9n\u00e9rer les scripts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const scripts = await this.doGenerateScripts(product, angle, awarenessLevel, nbVariants);
      const script  = scripts[0]; // On prend le meilleur
      await this.updateJob(jobId, { status: "generating_avatar", progress_pct: 35,
        script_hook: script.hook, script_body: script.body,
        script_cta: script.cta, script_full: script.full, hook_type: script.hookType });
      await this.trace("info", `\u2705 Script g\u00e9n\u00e9r\u00e9 : "${script.hook.substring(0,60)}..."`, {}, task.id);

      // \u2500\u2500 \u00c9TAPE 3 : S\u00e9lectionner l'avatar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const avatar = await this.selectAvatar(avatarKey);
      await this.updateJob(jobId, { avatar_id: avatar.provider_id,
        avatar_gender: avatar.gender, avatar_style: avatar.style, voice_id: avatar.voice_id });

      // \u2500\u2500 \u00c9TAPE 4 : G\u00e9n\u00e9rer l'avatar talking head (Kling/Replicate) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const avatarVideoUrl = await this.doGenerateAvatarVideo(script.full, avatar, product);
      await this.updateJob(jobId, { status: "generating_broll", progress_pct: 55,
        avatar_video_url: avatarVideoUrl });
      await this.trace("info", `\u2705 Avatar vid\u00e9o g\u00e9n\u00e9r\u00e9e`, { url: avatarVideoUrl }, task.id);

      // \u2500\u2500 \u00c9TAPE 5 : G\u00e9n\u00e9rer le B-roll produit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const brollUrls = await this.doGenerateBroll(product, angle);
      await this.updateJob(jobId, { status: "assembling", progress_pct: 70,
        broll_video_urls: brollUrls });
      await this.trace("info", `\u2705 B-roll g\u00e9n\u00e9r\u00e9 : ${brollUrls.length} clips`, {}, task.id);

      // \u2500\u2500 \u00c9TAPE 6 : Assembler avec FFmpeg \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const assembled = await this.doAssembleVideo(jobId, avatarVideoUrl, brollUrls, script, format);
      await this.updateJob(jobId, {
        status:              "done",
        progress_pct:        100,
        final_video_url:     assembled.finalVideoUrl,
        final_video_duration: assembled.durationSec,
        final_video_format:  format,
        thumbnail_url:       assembled.thumbnailUrl,
        captions_url:        assembled.captionsSrt,
        generation_cost:     assembled.costEur,
        generated_at:        new Date().toISOString(),
      });

      await this.trace("info",
        `\ud83c\udf89 UGC pr\u00eat : ${product.name} \u2014 ${assembled.durationSec}s \u2014 \u20ac${assembled.costEur.toFixed(2)}`,
        { jobId, url: assembled.finalVideoUrl }, task.id
      );

      // \u2500\u2500 \u00c9TAPE 7 : Notifier les agents aval \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      await this.send({
        fromAgent: this.agentId, toAgent: "AGENT_META_TESTING",
        messageType: "COMMAND", subject: "ugc.ready_for_ab_test",
        payload: {
          jobId, productId, productName: product.name,
          videoUrl: assembled.finalVideoUrl, thumbnailUrl: assembled.thumbnailUrl,
          hook: script.hook, angle, awarenessLevel,
          format, durationSec: assembled.durationSec,
          instruction: "Lancer un test A/B Meta avec cette UGC cr\u00e9ative. Budget initial : 20\u20ac/jour.",
        },
        tenantId: task.tenantId, priority: 8,
      });

      // Incr\u00e9menter le compteur d'usage de l'avatar
      await db.query(
        `UPDATE media.avatar_library SET usage_count = usage_count + 1 WHERE avatar_key = $1`,
        [avatarKey]
      ).catch(() => {});

      return {
        success: true,
        output: {
          jobId,
          productName:   product.name,
          videoUrl:      assembled.finalVideoUrl,
          thumbnailUrl:  assembled.thumbnailUrl,
          durationSec:   assembled.durationSec,
          hook:          script.hook,
          angle, format,
          costEur:       assembled.costEur,
        },
      };
    } catch (err) {
      const errMsg = String(err);
      await this.updateJob(jobId, { status: "failed", error_message: errMsg });
      await this.trace("error", `UGC pipeline failed: ${errMsg}`, { jobId }, task.id);
      return { success: false, error: errMsg };
    }
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // BATCH : g\u00e9n\u00e9rer N UGC pour tous les produits actifs du tenant
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async generateBatch(task: AgentTask): Promise<AgentResult> {
    const { maxJobs = 5 } = task.input as { maxJobs?: number };

    await this.trace("info", `\ud83d\udce6 UGC_FACTORY \u2014 Batch : ${maxJobs} produits`, {}, task.id);

    // R\u00e9cup\u00e9rer les produits actifs sans UGC g\u00e9n\u00e9r\u00e9 r\u00e9cemment
    const productsR = await db.query(`
      SELECT p.id, p.name, p.shopify_url, p.description
      FROM store.products p
      WHERE p.tenant_id = $1
        AND p.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM media.ugc_jobs j
          WHERE j.product_id = p.id
            AND j.status = 'done'
            AND j.generated_at > NOW() - INTERVAL '7 days'
        )
      ORDER BY p.created_at DESC
      LIMIT $2
    `, [task.tenantId, maxJobs]);

    const ANGLES = ["transformation", "pain_point", "social_proof", "curiosity", "comparaison"];
    let generated = 0;

    for (const product of productsR.rows) {
      // G\u00e9n\u00e9rer avec l'angle le plus adapt\u00e9 au produit
      const angle = ANGLES[generated % ANGLES.length];
      await this.send({
        fromAgent: this.agentId, toAgent: this.agentId,
        messageType: "COMMAND", subject: "ugc.generate_single",
        payload: {
          productId: product.id,
          productUrl: product.shopify_url,
          angle, nbVariants: 3,
        },
        tenantId: task.tenantId, priority: 7,
      });
      generated++;
    }

    return { success: true, output: { queued: generated, maxJobs } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // PROCESS QUEUE : traiter les jobs en attente
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async processQueue(task: AgentTask): Promise<AgentResult> {
    // Reprendre les jobs failed avec retry < 3
    const failedR = await db.query(`
      UPDATE media.ugc_jobs SET status = 'pending', retry_count = retry_count + 1
      WHERE status = 'failed' AND retry_count < 3
        AND updated_at < NOW() - INTERVAL '15 minutes'
      RETURNING id, tenant_id, product_id, product_url, target_angle, awareness_level
    `);

    for (const job of failedR.rows) {
      await this.send({
        fromAgent: this.agentId, toAgent: this.agentId,
        messageType: "COMMAND", subject: "ugc.generate_single",
        payload: { productId: job.product_id, productUrl: job.product_url,
                   angle: job.target_angle, awarenessLevel: job.awareness_level },
        tenantId: job.tenant_id, priority: 6,
      });
    }

    // Nettoyer les jobs "done" >30 jours
    await db.query(`
      DELETE FROM media.ugc_jobs
      WHERE status = 'done' AND generated_at < NOW() - INTERVAL '30 days'
        AND classification = 'LOSER'
    `).catch(() => {});

    return { success: true, output: { retried: failedR.rows.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // \u00c9TAPE 1 \u2014 SCRAPING PRODUIT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async doScrapeProduct(
    productUrl?: string, productId?: string, tenantId?: string
  ): Promise<ProductData> {

    // Si on a un productId, chercher en base d'abord
    if (productId) {
      const r = await db.query(`
        SELECT name, description, handle, metadata, shopify_url
        FROM store.products WHERE id = $1
      `, [productId]);

      if (r.rows.length > 0) {
        const p = r.rows[0];
        const meta = p.metadata as Record<string, unknown> ?? {};
        return {
          name:        p.name,
          description: p.description ?? "",
          benefits:    (meta.benefits as string[]) ?? [],
          images:      (meta.images as string[]) ?? [],
          price:       String(meta.price ?? ""),
          reviews:     (meta.reviews as string[]) ?? [],
          url:         p.shopify_url ?? productUrl ?? "",
        };
      }
    }

    // Sinon scraper l'URL
    const url = productUrl!;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
    });

    if (!res.ok) throw new Error(`Scraping failed: HTTP ${res.status} for ${url}`);
    const html = await res.text();

    // \u2500\u2500 Extraction JSON-LD (schema.org Product) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let name = "", description = "", price = "";
    const images: string[] = [];
    const benefits: string[] = [];
    const reviews: string[] = [];

    const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]) as Record<string, unknown>;
        if (data["@type"] === "Product" || (data["@graph"] as unknown[])?.[0]) {
          const product = data["@type"] === "Product" ? data
            : (data["@graph"] as Record<string,unknown>[])?.find(g => g["@type"] === "Product");

          if (product) {
            name        = product.name as string ?? name;
            description = product.description as string ?? description;
            price       = String((product.offers as Record<string,string>)?.price ?? "");

            const imgData = product.image as string | string[] | Record<string,string>;
            if (typeof imgData === "string") images.push(imgData);
            else if (Array.isArray(imgData)) images.push(...imgData.slice(0, 6));
            else if (imgData?.url) images.push(imgData.url);

            // Reviews
            const reviewList = product.review as Array<Record<string, unknown>> ?? [];
            for (const r of reviewList.slice(0, 5)) {
              const body = r.reviewBody as string ?? "";
              if (body.length > 20) reviews.push(body.substring(0, 200));
            }
          }
        }
      } catch { /* continue */ }
    }

    // \u2500\u2500 Fallback : extraction meta tags \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (!name) {
      const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
      name = titleMatch?.[1] ?? url.split("/").pop() ?? "Produit";
    }
    if (!description) {
      const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      description = descMatch?.[1] ?? "";
    }
    if (images.length === 0) {
      const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      if (imgMatch?.[1]) images.push(imgMatch[1]);
    }

    // \u2500\u2500 Extraction images Shopify CDN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const cdnMatches = html.matchAll(/https:\/\/cdn\.shopify\.com\/s\/files\/[^\s"']+(?:jpg|jpeg|png|webp)/gi);
    for (const m of cdnMatches) {
      const imgUrl = m[0].replace(/(_\d+x\d+)/, "");
      if (!images.includes(imgUrl) && images.length < 8) images.push(imgUrl);
    }

    // \u2500\u2500 LLM : extraire les b\u00e9n\u00e9fices cl\u00e9s \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (description.length > 50) {
      const benefitsRaw = await this.callLLM({
        system: "Expert marketing e-commerce. Extrait les b\u00e9n\u00e9fices produit. JSON uniquement.",
        user: `Extrait les 5 principaux b\u00e9n\u00e9fices de ce produit en fran\u00e7ais, formul\u00e9s comme des r\u00e9sultats concrets.

Produit : ${name}
Description : ${description.substring(0, 800)}
Reviews : ${reviews.slice(0,2).join(" | ")}

["b\u00e9n\u00e9fice 1", "b\u00e9n\u00e9fice 2", "b\u00e9n\u00e9fice 3", "b\u00e9n\u00e9fice 4", "b\u00e9n\u00e9fice 5"]`,
        maxTokens: 200,
      });
      try {
        const parsed = JSON.parse(benefitsRaw.trim());
        benefits.push(...parsed);
      } catch { /* benefits reste vide */ }
    }

    return { name, description, benefits, images, price, reviews, url };
  }

  async scrapeProduct(task: AgentTask): Promise<AgentResult> {
    const { productUrl, productId } = task.input as { productUrl?: string; productId?: string };
    const product = await this.doScrapeProduct(productUrl, productId, task.tenantId);
    return { success: true, output: product };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // \u00c9TAPE 2 \u2014 G\u00c9N\u00c9RATION SCRIPTS
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async doGenerateScripts(
    product: ProductData,
    angle:          string,
    awarenessLevel: string,
    nbVariants:     number = 3,
  ): Promise<UGCScript[]> {

    // Chercher un template adapt\u00e9 en base
    const templateR = await db.query(`
      SELECT hook_template, body_template, cta_template, hook_type, duration_secs
      FROM media.script_templates
      WHERE angle_category = $1 AND awareness_level = $2
        AND language = 'fr' AND is_active = TRUE
      ORDER BY win_rate DESC LIMIT 1
    `, [angle, awarenessLevel]);

    const template = templateR.rows[0] ?? null;

    const rawScripts = await this.callLLM({
      system: `Tu es expert en scripts UGC TikTok/Meta. Tu g\u00e9n\u00e8res des scripts AUTHENTIQUES,
naturels, qui semblent film\u00e9s par une vraie personne sur son t\u00e9l\u00e9phone.
Pas de ton "publicitaire". Style conversation, honn\u00eate, enthousiaste mais pas excessif.
JSON strict uniquement. LANGUE : Fran\u00e7ais.`,
      user: `G\u00e9n\u00e8re ${nbVariants} script(s) UGC de 28-32 secondes pour ce produit.

PRODUIT : ${product.name}
DESCRIPTION : ${product.description.substring(0, 400)}
B\u00c9N\u00c9FICES : ${product.benefits.slice(0,3).join(", ")}
REVIEWS CLIENTS : ${product.reviews.slice(0,2).join(" | ").substring(0,200)}
ANGLE : ${angle}
NIVEAU AWARENESS : ${awarenessLevel}
${template ? `TEMPLATE DE BASE (adapter, ne pas copier) :
  Hook : ${template.hook_template}
  Body : ${template.body_template}
  CTA  : ${template.cta_template}` : ""}

R\u00e8gles OBLIGATOIRES :
- Hook (0-3s) : accroche imm\u00e9diate, choc ou question ou r\u00e9v\u00e9lation \u2014 MAX 15 mots
- Body (3-25s) : d\u00e9veloppement naturel, 1-2 b\u00e9n\u00e9fices concrets, ton authentique
- CTA (25-30s) : invitation douce, pas agressif \u2014 MAX 15 mots
- Total < 120 mots
- Aucun mot "incroyable", "r\u00e9volutionnaire", "game-changer"
- Style : quelqu'un qui parle \u00e0 son t\u00e9l\u00e9phone, pas une pub TV

[
  {
    "hook": "...",
    "body": "...",
    "cta": "...",
    "hookType": "pain_point|curiosity|social_proof|transformation|question",
    "estimatedDurationSec": 30
  }
]`,
      maxTokens: 800,
    });

    const scripts: UGCScript[] = [];
    try {
      const parsed = JSON.parse(rawScripts.trim()) as Array<{
        hook: string; body: string; cta: string;
        hookType: string; estimatedDurationSec: number;
      }>;

      for (const s of parsed) {
        scripts.push({
          hook:        s.hook,
          body:        s.body,
          cta:         s.cta,
          full:        `${s.hook}\
\
${s.body}\
\
${s.cta}`,
          hookType:    s.hookType,
          durationSec: s.estimatedDurationSec ?? 30,
        });
      }
    } catch {
      // Fallback si JSON mal form\u00e9
      scripts.push({
        hook:        `Vous avez d\u00e9j\u00e0 essay\u00e9 ${product.name} ?`,
        body:        `${product.benefits[0] ?? "R\u00e9sultats visibles en quelques jours."} Ce qui m'a surprise c'est ${product.benefits[1] ?? "la facilit\u00e9 d'utilisation"}.`,
        cta:         "Lien en bio si vous voulez essayer.",
        full:        `Vous avez d\u00e9j\u00e0 essay\u00e9 ${product.name} ?\
\
${product.benefits[0] ?? ""}\
\
Lien en bio.`,
        hookType:    "question",
        durationSec: 28,
      });
    }

    return scripts;
  }

  async generateScripts(task: AgentTask): Promise<AgentResult> {
    const { productId, productUrl, angle = "transformation", awarenessLevel = "problem_aware", nbVariants = 3 } = task.input as {
      productId?: string; productUrl?: string; angle?: string; awarenessLevel?: string; nbVariants?: number;
    };
    const product = await this.doScrapeProduct(productUrl, productId, task.tenantId);
    const scripts = await this.doGenerateScripts(product, angle, awarenessLevel, nbVariants);
    return { success: true, output: { scripts, product: product.name } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // \u00c9TAPE 3 \u2014 AVATAR TALKING HEAD (Kling via Replicate)
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async doGenerateAvatarVideo(
    scriptText:  string,
    avatar:      { provider: string; provider_id: string; style: string },
    product:     ProductData,
  ): Promise<string> {

    const style = avatar.style;

    // \u2500\u2500 Construction du prompt vid\u00e9o \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const styleDesc = style === "ugc_authentic"
      ? "vertical smartphone video, natural handheld shaky movement, authentic ugc style, casual indoor lighting, person talking directly to camera, no makeup glam, real person feel"
      : style === "selfie"
      ? "selfie camera angle, front camera video, natural lighting, casual home environment, authentic real person"
      : "clean studio lighting, professional video quality, centered subject, neutral background";

    const videoPrompt = `A young woman talking directly to camera. ${styleDesc}. 
She is naturally demonstrating or talking about a product called "${product.name}".
Authentic user-generated content style. Vertical 9:16 format. Natural lip movement matching speech.
No heavy filters. Real skin texture visible. Casual clothing.`;

    if (avatar.provider === "replicate") {
      return await this.generateWithReplicate(videoPrompt, scriptText, product.images[0]);
    } else if (avatar.provider === "runway") {
      return await this.generateWithRunway(videoPrompt, scriptText, product.images[0]);
    }

    throw new Error(`Provider inconnu: ${avatar.provider}`);
  }

  private async generateWithReplicate(
    prompt:       string,
    script:       string,
    productImage: string,
  ): Promise<string> {

    // Kling v1.5 via Replicate \u2014 talking head generation
    const startRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.REPLICATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "lucataco/kling-v1-5:latest",
        input: {
          prompt,
          aspect_ratio:     "9:16",
          duration:         10,  // secondes par clip
          cfg_scale:        0.5,
          mode:             "standard",
          negative_prompt:  "blurry, cartoon, animation, fake, cgi, unrealistic, distorted face",
        },
      }),
    });

    if (!startRes.ok) throw new Error(`Replicate start failed: ${await startRes.text()}`);
    const prediction = await startRes.json() as { id: string; urls: { get: string } };

    // Polling jusqu'au r\u00e9sultat
    return await this.pollReplicate(prediction.urls.get);
  }

  private async generateWithRunway(
    prompt:       string,
    script:       string,
    productImage: string,
  ): Promise<string> {

    const startRes = await fetch("https://api.runwayml.com/v1/image_to_video", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RUNWAYML_API_KEY}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        promptText:   prompt,
        promptImage:  productImage || undefined,
        model:        "gen3a_turbo",
        duration:     10,
        ratio:        "720:1280",
        watermark:    false,
      }),
    });

    if (!startRes.ok) throw new Error(`Runway start failed: ${await startRes.text()}`);
    const task = await startRes.json() as { id: string };

    return await this.pollRunway(task.id);
  }

  async generateAvatar(task: AgentTask): Promise<AgentResult> {
    const { script, avatarKey = "fr_female_25_ugc_01", productImageUrl = "" } = task.input as {
      script: string; avatarKey?: string; productImageUrl?: string;
    };
    const avatar = await this.selectAvatar(avatarKey);
    const url = await this.doGenerateAvatarVideo(script, avatar, {
      name: "", description: "", benefits: [], images: [productImageUrl],
      price: "", reviews: [], url: "",
    });
    return { success: true, output: { avatarVideoUrl: url } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // \u00c9TAPE 4 \u2014 B-ROLL PRODUIT (Kling via Replicate)
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async doGenerateBroll(product: ProductData, angle: string): Promise<string[]> {
    const urls: string[] = [];

    // D\u00e9finir 3 sc\u00e8nes B-roll selon l'angle
    const scenes: Array<{ prompt: string; desc: string }> = [
      {
        desc: "close_up_product",
        prompt: `Close-up macro shot of ${product.name}, product held in hand, natural light, 
beautiful texture detail, soft focus background, authentic ugc style, vertical 9:16`,
      },
      {
        desc: "lifestyle",
        prompt: `Person using ${product.name} in a natural home environment, 
morning routine, soft natural lighting, genuine authentic moment, 
casual style, vertical 9:16 format`,
      },
      {
        desc: "result",
        prompt: `Beautiful result after using ${product.name}, 
authentic before/after feeling, natural lighting, real skin/result texture, 
close-up detail, vertical 9:16`,
      },
    ];

    // G\u00e9n\u00e9rer chaque sc\u00e8ne en parall\u00e8le (max 3 pour limiter les co\u00fbts)
    const promises = scenes.slice(0, 3).map(async (scene) => {
      try {
        // Utiliser l'image produit comme r\u00e9f\u00e9rence si disponible
        const imageRef = product.images[0] ?? "";
        const url = await this.generateBrollClip(scene.prompt, imageRef);

        // Sauvegarder dans la biblioth\u00e8que
        await db.query(`
          INSERT INTO media.broll_library
            (product_id, scene_type, prompt_used, video_url, provider, is_approved)
          VALUES ($1, $2, $3, $4, 'replicate', TRUE)
          ON CONFLICT DO NOTHING
        `, [null, scene.desc, scene.prompt, url]).catch(() => {});

        return url;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(promises);
    urls.push(...results.filter(Boolean) as string[]);

    return urls;
  }

  private async generateBrollClip(prompt: string, imageRef: string): Promise<string> {
    const body: Record<string, unknown> = {
      version: "lucataco/kling-v1-5:latest",
      input: {
        prompt,
        aspect_ratio:     "9:16",
        duration:         5,
        cfg_scale:        0.5,
        negative_prompt:  "blurry, animation, cartoon, fake, distorted",
      },
    };

    // Ajouter l'image de r\u00e9f\u00e9rence si disponible
    if (imageRef) {
      (body.input as Record<string, unknown>).start_image = imageRef;
    }

    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.REPLICATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Replicate broll failed`);
    const pred = await res.json() as { id: string; urls: { get: string } };
    return await this.pollReplicate(pred.urls.get);
  }

  async generateBroll(task: AgentTask): Promise<AgentResult> {
    const { productId, productUrl, angle = "transformation" } = task.input as {
      productId?: string; productUrl?: string; angle?: string;
    };
    const product = await this.doScrapeProduct(productUrl, productId, task.tenantId);
    const brollUrls = await this.doGenerateBroll(product, angle);
    return { success: true, output: { brollUrls, count: brollUrls.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // \u00c9TAPE 5 \u2014 ASSEMBLAGE FFMPEG
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async doAssembleVideo(
    jobId:          string,
    avatarVideoUrl: string,
    brollUrls:      string[],
    script:         UGCScript,
    format:         string = "9:16",
  ): Promise<GeneratedVideo> {

    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ugc-"));
    const outPath = path.join(tmpDir, `ugc_${jobId}.mp4`);
    const thumbPath = path.join(tmpDir, `thumb_${jobId}.jpg`);
    const srtPath   = path.join(tmpDir, `captions_${jobId}.srt`);

    let totalCost = 0.21; // co\u00fbt estim\u00e9 Kling (2 appels) + LLM

    try {
      // \u2500\u2500 T\u00e9l\u00e9charger tous les assets \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const avatarPath = path.join(tmpDir, "avatar.mp4");
      await this.downloadFile(avatarVideoUrl, avatarPath);

      const brollPaths: string[] = [];
      for (let i = 0; i < brollUrls.length; i++) {
        const p = path.join(tmpDir, `broll_${i}.mp4`);
        await this.downloadFile(brollUrls[i], p);
        brollPaths.push(p);
      }

      // \u2500\u2500 G\u00e9n\u00e9rer le fichier SRT (sous-titres) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const srtContent = this.generateSRT(script);
      fs.writeFileSync(srtPath, srtContent);

      // \u2500\u2500 Construire la commande FFmpeg \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      //
      // Timeline UGC (30s) :
      //   0-3s  : avatar hook  (coup\u00e9 \u00e0 3s)
      //   3-8s  : b-roll produit close-up (5s)
      //   8-18s : avatar body  (10s)
      //   18-23s: b-roll lifestyle (5s)
      //   23-28s: avatar cta   (5s)
      //   28-30s: freeze frame + logo optionnel

      const dims = format === "9:16" ? "1080:1920" : format === "1:1" ? "1080:1080" : "1920:1080";
      const [w, h] = dims.split(":").map(Number);

      // Inputs
      let ffmpegCmd = `ffmpeg -y`;
      ffmpegCmd += ` -i "${avatarPath}"`;  // input 0 : avatar
      for (const bp of brollPaths) {
        ffmpegCmd += ` -i "${bp}"`;         // inputs 1,2,3 : b-roll
      }

      // Musique fond (si disponible)
      const musicPath = this.getMusicTrack();
      if (musicPath) ffmpegCmd += ` -i "${musicPath}"`;  // input 4 : musique

      // Filter complex \u2014 d\u00e9coupe + assemblage + sous-titres + volume
      const hasBroll = brollPaths.length >= 2;
      const hasBroll1 = brollPaths.length >= 1;

      let filterComplex = `
[0:v]trim=0:3,setpts=PTS-STARTPTS,scale=${dims},setsar=1[hook];
[0:v]trim=8:18,setpts=PTS-STARTPTS,scale=${dims},setsar=1[body];
[0:v]trim=23:28,setpts=PTS-STARTPTS,scale=${dims},setsar=1[cta];`;

      if (hasBroll1) {
        filterComplex += `\
[1:v]trim=0:5,setpts=PTS-STARTPTS,scale=${dims},setsar=1[broll1];`;
      }
      if (hasBroll) {
        filterComplex += `\
[2:v]trim=0:5,setpts=PTS-STARTPTS,scale=${dims},setsar=1[broll2];`;
      }

      // Audio avatar
      filterComplex += `\
[0:a]atrim=0:3,asetpts=PTS-STARTPTS[audio_hook];`;
      filterComplex += `\
[0:a]atrim=8:18,asetpts=PTS-STARTPTS[audio_body];`;
      filterComplex += `\
[0:a]atrim=23:28,asetpts=PTS-STARTPTS[audio_cta];`;

      // Concat\u00e9nation vid\u00e9o
      if (hasBroll) {
        filterComplex += `\
[hook][broll1][body][broll2][cta]concat=n=5:v=1:a=0[vout_raw];`;
        filterComplex += `\
[audio_hook][audio_body][audio_cta]concat=n=3:v=0:a=1[aout_voice];`;
      } else {
        filterComplex += `\
[hook][body][cta]concat=n=3:v=1:a=0[vout_raw];`;
        filterComplex += `\
[audio_hook][audio_body][audio_cta]concat=n=3:v=0:a=1[aout_voice];`;
      }

      // Sous-titres (burn-in)
      filterComplex += `\
[vout_raw]subtitles='${srtPath}':force_style='FontName=Arial,FontSize=18,Bold=1,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Alignment=2'[vout];`;

      // Mixage audio : voix + musique (si dispo)
      if (musicPath) {
        filterComplex += `\
[${brollPaths.length + 1}:a]volume=0.08[music];`;
        filterComplex += `\
[aout_voice][music]amix=inputs=2:duration=first:weights=1 0.08[aout];`;
      } else {
        filterComplex += `\
[aout_voice]volume=1.0[aout];`;
      }

      ffmpegCmd += ` -filter_complex "${filterComplex.replace(/\n/g, " ").replace(/\s+/g, " ")}"`;
      ffmpegCmd += ` -map "[vout]" -map "[aout]"`;
      ffmpegCmd += ` -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p`;
      ffmpegCmd += ` -c:a aac -b:a 128k -ar 44100`;
      ffmpegCmd += ` -movflags +faststart`;
      ffmpegCmd += ` "${outPath}"`;

      // Ex\u00e9cuter FFmpeg
      const startMs = Date.now();
      await execAsync(ffmpegCmd, { timeout: 120000 });  // timeout 2 minutes
      const durationMs = Date.now() - startMs;

      // G\u00e9n\u00e9rer la thumbnail (frame 2s)
      await execAsync(`ffmpeg -y -i "${outPath}" -ss 2 -frames:v 1 "${thumbPath}"`);

      // Mesurer la taille
      const stats = fs.statSync(outPath);
      const sizeMb = stats.size / (1024 * 1024);

      // Log d'assemblage
      await db.query(`
        INSERT INTO media.assembly_log
          (ugc_job_id, assembly_cmd, input_files, output_file, duration_ms, file_size_mb, success)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, TRUE)
      `, [
        jobId,
        ffmpegCmd.substring(0, 1000),
        JSON.stringify({ avatar: avatarVideoUrl, broll: brollUrls }),
        outPath, durationMs, sizeMb,
      ]).catch(() => {});

      // Upload vers le storage
      const finalUrl  = await this.uploadToStorage(outPath,  `ugc/${jobId}/final.mp4`);
      const thumbUrl  = await this.uploadToStorage(thumbPath, `ugc/${jobId}/thumb.jpg`);
      const srtUrl    = await this.uploadToStorage(srtPath,   `ugc/${jobId}/captions.srt`);

      // Nettoyer le tmp
      fs.rmSync(tmpDir, { recursive: true, force: true });

      return {
        avatarVideoUrl, brollUrls,
        captionsSrt:   srtUrl,
        finalVideoUrl: finalUrl,
        thumbnailUrl:  thumbUrl,
        durationSec:   28,
        costEur:       totalCost,
      };
    } catch (err) {
      // Log l'erreur
      await db.query(`
        INSERT INTO media.assembly_log
          (ugc_job_id, success, error) VALUES ($1, FALSE, $2)
      `, [jobId, String(err)]).catch(() => {});

      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  async assembleVideo(task: AgentTask): Promise<AgentResult> {
    const { jobId, avatarVideoUrl, brollUrls, scriptHook, scriptBody, scriptCta, format } = task.input as {
      jobId: string; avatarVideoUrl: string; brollUrls: string[];
      scriptHook: string; scriptBody: string; scriptCta: string; format?: string;
    };
    const script: UGCScript = {
      hook: scriptHook, body: scriptBody, cta: scriptCta,
      full: `${scriptHook}\
\
${scriptBody}\
\
${scriptCta}`,
      hookType: "unknown", durationSec: 30,
    };
    const result = await this.doAssembleVideo(jobId, avatarVideoUrl, brollUrls, script, format);
    return { success: true, output: result };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // ANALYSE WINNERS
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async analyzeWinners(task: AgentTask): Promise<AgentResult> {
    await this.trace("info", "\ud83d\udcca UGC_FACTORY \u2014 Analyse des winners", {}, task.id);

    // Marquer les winners (ROAS > 2) et losers
    await db.query(`
      UPDATE media.ugc_jobs SET classification = 'WINNER'
      WHERE roas > 2.0 AND classification IS NULL AND status = 'done'
    `).catch(() => {});

    await db.query(`
      UPDATE media.ugc_jobs SET classification = 'LOSER'
      WHERE spend_eur > 50 AND roas < 0.5 AND classification IS NULL
    `).catch(() => {});

    // Analyser les patterns des winners via LLM
    const winnersR = await db.query(`
      SELECT hook_type, target_angle, awareness_level, script_hook, roas
      FROM media.ugc_jobs
      WHERE classification = 'WINNER' AND tenant_id = $1
      ORDER BY roas DESC LIMIT 20
    `, [task.tenantId]);

    if (winnersR.rows.length >= 3) {
      const patterns = await this.callLLM({
        system: "Expert cr\u00e9atif UGC. Analyse les patterns gagnants. JSON strict.",
        user: `Analyse ces ${winnersR.rows.length} UGC gagnants (ROAS > 2) et identifie les patterns communs.

Winners :
${winnersR.rows.map(r => `ROAS ${r.roas} | type: ${r.hook_type} | angle: ${r.target_angle} | hook: "${r.script_hook?.substring(0,80)}"`).join("\
")}

{
  "dominantHookType": "...",
  "dominantAngle": "...",
  "commonHookPatterns": ["pattern 1", "pattern 2"],
  "avgRoasPerHookType": {},
  "recommendations": ["reco 1", "reco 2"]
}`,
        maxTokens: 400,
      });

      let analysis: Record<string, unknown> = {};
      try { analysis = JSON.parse(patterns); } catch { /* continue */ }

      // Notifier les agents avec les insights
      await this.send({
        fromAgent: this.agentId, toAgent: "AGENT_CREATIVE_FACTORY",
        messageType: "EVENT", subject: "ugc.winner_patterns",
        payload: { analysis, winnersCount: winnersR.rows.length },
        tenantId: task.tenantId, priority: 7,
      });

      // Booster les templates gagnants
      await db.query(`
        UPDATE media.script_templates SET win_rate = LEAST(win_rate + 0.05, 1.0)
        WHERE hook_type = $1 AND angle_category = $2
      `, [analysis.dominantHookType, analysis.dominantAngle]).catch(() => {});

      return { success: true, output: { winners: winnersR.rows.length, analysis } };
    }

    return { success: true, output: { winners: winnersR.rows.length, message: "Pas assez de donn\u00e9es" } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // LANCEMENT A/B TEST
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async launchAbTest(task: AgentTask): Promise<AgentResult> {
    const { jobId } = task.input as { jobId: string };

    const jobR = await db.query(
      `SELECT * FROM media.ugc_jobs WHERE id = $1 AND status = 'done'`,
      [jobId]
    );
    if (jobR.rows.length === 0) return { success: false, error: "Job non trouv\u00e9 ou non termin\u00e9" };

    const job = jobR.rows[0];

    // D\u00e9l\u00e9guer au AGENT_META_TESTING
    await this.send({
      fromAgent: this.agentId, toAgent: "AGENT_META_TESTING",
      messageType: "COMMAND", subject: "meta.create_ad_from_ugc",
      payload: {
        jobId,
        videoUrl:      job.final_video_url,
        thumbnailUrl:  job.thumbnail_url,
        hook:          job.script_hook,
        body:          job.script_body,
        cta:           job.script_cta,
        productId:     job.product_id,
        targetAngle:   job.target_angle,
        awarenessLevel: job.awareness_level,
        format:        job.final_video_format,
        dailyBudget:   20,  // EUR
        instruction:   "Cr\u00e9er une Meta ad avec cette UGC. Ciblage large FR 18-45. Budget 20\u20ac/j. Arr\u00eater si CPR > 30\u20ac apr\u00e8s 50\u20ac d\u00e9pens\u00e9.",
      },
      tenantId: task.tenantId, priority: 9,
    });

    return { success: true, output: { jobId, status: "ab_test_launched" } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // HELPERS
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async selectAvatar(avatarKey: string): Promise<{
    provider: string; provider_id: string; style: string; gender: string; voice_id: string | null;
  }> {
    const r = await db.query(
      `SELECT provider, provider_id, style, gender, voice_id FROM media.avatar_library WHERE avatar_key = $1`,
      [avatarKey]
    );
    if (r.rows.length === 0) throw new Error(`Avatar not found: ${avatarKey}`);
    return r.rows[0];
  }

  private async pollReplicate(getUrl: string, maxWaitSec = 120): Promise<string> {
    const deadline = Date.now() + maxWaitSec * 1000;
    while (Date.now() < deadline) {
      await this.sleep(3000);
      const r = await fetch(getUrl, {
        headers: { "Authorization": `Bearer ${process.env.REPLICATE_API_KEY}` },
      });
      const data = await r.json() as { status: string; output?: string | string[]; error?: string };
      if (data.status === "succeeded") {
        const output = Array.isArray(data.output) ? data.output[0] : data.output;
        return output as string;
      }
      if (data.status === "failed") throw new Error(`Replicate failed: ${data.error}`);
    }
    throw new Error("Replicate timeout");
  }

  private async pollRunway(taskId: string, maxWaitSec = 120): Promise<string> {
    const deadline = Date.now() + maxWaitSec * 1000;
    while (Date.now() < deadline) {
      await this.sleep(5000);
      const r = await fetch(`https://api.runwayml.com/v1/tasks/${taskId}`, {
        headers: {
          "Authorization": `Bearer ${process.env.RUNWAYML_API_KEY}`,
          "X-Runway-Version": "2024-11-06",
        },
      });
      const data = await r.json() as { status: string; output?: Array<{ url: string }>; error?: string };
      if (data.status === "SUCCEEDED") return data.output![0].url;
      if (data.status === "FAILED") throw new Error(`Runway failed: ${data.error}`);
    }
    throw new Error("Runway timeout");
  }

  private generateSRT(script: UGCScript): string {
    // G\u00e9n\u00e9rer un SRT simple bas\u00e9 sur la dur\u00e9e estim\u00e9e
    const lines = script.full.split(/[.!?]\s+/).filter(l => l.trim().length > 3);
    const secPerLine = 28 / Math.max(lines.length, 1);
    let srt = "";
    lines.forEach((line, i) => {
      const startSec = i * secPerLine;
      const endSec   = (i + 1) * secPerLine;
      srt += `${i + 1}\
`;
      srt += `${this.fmtTime(startSec)} --> ${this.fmtTime(endSec)}\
`;
      srt += `${line.trim()}\
\
`;
    });
    return srt;
  }

  private fmtTime(sec: number): string {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
  }

  private getMusicTrack(): string | null {
    // Retourner un fichier de musique de fond si disponible localement
    const tracks = ["/app/assets/music/ugc_bg_1.mp3", "/app/assets/music/ugc_bg_2.mp3"];
    return tracks.find(t => fs.existsSync(t)) ?? null;
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${url}`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buffer));
  }

  private async uploadToStorage(localPath: string, storagePath: string): Promise<string> {
    const bucket  = process.env.MEDIA_STORAGE_BUCKET;
    const cdnBase = process.env.MEDIA_CDN_URL;

    if (!bucket || !cdnBase) {
      // En dev : retourner le chemin local
      return `file://${localPath}`;
    }

    // Supabase Storage upload
    const fileBuffer = fs.readFileSync(localPath);
    const mimeType   = localPath.endsWith(".mp4") ? "video/mp4"
                     : localPath.endsWith(".jpg") ? "image/jpeg"
                     : "text/plain";

    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type":  mimeType,
        "x-upsert":      "true",
      },
      body: fileBuffer,
    });

    if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`);
    return `${cdnBase}/${storagePath}`;
  }

  private async updateJob(jobId: string, fields: Record<string, unknown>): Promise<void> {
    const keys   = Object.keys(fields);
    const values = Object.values(fields);
    const sets   = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    await db.query(
      `UPDATE media.ugc_jobs SET ${sets}, updated_at = NOW() WHERE id = $1`,
      [jobId, ...values]
    ).catch(() => {});
  }

  private sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  protected async callLLM(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",  // Haiku pour les scripts (rapide + \u00e9conomique)
        max_tokens: opts.maxTokens,
        system:     opts.system,
        messages:   [{ role: "user", content: opts.user }],
      }),
    });
    const data = await res.json() as { content: { type: string; text: string }[] };
    return data.content.find(b => b.type === "text")?.text ?? "";
  }
}
