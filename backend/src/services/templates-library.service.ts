/**
 * AEGIS Templates Library Service
 * Bibliothèque de templates publicitaires avec performance tracking
 */

export interface TemplateData {
  id:               string;
  name:             string;
  category:         string;
  angle:            string;
  format:           string;
  thumbnail:        string;
  preview:          string;
  tags:             string[];
  performance:      { avg_ctr: number; avg_roas: number };
  default_headline: string;
  default_cta:      string;
  layers:           any[];
  created_at?:      string;
}

export const TEMPLATE_CATEGORIES: Record<string, { name: string; icon: string }> = {
  beauty:  { name: 'Beaute & Cosmetiques', icon: '💄' },
  health:  { name: 'Sante & Bien-etre', icon: '💚' },
  tech:    { name: 'Tech & Gadgets', icon: '📱' },
  fashion: { name: 'Mode & Accessoires', icon: '👗' },
  home:    { name: 'Maison & Deco', icon: '🏠' },
  food:    { name: 'Alimentation', icon: '🍽️' },
  fitness: { name: 'Fitness & Sport', icon: '💪' },
  pets:    { name: 'Animaux', icon: '🐾' },
  kids:    { name: 'Enfants & Bebes', icon: '👶' }
};

export const TEMPLATE_ANGLES: Record<string, { name: string; icon: string; color: string }> = {
  transformation: { name: 'Transformation', icon: '🔄', color: '#6366f1' },
  social_proof:   { name: 'Social Proof',   icon: '⭐', color: '#f59e0b' },
  douleur:        { name: 'Douleur',        icon: '💢', color: '#ef4444' },
  curiosite:      { name: 'Curiosite',      icon: '🔍', color: '#8b5cf6' },
  urgence:        { name: 'Urgence',        icon: '⏰', color: '#ec4899' },
  autorite:       { name: 'Autorite',       icon: '🏆', color: '#10b981' },
  comparaison:    { name: 'Comparaison',    icon: '⚖️', color: '#06b6d4' }
};

export const SAMPLE_TEMPLATES: TemplateData[] = [
  {
    id: 'tpl_001', name: 'Transformation Before/After', category: 'beauty',
    angle: 'transformation', format: '1080x1080',
    thumbnail: '/templates/thumbnails/tpl_001.jpg', preview: '/templates/previews/tpl_001.jpg',
    tags: ['before_after', 'results', 'skincare'], performance: { avg_ctr: 2.4, avg_roas: 3.2 },
    default_headline: 'Avant / Apres', default_cta: 'Voir les resultats →', layers: []
  },
  {
    id: 'tpl_002', name: 'Social Proof Stars', category: 'health',
    angle: 'social_proof', format: '1080x1080',
    thumbnail: '/templates/thumbnails/tpl_002.jpg', preview: '/templates/previews/tpl_002.jpg',
    tags: ['reviews', 'stars', 'testimonial'], performance: { avg_ctr: 1.8, avg_roas: 2.8 },
    default_headline: '+10 000 clients satisfaits', default_cta: 'Rejoindre →', layers: []
  },
  {
    id: 'tpl_003', name: 'Urgence Countdown', category: 'tech',
    angle: 'urgence', format: '1080x1920',
    thumbnail: '/templates/thumbnails/tpl_003.jpg', preview: '/templates/previews/tpl_003.jpg',
    tags: ['sale', 'countdown', 'fomo'], performance: { avg_ctr: 3.1, avg_roas: 2.5 },
    default_headline: '⚡ -50% Aujourd\'hui seulement', default_cta: 'Profiter de l\'offre →', layers: []
  }
];

export class TemplateLibraryService {
  private templates: TemplateData[] = SAMPLE_TEMPLATES;

  getAll(filters: { category?: string; angle?: string; format?: string; search?: string; sortBy?: string } = {}): TemplateData[] {
    let filtered = [...this.templates];
    if (filters.category) filtered = filtered.filter(t => t.category === filters.category);
    if (filters.angle) filtered = filtered.filter(t => t.angle === filters.angle);
    if (filters.format) filtered = filtered.filter(t => t.format === filters.format);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      filtered = filtered.filter(t => t.name.toLowerCase().includes(s) || t.tags.some(tag => tag.includes(s)));
    }
    if (filters.sortBy === 'ctr') filtered.sort((a, b) => b.performance.avg_ctr - a.performance.avg_ctr);
    if (filters.sortBy === 'roas') filtered.sort((a, b) => b.performance.avg_roas - a.performance.avg_roas);
    return filtered;
  }

  getById(id: string): TemplateData | undefined {
    return this.templates.find(t => t.id === id);
  }
}

export default TemplateLibraryService;
