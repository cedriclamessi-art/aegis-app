/**
 * AEGIS Branding Generator — Identité de Marque IA
 * ═══════════════════════════════════════════════════
 *
 * Génère une identité de marque unique pour chaque boutique :
 *   - Nom de marque (IA ou fallback)
 *   - Palette de couleurs par catégorie
 *   - Font pairings (heading + body)
 *   - Logo SVG + Favicon
 *   - Slogan accrocheur
 *   - Trust badges & social proof
 *
 * Utilise Anthropic Claude (SDK natif AEGIS) pour la génération IA.
 * Fallback complet si API indisponible.
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Types ────────────────────────────────────────────────────────────────

export interface BrandingResult {
  name:          string;
  slogan:        string;
  category:      string;
  colors:        ColorPalette;
  fonts:         FontPairing;
  logo:          LogoData;
  socialProof:   SocialProof;
  trustBadges:   TrustBadge[];
}

export interface ColorPalette {
  primary:      string;
  secondary:    string;
  accent:       string;
  background:   string;
  text:         string;
  success:      string;
  primaryLight: string;
  primaryDark:  string;
  gradient:     string;
}

export interface FontPairing {
  heading:        string;
  body:           string;
  style:          string;
  googleFontsUrl: string;
}

export interface LogoData {
  text:     string;
  initials: string;
  style:    'text' | 'icon' | 'combined';
  svg:      string;
  favicon:  string;
}

export interface SocialProof {
  reviewCount:    number;
  rating:         number;
  customerCount:  string;
}

export interface TrustBadge {
  icon: string;
  text: string;
}

export interface ProductData {
  title:        string;
  description?: string;
  reviewCount?: number;
  rating?:      number;
  price?:       number;
  niche?:       string;
}

// ── Branding Generator ──────────────────────────────────────────────────

export class BrandingGenerator {
  private anthropic: Anthropic | null;

  // Palettes de couleurs prédéfinies par catégorie
  private colorPalettes: Record<string, Omit<ColorPalette, 'primaryLight' | 'primaryDark' | 'gradient'>> = {
    tech: {
      primary: '#6366F1', secondary: '#8B5CF6', accent: '#06B6D4',
      background: '#0F172A', text: '#F8FAFC', success: '#10B981'
    },
    beauty: {
      primary: '#EC4899', secondary: '#F472B6', accent: '#A855F7',
      background: '#FDF2F8', text: '#1F2937', success: '#10B981'
    },
    health: {
      primary: '#10B981', secondary: '#34D399', accent: '#06B6D4',
      background: '#ECFDF5', text: '#1F2937', success: '#10B981'
    },
    home: {
      primary: '#F59E0B', secondary: '#FBBF24', accent: '#EF4444',
      background: '#FFFBEB', text: '#1F2937', success: '#10B981'
    },
    fashion: {
      primary: '#1F2937', secondary: '#374151', accent: '#EF4444',
      background: '#FFFFFF', text: '#1F2937', success: '#10B981'
    },
    sport: {
      primary: '#EF4444', secondary: '#F97316', accent: '#FBBF24',
      background: '#FEF2F2', text: '#1F2937', success: '#10B981'
    },
    pet: {
      primary: '#F59E0B', secondary: '#34D399', accent: '#3B82F6',
      background: '#FFFBEB', text: '#1F2937', success: '#10B981'
    },
    default: {
      primary: '#3B82F6', secondary: '#60A5FA', accent: '#F59E0B',
      background: '#FFFFFF', text: '#1F2937', success: '#10B981'
    }
  };

  // Font pairings par style
  private fontPairings = [
    { heading: 'Poppins',           body: 'Inter',      style: 'modern'   },
    { heading: 'Playfair Display',  body: 'Lato',       style: 'elegant'  },
    { heading: 'Montserrat',        body: 'Open Sans',  style: 'clean'    },
    { heading: 'Oswald',            body: 'Roboto',     style: 'bold'     },
    { heading: 'Raleway',           body: 'Nunito',     style: 'friendly' },
    { heading: 'DM Sans',           body: 'DM Sans',    style: 'minimal'  },
    { heading: 'Space Grotesk',     body: 'Inter',      style: 'techy'    },
    { heading: 'Cormorant Garamond', body: 'Quicksand', style: 'luxury'   },
  ];

  constructor() {
    this.anthropic = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  /**
   * Génère le branding complet pour une boutique
   */
  async generate(productData: ProductData, storeName?: string): Promise<BrandingResult> {
    console.log(`  → Génération du branding pour: ${storeName || 'auto'}`);

    const category = this.detectCategory(productData);
    console.log(`    Catégorie détectée: ${category}`);

    const brandName = storeName || await this.generateBrandName(productData);
    const colors    = this.generateColorPalette(category);
    const fonts     = this.selectFonts(category);
    const logo      = this.generateLogo(brandName, colors);
    const slogan    = await this.generateSlogan(productData, brandName);

    const branding: BrandingResult = {
      name: brandName,
      slogan,
      category,
      colors,
      fonts,
      logo,
      socialProof: {
        reviewCount:   productData.reviewCount || 2847,
        rating:        productData.rating || 4.8,
        customerCount: '10,000+'
      },
      trustBadges: [
        { icon: '🚚', text: 'Livraison gratuite' },
        { icon: '🔄', text: 'Retour 30 jours' },
        { icon: '🔒', text: 'Paiement sécurisé' },
        { icon: '💬', text: 'Support 24/7' }
      ]
    };

    console.log(`  ✓ Branding généré: ${brandName} (${category})`);
    return branding;
  }

  /**
   * Détecte la catégorie du produit
   */
  detectCategory(productData: ProductData): string {
    const text = `${productData.title} ${productData.description || ''} ${productData.niche || ''}`.toLowerCase();

    const categories: Record<string, string[]> = {
      tech:    ['phone', 'gadget', 'electronic', 'led', 'projector', 'speaker', 'charger', 'cable', 'smart', 'wireless', 'bluetooth', 'usb', 'laptop', 'camera'],
      beauty:  ['beauty', 'skin', 'makeup', 'cosmetic', 'face', 'cream', 'serum', 'hair', 'nail', 'lash', 'lip', 'glow', 'anti-age'],
      health:  ['health', 'posture', 'massage', 'fitness', 'yoga', 'exercise', 'pain', 'relief', 'corrector', 'medical', 'therapy', 'sleep', 'wellness'],
      home:    ['home', 'kitchen', 'garden', 'decor', 'furniture', 'lamp', 'organizer', 'storage', 'cleaning', 'bathroom'],
      fashion: ['fashion', 'clothing', 'dress', 'shirt', 'pants', 'shoes', 'bag', 'watch', 'jewelry', 'accessory', 'sunglasses'],
      sport:   ['sport', 'gym', 'running', 'cycling', 'outdoor', 'hiking', 'swimming', 'training'],
      pet:     ['pet', 'dog', 'cat', 'animal', 'puppy', 'kitten'],
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => text.includes(kw))) return category;
    }
    return 'default';
  }

  /**
   * Génère un nom de marque avec Claude
   */
  async generateBrandName(productData: ProductData): Promise<string> {
    if (this.anthropic) {
      try {
        const msg = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 30,
          messages: [{
            role: 'user',
            content: `Génère UN nom de marque court (1-2 mots) pour ce produit: ${productData.title}.\nLe nom doit être moderne, mémorable et facile à prononcer.\nRéponds UNIQUEMENT avec le nom, sans explication.`
          }]
        });
        const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
        if (text && text.length <= 20) return text;
      } catch (e) {
        console.log('    ⚠️ Génération nom IA échouée, fallback local');
      }
    }
    return this.generateRandomBrandName();
  }

  /**
   * Nom de marque aléatoire (fallback)
   */
  private generateRandomBrandName(): string {
    const prefixes = ['Nova', 'Zen', 'Luxe', 'Prime', 'Elite', 'Vibe', 'Glow', 'Pure', 'Swift', 'Aura', 'Kova', 'Nex', 'Velo', 'Zuri'];
    const suffixes = ['Store', 'Shop', 'Hub', 'Lab', 'Co', 'Box', 'Zone', 'Plus', 'Pro', 'Max'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix}${suffix}`;
  }

  /**
   * Palette de couleurs avec variations
   */
  generateColorPalette(category: string): ColorPalette {
    const base = this.colorPalettes[category] || this.colorPalettes.default;
    return {
      ...base,
      primaryLight: this.lightenColor(base.primary, 20),
      primaryDark:  this.darkenColor(base.primary, 20),
      gradient:     `linear-gradient(135deg, ${base.primary} 0%, ${base.secondary} 100%)`
    };
  }

  /**
   * Sélectionne les fonts
   */
  selectFonts(category: string): FontPairing {
    const styleMap: Record<string, string> = {
      tech: 'techy', beauty: 'elegant', health: 'clean',
      home: 'friendly', fashion: 'minimal', sport: 'bold',
      pet: 'friendly', default: 'modern'
    };
    const targetStyle = styleMap[category] || 'modern';
    const fp = this.fontPairings.find(f => f.style === targetStyle) || this.fontPairings[0];
    return {
      heading: fp.heading,
      body: fp.body,
      style: fp.style,
      googleFontsUrl: `https://fonts.googleapis.com/css2?family=${fp.heading.replace(/ /g, '+')}:wght@400;600;700&family=${fp.body.replace(/ /g, '+')}:wght@400;500;600&display=swap`
    };
  }

  /**
   * Génère le logo (texte SVG + favicon)
   */
  generateLogo(brandName: string, colors: ColorPalette): LogoData {
    const initials = brandName
      .split(/(?=[A-Z])/)
      .map(w => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    return {
      text: brandName,
      initials,
      style: 'text',
      svg: `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="${colors.primary}"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui" font-weight="bold" font-size="16">${initials}</text></svg>`,
      favicon: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="6" fill="${colors.primary}"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="white" font-family="system-ui" font-weight="bold" font-size="14">${initials}</text></svg>`
    };
  }

  /**
   * Génère un slogan avec Claude
   */
  async generateSlogan(productData: ProductData, brandName: string): Promise<string> {
    if (this.anthropic) {
      try {
        const msg = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 40,
          messages: [{
            role: 'user',
            content: `Génère UN slogan court (max 6 mots) pour la marque "${brandName}" qui vend: ${productData.title}.\nLe slogan doit être accrocheur et inspirer confiance.\nRéponds UNIQUEMENT avec le slogan, sans guillemets.`
          }]
        });
        const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
        if (text) return text;
      } catch (e) {
        console.log('    ⚠️ Génération slogan IA échouée');
      }
    }
    const slogans = [
      'Votre satisfaction, notre priorité',
      'La qualité à portée de main',
      'Transformez votre quotidien',
      'L\'excellence accessible à tous',
      'Innovez votre vie'
    ];
    return slogans[Math.floor(Math.random() * slogans.length)];
  }

  // ── Utilitaires couleurs ─────────────────────────────────────

  private lightenColor(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, Math.max(0, (num >> 16) + amt));
    const G = Math.min(255, Math.max(0, ((num >> 8) & 0xFF) + amt));
    const B = Math.min(255, Math.max(0, (num & 0xFF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  private darkenColor(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0xFF) - amt);
    const B = Math.max(0, (num & 0xFF) - amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }
}

export default BrandingGenerator;
