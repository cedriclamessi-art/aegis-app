/**
 * Automated Review System — Creative / Store / Campaign quality checks
 * =====================================================================
 * Sources: OneRedOak Workflows, Claude Code Showcase
 *
 * 3 review types:
 *
 * 1. Creative Review:
 *    - Format (16:9, 1:1, 9:16)
 *    - Text overlay ≤ 20% (Facebook rule)
 *    - No banned claims (cure, guarantee, miracle)
 *    - CTA present and clear
 *    - Hook in first 3 seconds (video)
 *    - No competitor mentions
 *    - Brand consistency
 *
 * 2. Store Review:
 *    - ≥ 8 sections (hero, benefits, testimonials, FAQ, etc.)
 *    - Mobile responsive
 *    - Page speed ≤ 3s
 *    - Tracking pixel installed
 *    - Prices displayed correctly
 *    - RGPD compliant (cookie banner, privacy policy)
 *    - Legal pages (CGV, mentions légales)
 *    - SSL certificate
 *
 * 3. Campaign Review:
 *    - ROAS ≥ 2.0
 *    - CPA ≤ target
 *    - CTR ≥ 1.5%
 *    - Budget within limits
 *    - Creative fatigue check
 *    - Frequency ≤ 3.0
 *    - Audience overlap check
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ReviewType = 'creative' | 'store' | 'campaign';
export type ReviewSeverity = 'pass' | 'warning' | 'fail' | 'critical';

export interface ReviewCheck {
  name:       string;
  category:   string;
  passed:     boolean;
  severity:   ReviewSeverity;
  message:    string;
  suggestion?: string;
  details?:   unknown;
}

export interface ReviewResult {
  type:         ReviewType;
  shopId:       string;
  targetId:     string;     // Creative ID, Store URL, Campaign ID
  passed:       boolean;
  score:        number;     // 0-100
  severity:     ReviewSeverity;
  checks:       ReviewCheck[];
  summary:      string;
  suggestions:  string[];
  reviewedAt:   Date;
}

// ── Banned Words Lists ────────────────────────────────────────────────────

const BANNED_CLAIMS_FR = [
  'miracle', 'guérir', 'guérit', 'garanti', 'garantie', '100%',
  'sans risque', 'prouvé scientifiquement', 'certifié', 'approuvé',
  'médecin', 'docteur', 'clinique', 'pharmaceutique', 'médicament',
  'perte de poids garantie', 'résultat immédiat', 'avant/après',
  'secret', 'exclusif', 'révolutionnaire', 'unique au monde',
];

const BANNED_CLAIMS_EN = [
  'miracle', 'cure', 'cures', 'guaranteed', 'guarantee', '100%',
  'risk-free', 'scientifically proven', 'certified', 'approved',
  'doctor', 'clinical', 'pharmaceutical', 'drug', 'medication',
  'guaranteed weight loss', 'instant results', 'before/after',
  'secret', 'exclusive', 'revolutionary', 'one of a kind',
];

const REQUIRED_STORE_SECTIONS = [
  'hero', 'benefits', 'features', 'testimonials', 'faq',
  'guarantee', 'cta', 'footer',
];

const REQUIRED_LEGAL_PAGES = [
  'privacy', 'terms', 'refund', 'contact',
];

// ── Review Engine ─────────────────────────────────────────────────────────

class ReviewEngine {

  // ── Creative Review ──────────────────────────────────────────────────

  reviewCreative(data: {
    shopId:         string;
    creativeId:     string;
    format?:        string;        // '16:9', '1:1', '9:16'
    textOverlay?:   number;        // Percentage of text on image (0-100)
    copy?:          string;        // Ad copy text
    headline?:      string;
    cta?:           string;
    hookTiming?:    number;        // Seconds to hook in video
    isVideo?:       boolean;
    competitorMentions?: string[];
    brandColors?:   boolean;
    language?:      'fr' | 'en';
  }): ReviewResult {
    const checks: ReviewCheck[] = [];
    const suggestions: string[] = [];

    // 1. Format check
    const validFormats = ['16:9', '1:1', '9:16', '4:5'];
    checks.push({
      name: 'format',
      category: 'technical',
      passed: !data.format || validFormats.includes(data.format),
      severity: data.format && !validFormats.includes(data.format) ? 'warning' : 'pass',
      message: data.format ? `Format: ${data.format}` : 'No format specified',
      suggestion: 'Use 1:1 for feed, 9:16 for stories/reels, 16:9 for video ads',
    });

    // 2. Text overlay ≤ 20% (Facebook/Meta rule)
    if (data.textOverlay !== undefined) {
      const textOk = data.textOverlay <= 20;
      checks.push({
        name: 'text_overlay',
        category: 'compliance',
        passed: textOk,
        severity: textOk ? 'pass' : 'fail',
        message: `Text overlay: ${data.textOverlay}% ${textOk ? '≤' : '>'} 20%`,
        suggestion: textOk ? undefined : 'Reduce text to ≤20% — Meta reduces reach for high-text ads',
      });
      if (!textOk) suggestions.push('Reduce text overlay to under 20%');
    }

    // 3. Banned claims check
    if (data.copy) {
      const bannedList = data.language === 'en' ? BANNED_CLAIMS_EN : BANNED_CLAIMS_FR;
      const copyLower = data.copy.toLowerCase();
      const foundBanned = bannedList.filter(claim => copyLower.includes(claim.toLowerCase()));

      checks.push({
        name: 'banned_claims',
        category: 'compliance',
        passed: foundBanned.length === 0,
        severity: foundBanned.length > 0 ? 'critical' : 'pass',
        message: foundBanned.length > 0
          ? `Banned claims found: ${foundBanned.join(', ')}`
          : 'No banned claims detected',
        suggestion: foundBanned.length > 0
          ? 'Remove banned claims to avoid ad rejection and account suspension'
          : undefined,
        details: { foundBanned },
      });
      if (foundBanned.length > 0) {
        suggestions.push(`Remove banned claims: ${foundBanned.join(', ')}`);
      }
    }

    // 4. CTA present
    checks.push({
      name: 'cta_present',
      category: 'effectiveness',
      passed: !!data.cta,
      severity: data.cta ? 'pass' : 'warning',
      message: data.cta ? `CTA: "${data.cta}"` : 'No CTA specified',
      suggestion: data.cta ? undefined : 'Add a clear CTA (Shop Now, Learn More, Get Yours)',
    });
    if (!data.cta) suggestions.push('Add a clear call-to-action');

    // 5. Hook timing (video)
    if (data.isVideo && data.hookTiming !== undefined) {
      const hookOk = data.hookTiming <= 3;
      checks.push({
        name: 'hook_timing',
        category: 'effectiveness',
        passed: hookOk,
        severity: hookOk ? 'pass' : 'warning',
        message: `Hook at ${data.hookTiming}s ${hookOk ? '≤' : '>'} 3s target`,
        suggestion: hookOk ? undefined : 'Move the hook to the first 3 seconds — 65% of viewers leave after 3s',
      });
      if (!hookOk) suggestions.push('Move the hook to the first 3 seconds');
    }

    // 6. Competitor mentions
    if (data.competitorMentions && data.competitorMentions.length > 0) {
      checks.push({
        name: 'competitor_mentions',
        category: 'compliance',
        passed: false,
        severity: 'fail',
        message: `Competitor mentions: ${data.competitorMentions.join(', ')}`,
        suggestion: 'Remove competitor mentions — violates most ad platform policies',
      });
      suggestions.push('Remove all competitor mentions');
    } else {
      checks.push({
        name: 'competitor_mentions',
        category: 'compliance',
        passed: true,
        severity: 'pass',
        message: 'No competitor mentions',
      });
    }

    // 7. Headline length
    if (data.headline) {
      const headlineOk = data.headline.length <= 40;
      checks.push({
        name: 'headline_length',
        category: 'effectiveness',
        passed: headlineOk,
        severity: headlineOk ? 'pass' : 'warning',
        message: `Headline: ${data.headline.length} chars ${headlineOk ? '≤' : '>'} 40 max`,
        suggestion: headlineOk ? undefined : 'Shorten headline to ≤40 characters for mobile',
      });
    }

    // 8. Brand consistency
    if (data.brandColors !== undefined) {
      checks.push({
        name: 'brand_consistency',
        category: 'branding',
        passed: data.brandColors,
        severity: data.brandColors ? 'pass' : 'warning',
        message: data.brandColors ? 'Brand colors consistent' : 'Brand colors not matching',
        suggestion: data.brandColors ? undefined : 'Use brand colors for recognition',
      });
    }

    return this.buildResult('creative', data.shopId, data.creativeId, checks, suggestions);
  }

  // ── Store Review ─────────────────────────────────────────────────────

  reviewStore(data: {
    shopId:          string;
    storeUrl:        string;
    sections?:       string[];
    isMobile?:       boolean;
    pageSpeedMs?:    number;
    hasPixel?:       boolean;
    pricesVisible?:  boolean;
    hasCookieBanner?: boolean;
    hasPrivacyPolicy?: boolean;
    hasTerms?:       boolean;
    hasRefundPolicy?: boolean;
    hasContactPage?: boolean;
    hasSsl?:         boolean;
    hasCheckout?:    boolean;
    productCount?:   number;
  }): ReviewResult {
    const checks: ReviewCheck[] = [];
    const suggestions: string[] = [];

    // 1. Section count ≥ 8
    const sectionCount = data.sections?.length || 0;
    checks.push({
      name: 'section_count',
      category: 'structure',
      passed: sectionCount >= 8,
      severity: sectionCount >= 8 ? 'pass' : sectionCount >= 5 ? 'warning' : 'fail',
      message: `${sectionCount} sections ${sectionCount >= 8 ? '≥' : '<'} 8 minimum`,
      suggestion: sectionCount < 8 ? `Add more sections. Required: ${REQUIRED_STORE_SECTIONS.join(', ')}` : undefined,
    });

    // Check required sections
    if (data.sections) {
      for (const required of REQUIRED_STORE_SECTIONS) {
        const hasSection = data.sections.some(s =>
          s.toLowerCase().includes(required.toLowerCase())
        );
        checks.push({
          name: `section_${required}`,
          category: 'structure',
          passed: hasSection,
          severity: hasSection ? 'pass' : 'warning',
          message: hasSection ? `${required} section present` : `Missing ${required} section`,
        });
        if (!hasSection) suggestions.push(`Add a ${required} section`);
      }
    }

    // 2. Mobile responsive
    if (data.isMobile !== undefined) {
      checks.push({
        name: 'mobile_responsive',
        category: 'technical',
        passed: data.isMobile,
        severity: data.isMobile ? 'pass' : 'critical',
        message: data.isMobile ? 'Mobile responsive' : 'NOT mobile responsive',
        suggestion: data.isMobile ? undefined : '70%+ traffic is mobile — make store responsive immediately',
      });
      if (!data.isMobile) suggestions.push('Make store mobile responsive — critical for conversions');
    }

    // 3. Page speed ≤ 3s
    if (data.pageSpeedMs !== undefined) {
      const speedSeconds = data.pageSpeedMs / 1000;
      const speedOk = speedSeconds <= 3;
      checks.push({
        name: 'page_speed',
        category: 'technical',
        passed: speedOk,
        severity: speedOk ? 'pass' : speedSeconds <= 5 ? 'warning' : 'fail',
        message: `Page speed: ${speedSeconds.toFixed(1)}s ${speedOk ? '≤' : '>'} 3s target`,
        suggestion: speedOk ? undefined : 'Optimize images, minify CSS/JS, use CDN',
      });
      if (!speedOk) suggestions.push(`Improve page speed from ${speedSeconds.toFixed(1)}s to under 3s`);
    }

    // 4. Tracking pixel
    checks.push({
      name: 'tracking_pixel',
      category: 'tracking',
      passed: !!data.hasPixel,
      severity: data.hasPixel ? 'pass' : 'critical',
      message: data.hasPixel ? 'Tracking pixel installed' : 'NO tracking pixel!',
      suggestion: data.hasPixel ? undefined : 'Install Facebook/TikTok pixel — cannot optimize without tracking',
    });
    if (!data.hasPixel) suggestions.push('Install tracking pixel before launching ads');

    // 5. Prices visible
    checks.push({
      name: 'prices_visible',
      category: 'conversion',
      passed: !!data.pricesVisible,
      severity: data.pricesVisible ? 'pass' : 'warning',
      message: data.pricesVisible ? 'Prices displayed' : 'Prices not visible',
    });

    // 6. RGPD / Legal compliance
    checks.push({
      name: 'cookie_banner',
      category: 'legal',
      passed: !!data.hasCookieBanner,
      severity: data.hasCookieBanner ? 'pass' : 'fail',
      message: data.hasCookieBanner ? 'Cookie banner present' : 'Missing cookie banner (RGPD)',
    });
    if (!data.hasCookieBanner) suggestions.push('Add RGPD-compliant cookie banner');

    checks.push({
      name: 'privacy_policy',
      category: 'legal',
      passed: !!data.hasPrivacyPolicy,
      severity: data.hasPrivacyPolicy ? 'pass' : 'fail',
      message: data.hasPrivacyPolicy ? 'Privacy policy present' : 'Missing privacy policy',
    });

    checks.push({
      name: 'terms_conditions',
      category: 'legal',
      passed: !!data.hasTerms,
      severity: data.hasTerms ? 'pass' : 'fail',
      message: data.hasTerms ? 'Terms & conditions present' : 'Missing terms & conditions (CGV)',
    });

    checks.push({
      name: 'refund_policy',
      category: 'legal',
      passed: !!data.hasRefundPolicy,
      severity: data.hasRefundPolicy ? 'pass' : 'warning',
      message: data.hasRefundPolicy ? 'Refund policy present' : 'Missing refund policy',
    });

    checks.push({
      name: 'contact_page',
      category: 'legal',
      passed: !!data.hasContactPage,
      severity: data.hasContactPage ? 'pass' : 'warning',
      message: data.hasContactPage ? 'Contact page present' : 'Missing contact page',
    });

    // 7. SSL
    checks.push({
      name: 'ssl_certificate',
      category: 'security',
      passed: !!data.hasSsl,
      severity: data.hasSsl ? 'pass' : 'critical',
      message: data.hasSsl ? 'SSL certificate active' : 'NO SSL — browsers will show warning!',
    });
    if (!data.hasSsl) suggestions.push('Enable SSL certificate immediately');

    // 8. Checkout
    checks.push({
      name: 'checkout_functional',
      category: 'conversion',
      passed: !!data.hasCheckout,
      severity: data.hasCheckout ? 'pass' : 'critical',
      message: data.hasCheckout ? 'Checkout functional' : 'Checkout NOT working',
    });

    return this.buildResult('store', data.shopId, data.storeUrl, checks, suggestions);
  }

  // ── Campaign Review ──────────────────────────────────────────────────

  reviewCampaign(data: {
    shopId:         string;
    campaignId:     string;
    roas:           number;
    cpa:            number;
    targetCpa?:     number;
    ctr:            number;
    spent:          number;
    budgetLimit?:   number;
    frequency:      number;
    fatigueScore?:  number;      // 0-1
    daysRunning:    number;
    impressions:    number;
    conversions:    number;
    audienceOverlap?: number;    // 0-1
  }): ReviewResult {
    const checks: ReviewCheck[] = [];
    const suggestions: string[] = [];

    // 1. ROAS ≥ 2.0
    const roasOk = data.roas >= 2.0;
    checks.push({
      name: 'roas_minimum',
      category: 'profitability',
      passed: roasOk,
      severity: roasOk ? 'pass' : data.roas >= 1.0 ? 'warning' : 'fail',
      message: `ROAS: ${data.roas.toFixed(2)}x ${roasOk ? '≥' : '<'} 2.0x target`,
      suggestion: roasOk ? undefined : data.roas >= 1.0
        ? 'ROAS below target but not losing money — optimize'
        : 'ROAS below 1.0 — losing money, consider killing campaign',
    });

    // 2. CPA check
    if (data.targetCpa) {
      const cpaOk = data.cpa <= data.targetCpa;
      checks.push({
        name: 'cpa_target',
        category: 'profitability',
        passed: cpaOk,
        severity: cpaOk ? 'pass' : 'warning',
        message: `CPA: ${data.cpa.toFixed(2)}€ ${cpaOk ? '≤' : '>'} ${data.targetCpa.toFixed(2)}€ target`,
        suggestion: cpaOk ? undefined : 'CPA above target — optimize audience or creative',
      });
    }

    // 3. CTR ≥ 1.5%
    const ctrOk = data.ctr >= 1.5;
    checks.push({
      name: 'ctr_minimum',
      category: 'engagement',
      passed: ctrOk,
      severity: ctrOk ? 'pass' : data.ctr >= 1.0 ? 'warning' : 'fail',
      message: `CTR: ${data.ctr.toFixed(2)}% ${ctrOk ? '≥' : '<'} 1.5% target`,
      suggestion: ctrOk ? undefined : 'Low CTR — test new hooks/creatives or refine targeting',
    });
    if (!ctrOk) suggestions.push('Improve CTR with better hooks and creatives');

    // 4. Budget within limits
    if (data.budgetLimit) {
      const budgetUsed = data.spent / data.budgetLimit;
      const budgetOk = budgetUsed <= 1.0;
      checks.push({
        name: 'budget_limit',
        category: 'budget',
        passed: budgetOk,
        severity: budgetOk ? 'pass' : 'critical',
        message: `Budget: ${data.spent.toFixed(0)}€ / ${data.budgetLimit.toFixed(0)}€ (${(budgetUsed*100).toFixed(0)}%)`,
        suggestion: budgetOk ? undefined : 'BUDGET EXCEEDED — pause campaign immediately',
      });
      if (!budgetOk) suggestions.push('Pause campaign — budget exceeded');
    }

    // 5. Frequency ≤ 3.0
    const freqOk = data.frequency <= 3.0;
    checks.push({
      name: 'frequency',
      category: 'fatigue',
      passed: freqOk,
      severity: freqOk ? 'pass' : data.frequency <= 5.0 ? 'warning' : 'fail',
      message: `Frequency: ${data.frequency.toFixed(1)} ${freqOk ? '≤' : '>'} 3.0 max`,
      suggestion: freqOk ? undefined : 'High frequency causes ad fatigue — expand audience or refresh creative',
    });
    if (!freqOk) suggestions.push('Reduce frequency by expanding audience or refreshing creatives');

    // 6. Creative fatigue
    if (data.fatigueScore !== undefined) {
      const fatigueOk = data.fatigueScore <= 0.5;
      checks.push({
        name: 'creative_fatigue',
        category: 'fatigue',
        passed: fatigueOk,
        severity: fatigueOk ? 'pass' : data.fatigueScore <= 0.7 ? 'warning' : 'fail',
        message: `Fatigue score: ${(data.fatigueScore*100).toFixed(0)}% ${fatigueOk ? '≤' : '>'} 50%`,
        suggestion: fatigueOk ? undefined : 'Creative fatigue detected — generate new variants',
      });
      if (!fatigueOk) suggestions.push('Generate new creative variants — fatigue detected');
    }

    // 7. Audience overlap
    if (data.audienceOverlap !== undefined && data.audienceOverlap > 0.3) {
      checks.push({
        name: 'audience_overlap',
        category: 'targeting',
        passed: data.audienceOverlap <= 0.3,
        severity: data.audienceOverlap <= 0.3 ? 'pass' : 'warning',
        message: `Audience overlap: ${(data.audienceOverlap*100).toFixed(0)}% — may cause self-competition`,
        suggestion: 'Reduce audience overlap between ad sets to avoid bidding against yourself',
      });
      suggestions.push('Reduce audience overlap between ad sets');
    }

    // 8. Minimum data threshold
    const hasEnoughData = data.impressions >= 1000 && data.daysRunning >= 2;
    checks.push({
      name: 'data_sufficiency',
      category: 'confidence',
      passed: hasEnoughData,
      severity: hasEnoughData ? 'pass' : 'warning',
      message: hasEnoughData
        ? `${data.impressions.toLocaleString()} impressions over ${data.daysRunning} days — sufficient data`
        : `Only ${data.impressions.toLocaleString()} impressions over ${data.daysRunning} days — insufficient data`,
      suggestion: hasEnoughData ? undefined : 'Wait for more data before making optimization decisions',
    });

    return this.buildResult('campaign', data.shopId, data.campaignId, checks, suggestions);
  }

  // ── Build Result ─────────────────────────────────────────────────────

  private buildResult(
    type: ReviewType,
    shopId: string,
    targetId: string,
    checks: ReviewCheck[],
    suggestions: string[]
  ): ReviewResult {
    const passedCount = checks.filter(c => c.passed).length;
    const totalCount = checks.length;
    const score = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

    const hasCritical = checks.some(c => !c.passed && c.severity === 'critical');
    const hasFail = checks.some(c => !c.passed && c.severity === 'fail');
    const hasWarning = checks.some(c => !c.passed && c.severity === 'warning');

    const severity: ReviewSeverity = hasCritical ? 'critical'
      : hasFail ? 'fail'
      : hasWarning ? 'warning'
      : 'pass';

    const passed = !hasCritical && !hasFail;

    const failedChecks = checks.filter(c => !c.passed);
    const summary = [
      `${type.toUpperCase()} review: ${score}/100 (${passedCount}/${totalCount} checks passed)`,
      passed ? 'APPROVED' : `ISSUES FOUND: ${failedChecks.map(c => c.name).join(', ')}`,
      suggestions.length > 0 ? `${suggestions.length} suggestions` : '',
    ].filter(Boolean).join(' | ');

    return {
      type,
      shopId,
      targetId,
      passed,
      score,
      severity,
      checks,
      summary,
      suggestions: [...new Set(suggestions)],  // Deduplicate
      reviewedAt: new Date(),
    };
  }

  // ── Full Review (all 3 types) ────────────────────────────────────────

  async fullReview(shopId: string, data: {
    creative?: Parameters<ReviewEngine['reviewCreative']>[0];
    store?:    Parameters<ReviewEngine['reviewStore']>[0];
    campaign?: Parameters<ReviewEngine['reviewCampaign']>[0];
  }): Promise<{
    results:    ReviewResult[];
    overallScore: number;
    passed:     boolean;
    summary:    string;
  }> {
    const results: ReviewResult[] = [];

    if (data.creative) results.push(this.reviewCreative(data.creative));
    if (data.store) results.push(this.reviewStore(data.store));
    if (data.campaign) results.push(this.reviewCampaign(data.campaign));

    const overallScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
      : 0;

    const passed = results.every(r => r.passed);

    const summary = results.map(r =>
      `${r.type}: ${r.score}/100 ${r.passed ? '✓' : '✗'}`
    ).join(' | ');

    return {
      results,
      overallScore,
      passed,
      summary: `Overall: ${overallScore}/100 | ${summary}`,
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const reviewEngine = new ReviewEngine();
