/**
 * AEGIS Logo Generator Service
 * Génération de logos IA via Ideogram / fallback DALL-E 3
 */

export interface LogoConfig {
  brandName:      string;
  industry:       string;
  style:          string;
  iconPreference: string;
  count:          number;
}

export interface GeneratedLogo {
  id:             string;
  url:            string;
  brandName:      string;
  industry:       string;
  style:          string;
  iconPreference: string;
  prompt:         string;
  createdAt:      string;
}

export class LogoGeneratorService {
  private ideogramEndpoint = 'https://api.ideogram.ai/generate';

  generateLogoPrompt(brandName: string, industry: string, style: string, iconPref: string): string {
    const industryMap: Record<string, string> = {
      beauty: 'beauty, cosmetics, skincare, elegant, feminine',
      tech: 'technology, modern, digital, innovative, sleek',
      health: 'health, wellness, medical, clean, trustworthy',
      food: 'food, culinary, fresh, appetizing, organic',
      fashion: 'fashion, style, trendy, luxury, boutique',
      home: 'home, interior, cozy, lifestyle, comfort',
      fitness: 'fitness, sports, energy, dynamic, powerful',
      pets: 'pets, animals, friendly, playful, caring',
      kids: 'children, playful, colorful, fun, safe',
      eco: 'eco-friendly, sustainable, nature, green, organic'
    };
    const styleMap: Record<string, string> = {
      modern: 'modern, minimalist, clean lines, contemporary, sleek',
      playful: 'playful, fun, colorful, friendly, approachable',
      luxury: 'luxury, premium, elegant, sophisticated, high-end',
      vintage: 'vintage, retro, classic, timeless, nostalgic',
      bold: 'bold, strong, impactful, dynamic, powerful',
      organic: 'organic, natural, handcrafted, artisanal, earthy'
    };
    const iconMap: Record<string, string> = {
      abstract: 'abstract geometric shape, symbolic icon',
      literal: 'literal representation, recognizable icon',
      text_only: 'typography only, wordmark, lettermark',
      emblem: 'emblem style, badge, crest'
    };

    return `Professional logo design for "${brandName}", a ${industryMap[industry] || industryMap.tech} brand. Style: ${styleMap[style] || styleMap.modern}. Icon type: ${iconMap[iconPref] || iconMap.abstract}. High quality vector logo, clean background, scalable, memorable. White background.`;
  }

  async generateWithIdeogram(prompt: string, count = 4): Promise<string[]> {
    const resp = await fetch(this.ideogramEndpoint, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.IDEOGRAM_API_KEY || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_request: {
          prompt, model: 'V_2', magic_prompt_option: 'AUTO',
          style_type: 'DESIGN', aspect_ratio: 'ASPECT_1_1', num_images: count
        }
      })
    });
    const data = await resp.json();
    return data.data?.map((img: any) => img.url) || [];
  }

  async generateBatch(config: LogoConfig): Promise<GeneratedLogo[]> {
    const { brandName, industry, style, iconPreference, count = 8 } = config;
    const prompt = this.generateLogoPrompt(brandName, industry, style, iconPreference);
    let urls: string[] = [];

    try {
      const b1 = await this.generateWithIdeogram(prompt, 4);
      const b2 = await this.generateWithIdeogram(prompt, 4);
      urls = [...b1, ...b2].slice(0, count);
    } catch (e) {
      console.error('Logo generation failed:', (e as Error).message);
    }

    return urls.map((url, i) => ({
      id: `logo_${Date.now()}_${i}`, url, brandName, industry, style, iconPreference, prompt,
      createdAt: new Date().toISOString()
    }));
  }
}

export default LogoGeneratorService;
