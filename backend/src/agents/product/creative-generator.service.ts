/**
 * AEGIS Creative Generator Service
 * Génération de visuels publicitaires IA via Replicate SDXL + Remove.bg
 */

export interface CreativeConfig {
  styles:  string[];
  angles:  string[];
  formats: string[];
  count:   number;
}

export interface GeneratedCreative {
  id:              string;
  url:             string;
  angle:           string;
  style:           string;
  format:          string;
  prompt:          string;
  hookText:        string;
  cta:             string;
  status:          string;
  createdAt:       string;
}

export class CreativeGeneratorService {
  private replicateEndpoint = 'https://api.replicate.com/v1/predictions';
  private removeBgEndpoint  = 'https://api.remove.bg/v1.0/removebg';

  async generateImage(prompt: string, negativePrompt = ''): Promise<string> {
    const resp = await fetch(this.replicateEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
        input: {
          prompt,
          negative_prompt: negativePrompt || 'blurry, low quality, distorted, ugly, bad anatomy',
          width: 1024, height: 1024, num_outputs: 1,
          scheduler: 'K_EULER', num_inference_steps: 30, guidance_scale: 7.5
        }
      })
    });
    const prediction = await resp.json();
    return this.pollForResult(prediction.id);
  }

  private async pollForResult(predictionId: string): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const resp = await fetch(`${this.replicateEndpoint}/${predictionId}`, {
        headers: { 'Authorization': `Token ${process.env.REPLICATE_API_KEY}` }
      });
      const result = await resp.json();
      if (result.status === 'succeeded') return result.output[0];
      if (result.status === 'failed') throw new Error('Image generation failed');
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Timeout');
  }

  generatePrompt(productName: string, angle: string, style: string): string {
    const prompts: Record<string, Record<string, string>> = {
      transformation: {
        minimal: `Clean minimal product photography of ${productName}, before and after transformation, white background, professional`,
        lifestyle: `Lifestyle photo of ${productName} showing transformation results, happy person, natural lighting, Instagram aesthetic`,
        ugc: `UGC style photo of ${productName}, authentic selfie showing results, phone camera, relatable`,
        premium: `Luxury product photography of ${productName}, dramatic transformation, dark elegant background, golden accents`,
        bold: `Bold dynamic product shot of ${productName}, vivid colors, transformation concept, impactful`,
        organic: `Natural organic product photo of ${productName}, eco-friendly setting, transformation concept`
      },
      social_proof: {
        minimal: `Product flat lay of ${productName} with 5-star rating, review quotes, white background, trust badges`,
        lifestyle: `Happy customer holding ${productName}, genuine smile, natural home environment, testimonial`,
        ugc: `Real customer unboxing ${productName}, excited reaction, authentic UGC`,
        premium: `Influencer photo with ${productName}, aspirational lifestyle, luxury setting`,
        bold: `Bold testimonial design for ${productName}, vivid colors, star ratings`,
        organic: `Natural testimonial scene with ${productName}, authentic setting`
      },
      douleur: {
        minimal: `Problem-solution photo of ${productName}, split image pain vs relief, clean design`,
        lifestyle: `Person experiencing frustration without ${productName}, then relief after, emotional`,
        ugc: `Authentic struggle before finding ${productName}, raw emotional UGC content`,
        premium: `Dramatic before/after of ${productName} solving a problem, cinematic`,
        bold: `Bold problem-solution visual for ${productName}, impactful colors`,
        organic: `Natural problem-solution photo with ${productName}, earthy tones`
      },
      curiosite: {
        minimal: `Mysterious product reveal of ${productName}, partially hidden, intriguing, clean`,
        lifestyle: `Candid discovery moment with ${productName}, surprised expression, storytelling`,
        ugc: `POV content with ${productName}, "wait for it" moment, trending format`,
        premium: `Cinematic product tease of ${productName}, dramatic lighting, anticipation`,
        bold: `Bold teaser visual for ${productName}, attention-grabbing, mysterious`,
        organic: `Natural discovery moment with ${productName}, organic setting`
      },
      urgence: {
        minimal: `Limited time offer product shot of ${productName}, countdown overlay, bold colors`,
        lifestyle: `Last chance to grab ${productName}, person rushing, FOMO inducing`,
        ugc: `Excited person showing ${productName} haul, "selling out fast" energy`,
        premium: `Exclusive drop aesthetic for ${productName}, luxury scarcity, VIP access`,
        bold: `Bold urgency visual for ${productName}, countdown, vivid reds`,
        organic: `Natural urgency scene with ${productName}, limited edition feeling`
      }
    };
    return prompts[angle]?.[style] || prompts.transformation?.minimal || `Product photo of ${productName}`;
  }

  generateHookText(productName: string, angle: string): string {
    const hooks: Record<string, string[]> = {
      transformation: [`POV: tu decouvres ${productName}`, `Avant/Apres avec ${productName}`, 'Ma transformation en 30 jours', 'Le resultat m\'a choque...'],
      social_proof: ['+10 000 clients satisfaits', '"Le meilleur achat de ma vie"', 'Pourquoi tout le monde en parle', '⭐⭐⭐⭐⭐ Avis verifies'],
      douleur: ['Marre de ce probleme ?', 'J\'ai enfin trouve LA solution', 'Stop a la galere', 'Ce que personne ne te dit...'],
      curiosite: ['Ce produit viral qui affole TikTok', 'Le secret que les pros cachent', 'Attends de voir ca...', 'Tu ne devineras jamais...'],
      urgence: ['⚡ Stock limite', '🔥 -50% aujourd\'hui seulement', 'Dernieres heures pour en profiter', '⏰ Plus que 24h']
    };
    const arr = hooks[angle] || hooks.transformation;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  generateCTA(angle: string): string {
    const ctas: Record<string, string> = {
      transformation: 'Voir les resultats →',
      social_proof: 'Rejoindre +10K clients →',
      douleur: 'Decouvrir la solution →',
      curiosite: 'En savoir plus →',
      urgence: 'Profiter de l\'offre →'
    };
    return ctas[angle] || 'Decouvrir →';
  }

  async generateBatch(productName: string, config: CreativeConfig): Promise<GeneratedCreative[]> {
    const { styles, angles, formats, count } = config;
    const creatives: GeneratedCreative[] = [];
    const perCombo = Math.ceil(count / (styles.length * angles.length));

    for (const angle of angles) {
      for (const style of styles) {
        for (let i = 0; i < perCombo && creatives.length < count; i++) {
          const prompt = this.generatePrompt(productName, angle, style);
          try {
            const url = await this.generateImage(prompt);
            creatives.push({
              id: `crea_${Date.now()}_${creatives.length}`,
              url, angle, style, prompt,
              format: formats[i % formats.length] || '1080x1080',
              hookText: this.generateHookText(productName, angle),
              cta: this.generateCTA(angle),
              status: 'generated',
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            console.error(`Creative gen failed: ${(e as Error).message}`);
          }
        }
      }
    }
    return creatives;
  }
}

export default CreativeGeneratorService;
