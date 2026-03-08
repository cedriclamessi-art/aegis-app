/**
 * Quality Gates — Validation between pipeline steps
 * ====================================================
 * Sources: Everything Claude Code, OneRedOak Workflows
 *
 * Each pipeline step passes through a quality gate before advancing.
 * Gates validate:
 *   - Data completeness (required fields present)
 *   - Business rules (margins ≥30%, ROAS projections)
 *   - Content quality (section counts, word counts)
 *   - Compliance (legal requirements, platform rules)
 *
 * Gate severity:
 *   pass    — All checks passed, proceed
 *   warning — Minor issues, proceed with notes
 *   block   — Critical issues, halt pipeline
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type GateSeverity = 'pass' | 'warning' | 'block';

export interface GateCheck {
  name:       string;
  passed:     boolean;
  severity:   GateSeverity;
  message:    string;
  details?:   unknown;
}

export interface GateResult {
  stepName:     string;
  passed:       boolean;
  severity:     GateSeverity;
  checks:       GateCheck[];
  summary:      string;
  timestamp:    Date;
}

export type GateValidator = (data: Record<string, unknown>) => GateCheck[];

// ── Pipeline Step Names ───────────────────────────────────────────────────

export const PIPELINE_STEPS = [
  'ingest',
  'analyze',
  'validate',
  'build_offer',
  'build_page',
  'create_ads',
  'launch_test',
  'analyze_results',
  'scale',
  'protect',
  'learn',
] as const;

export type PipelineStep = typeof PIPELINE_STEPS[number];

// ── Quality Gate Engine ───────────────────────────────────────────────────

class QualityGateEngine {
  private validators: Map<PipelineStep, GateValidator[]> = new Map();

  constructor() {
    this.registerBuiltInValidators();
  }

  // ── Register custom validator ────────────────────────────────────────

  registerValidator(step: PipelineStep, validator: GateValidator): void {
    const validators = this.validators.get(step) || [];
    validators.push(validator);
    this.validators.set(step, validators);
  }

  // ── Run quality gate ─────────────────────────────────────────────────

  async validate(step: PipelineStep, data: Record<string, unknown>): Promise<GateResult> {
    const validators = this.validators.get(step) || [];
    const allChecks: GateCheck[] = [];

    for (const validator of validators) {
      try {
        const checks = validator(data);
        allChecks.push(...checks);
      } catch (err) {
        allChecks.push({
          name: 'validator_error',
          passed: false,
          severity: 'warning',
          message: `Validator crashed: ${(err as Error).message}`,
        });
      }
    }

    // Determine overall result
    const hasBlock = allChecks.some(c => !c.passed && c.severity === 'block');
    const hasWarning = allChecks.some(c => !c.passed && c.severity === 'warning');
    const passedCount = allChecks.filter(c => c.passed).length;

    const severity: GateSeverity = hasBlock ? 'block' : hasWarning ? 'warning' : 'pass';
    const passed = !hasBlock;

    const summary = [
      `${step}: ${passedCount}/${allChecks.length} checks passed`,
      hasBlock ? `BLOCKED — ${allChecks.filter(c => c.severity === 'block' && !c.passed).map(c => c.name).join(', ')}` : '',
      hasWarning ? `Warnings: ${allChecks.filter(c => c.severity === 'warning' && !c.passed).map(c => c.name).join(', ')}` : '',
    ].filter(Boolean).join('. ');

    return {
      stepName: step,
      passed,
      severity,
      checks: allChecks,
      summary,
      timestamp: new Date(),
    };
  }

  // ── Built-in Validators ──────────────────────────────────────────────

  private registerBuiltInValidators(): void {

    // ── INGEST gate ──────────────────────────────────────────────────
    this.registerValidator('ingest', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'product_url',
        passed: !!data.url || !!data.product_url,
        severity: 'block',
        message: data.url ? 'Product URL present' : 'Missing product URL',
      });

      checks.push({
        name: 'product_name',
        passed: !!data.name || !!data.product_name || !!data.title,
        severity: 'block',
        message: (data.name || data.product_name) ? 'Product name present' : 'Missing product name',
      });

      checks.push({
        name: 'product_price',
        passed: !!data.price && Number(data.price) > 0,
        severity: 'warning',
        message: data.price ? `Price: ${data.price}` : 'No price detected — will estimate',
      });

      checks.push({
        name: 'product_images',
        passed: Array.isArray(data.images) && data.images.length > 0,
        severity: 'warning',
        message: Array.isArray(data.images)
          ? `${data.images.length} images found`
          : 'No images — will use placeholder',
      });

      return checks;
    });

    // ── ANALYZE gate ─────────────────────────────────────────────────
    this.registerValidator('analyze', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'market_analysis',
        passed: !!data.market || !!data.analysis,
        severity: 'warning',
        message: data.market ? 'Market analysis present' : 'No market analysis',
      });

      checks.push({
        name: 'competitor_data',
        passed: Array.isArray(data.competitors) && data.competitors.length > 0,
        severity: 'warning',
        message: Array.isArray(data.competitors)
          ? `${data.competitors.length} competitors analyzed`
          : 'No competitor data',
      });

      checks.push({
        name: 'target_audience',
        passed: !!data.audience || !!data.target,
        severity: 'block',
        message: data.audience ? 'Target audience defined' : 'Missing target audience — cannot proceed',
      });

      return checks;
    });

    // ── VALIDATE gate ────────────────────────────────────────────────
    this.registerValidator('validate', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'data_completeness',
        passed: !!data.validated || !!data.complete,
        severity: 'warning',
        message: 'Data validation check',
      });

      checks.push({
        name: 'no_prohibited_content',
        passed: !data.prohibited && !data.flagged,
        severity: 'block',
        message: data.prohibited ? 'Prohibited content detected!' : 'No prohibited content',
      });

      return checks;
    });

    // ── BUILD OFFER gate ─────────────────────────────────────────────
    this.registerValidator('build_offer', (data) => {
      const checks: GateCheck[] = [];

      const margin = Number(data.margin) || 0;
      checks.push({
        name: 'margin_minimum',
        passed: margin >= 30,
        severity: 'block',
        message: margin >= 30 ? `Margin ${margin}% ≥ 30% minimum` : `Margin ${margin}% below 30% minimum`,
      });

      checks.push({
        name: 'selling_price',
        passed: !!data.sellingPrice && Number(data.sellingPrice) > 0,
        severity: 'block',
        message: data.sellingPrice ? `Selling price: ${data.sellingPrice}€` : 'Missing selling price',
      });

      const hooks = data.hooks as unknown[];
      checks.push({
        name: 'marketing_hooks',
        passed: Array.isArray(hooks) && hooks.length >= 3,
        severity: 'warning',
        message: Array.isArray(hooks)
          ? `${hooks.length} hooks generated`
          : 'No marketing hooks — will use defaults',
      });

      return checks;
    });

    // ── BUILD PAGE gate ──────────────────────────────────────────────
    this.registerValidator('build_page', (data) => {
      const checks: GateCheck[] = [];

      const sections = data.sections as unknown[];
      checks.push({
        name: 'section_count',
        passed: Array.isArray(sections) && sections.length >= 6,
        severity: 'block',
        message: Array.isArray(sections)
          ? `${sections.length} sections (min 6)`
          : 'Missing page sections',
      });

      checks.push({
        name: 'mobile_responsive',
        passed: data.mobileReady !== false,
        severity: 'warning',
        message: data.mobileReady !== false ? 'Mobile responsive' : 'Not mobile responsive',
      });

      checks.push({
        name: 'cta_present',
        passed: !!data.ctaButton || !!data.cta,
        severity: 'block',
        message: data.ctaButton ? 'CTA button present' : 'Missing CTA button!',
      });

      checks.push({
        name: 'legal_pages',
        passed: !!data.legalPages || !!data.privacyPolicy,
        severity: 'warning',
        message: data.legalPages ? 'Legal pages included' : 'Missing legal pages — add before launch',
      });

      return checks;
    });

    // ── CREATE ADS gate ──────────────────────────────────────────────
    this.registerValidator('create_ads', (data) => {
      const checks: GateCheck[] = [];

      const ads = data.ads as unknown[];
      checks.push({
        name: 'ad_count',
        passed: Array.isArray(ads) && ads.length >= 3,
        severity: 'block',
        message: Array.isArray(ads)
          ? `${ads.length} ads created (min 3)`
          : 'No ads created',
      });

      checks.push({
        name: 'ad_platform',
        passed: !!data.platform,
        severity: 'warning',
        message: data.platform ? `Platform: ${data.platform}` : 'No platform specified',
      });

      checks.push({
        name: 'compliance_check',
        passed: data.compliant !== false,
        severity: 'block',
        message: data.compliant !== false ? 'Ads compliant' : 'Ads flagged for compliance issues',
      });

      return checks;
    });

    // ── LAUNCH TEST gate ─────────────────────────────────────────────
    this.registerValidator('launch_test', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'budget_set',
        passed: !!data.testBudget && Number(data.testBudget) > 0,
        severity: 'block',
        message: data.testBudget ? `Test budget: ${data.testBudget}€` : 'No test budget set',
      });

      checks.push({
        name: 'tracking_pixel',
        passed: !!data.pixelInstalled || !!data.tracking,
        severity: 'block',
        message: data.pixelInstalled ? 'Tracking pixel installed' : 'Missing tracking pixel!',
      });

      checks.push({
        name: 'store_live',
        passed: !!data.storeUrl || !!data.storeLive,
        severity: 'block',
        message: data.storeUrl ? 'Store is live' : 'Store not deployed yet',
      });

      return checks;
    });

    // ── ANALYZE RESULTS gate ─────────────────────────────────────────
    this.registerValidator('analyze_results', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'data_collected',
        passed: !!data.impressions || !!data.clicks || !!data.results,
        severity: 'block',
        message: data.impressions ? `${data.impressions} impressions collected` : 'No data collected yet',
      });

      checks.push({
        name: 'minimum_spend',
        passed: Number(data.spent || 0) >= Number(data.testBudget || 0) * 0.5,
        severity: 'warning',
        message: `Spent ${data.spent}€ of ${data.testBudget}€ budget`,
      });

      const classification = data.classification as string;
      checks.push({
        name: 'classification',
        passed: ['CONDOR', 'TOF', 'BOF', 'DEAD'].includes(classification),
        severity: 'warning',
        message: classification
          ? `Classification: ${classification}`
          : 'No CONDOR/TOF/BOF/DEAD classification yet',
      });

      return checks;
    });

    // ── SCALE gate ───────────────────────────────────────────────────
    this.registerValidator('scale', (data) => {
      const checks: GateCheck[] = [];

      const roas = Number(data.roas || 0);
      checks.push({
        name: 'roas_minimum',
        passed: roas >= 2.0,
        severity: 'block',
        message: roas >= 2.0
          ? `ROAS ${roas.toFixed(1)}x — profitable, scale approved`
          : `ROAS ${roas.toFixed(1)}x — below 2.0x minimum for scaling`,
      });

      const classification = data.classification as string;
      checks.push({
        name: 'condor_required',
        passed: classification === 'CONDOR' || classification === 'TOF',
        severity: 'block',
        message: classification === 'CONDOR'
          ? 'CONDOR classification — ready to scale'
          : classification === 'TOF'
          ? 'TOF classification — limited scaling approved'
          : `${classification || 'Unknown'} classification — do not scale`,
      });

      return checks;
    });

    // ── PROTECT gate ─────────────────────────────────────────────────
    this.registerValidator('protect', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'budget_limit_set',
        passed: !!data.dailyLimit || !!data.budgetLimit,
        severity: 'warning',
        message: data.dailyLimit ? `Daily limit: ${data.dailyLimit}€` : 'No daily budget limit set',
      });

      checks.push({
        name: 'stop_loss_active',
        passed: !!data.stopLoss,
        severity: 'warning',
        message: data.stopLoss ? 'Stop-loss protection active' : 'No stop-loss configured',
      });

      return checks;
    });

    // ── LEARN gate ───────────────────────────────────────────────────
    this.registerValidator('learn', (data) => {
      const checks: GateCheck[] = [];

      checks.push({
        name: 'insights_recorded',
        passed: !!data.insights || !!data.learnings,
        severity: 'warning',
        message: data.insights ? 'Insights recorded' : 'No insights captured — cycle may repeat errors',
      });

      return checks;
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const qualityGate = new QualityGateEngine();
