// ✅ BON: Types explicites, JSDoc, error handling
/**
 * Calcule le Hunter Score d'un produit
 * @param product - Données produit scrappées
 * @returns Score 0-100 avec détail des critères
 * @throws ProductValidationError si données incomplètes
 */
async function calculateHunterScore(
  product: ScrapedProduct
): Promise<HunterScoreResult> {
  try {
    const margin = calculateMargin(product.price, product.cost);
    const demand = await analyzeDemand(product.category);
    const competition = await analyzeCompetition(product.keywords);
    
    return {
      total: Math.round((margin * 0.4 + demand * 0.35 + competition * 0.25)),
      breakdown: { margin, demand, competition },
      confidence: 0.85
    };
  } catch (error) {
    logger.error('Hunter score calculation failed', { product, error });
    throw new ProductValidationError('Unable to calculate score', { cause: error });
  }
}

// ❌ MAUVAIS: Types implicites, pas de doc, catch silencieux
function calcScore(p: any) {
  try {
    return p.price * 0.5;
  } catch (e) {
    return 0;
  }
}