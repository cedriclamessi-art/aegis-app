/**
 * Global Seasonal Calendar Data v4.2
 * Events with per-region peak dates.
 * Same event, different dates, different intensities per market.
 */
export interface RegionalEvent {
  region:  string;
  peak_date: string;
  phases:  Record<string, PhaseConfig>;
  active_audiences?: string[];  // Meta targeting regions
  auto_apply?: boolean;
}

export interface PhaseConfig {
  start_days_before?: number;
  end_days_before?:   number;
  start_days_after?:  number;
  end_days_after?:    number;
  budget_multiplier:  number;
  empire_mode:        'conservative' | 'balanced' | 'aggressive';
}

export interface GlobalEvent {
  event_name:   string;
  event_type:   'holiday' | 'promotion' | 'seasonal' | 'competitive';
  is_global:    boolean;
  regions:      RegionalEvent[];
}

const PHASES_MOTHERS_DAY = (multiplierPeak: number): Record<string, PhaseConfig> => ({
  preparation:  { start_days_before: 21, end_days_before: 6,  budget_multiplier: 1.4, empire_mode: 'balanced'     },
  acceleration: { start_days_before: 5,  end_days_before: 1,  budget_multiplier: 1.9, empire_mode: 'aggressive'   },
  peak:         { start_days_before: 0,  end_days_after:  1,  budget_multiplier: multiplierPeak, empire_mode: 'aggressive'   },
  deceleration: { start_days_after:  2,  end_days_after:  5,  budget_multiplier: 0.5, empire_mode: 'conservative' },
});

export const GLOBAL_CALENDAR_2026_2027: GlobalEvent[] = [

  // ── FÊTE DES MÈRES (dates varient par pays) ─────────────
  {
    event_name: 'Fête des Mères',
    event_type: 'holiday', is_global: true,
    regions: [
      { region: 'FR', peak_date: '2026-05-31', phases: PHASES_MOTHERS_DAY(2.2), active_audiences: ['FR'], auto_apply: true },
      { region: 'BE', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(2.0), active_audiences: ['BE'], auto_apply: true },
      { region: 'UK', peak_date: '2026-03-22', phases: PHASES_MOTHERS_DAY(1.8), active_audiences: ['GB'], auto_apply: true },
      { region: 'US', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(1.6), active_audiences: ['US'], auto_apply: false },
      { region: 'CA', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(1.5), active_audiences: ['CA'], auto_apply: false },
      { region: 'AU', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(1.5), active_audiences: ['AU'], auto_apply: false },
      { region: 'DE', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(1.7), active_audiences: ['DE'], auto_apply: false },
      { region: 'CH', peak_date: '2026-05-10', phases: PHASES_MOTHERS_DAY(1.7), active_audiences: ['CH'], auto_apply: false },
      // 2027
      { region: 'FR', peak_date: '2027-05-30', phases: PHASES_MOTHERS_DAY(2.2), active_audiences: ['FR'], auto_apply: true },
      { region: 'BE', peak_date: '2027-05-09', phases: PHASES_MOTHERS_DAY(2.0), active_audiences: ['BE'], auto_apply: true },
    ],
  },

  // ── SAINT-VALENTIN (global, même date) ──────────────────
  {
    event_name: 'Saint-Valentin',
    event_type: 'holiday', is_global: true,
    regions: [
      { region: 'FR',     peak_date: '2026-02-14', phases: { preparation: { start_days_before: 21, end_days_before: 6, budget_multiplier: 1.3, empire_mode: 'balanced' }, acceleration: { start_days_before: 5, end_days_before: 1, budget_multiplier: 1.9, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 1, budget_multiplier: 2.0, empire_mode: 'aggressive' }, deceleration: { start_days_after: 2, end_days_after: 4, budget_multiplier: 0.5, empire_mode: 'conservative' } }, active_audiences: ['FR'], auto_apply: true },
      { region: 'BE',     peak_date: '2026-02-14', phases: { preparation: { start_days_before: 14, end_days_before: 5, budget_multiplier: 1.2, empire_mode: 'balanced' }, peak: { start_days_before: 0, end_days_after: 1, budget_multiplier: 1.8, empire_mode: 'aggressive' }, deceleration: { start_days_after: 2, end_days_after: 3, budget_multiplier: 0.6, empire_mode: 'conservative' } }, active_audiences: ['BE'], auto_apply: true },
      { region: 'GLOBAL', peak_date: '2026-02-14', phases: { preparation: { start_days_before: 10, end_days_before: 3, budget_multiplier: 1.2, empire_mode: 'balanced' }, peak: { start_days_before: 0, end_days_after: 1, budget_multiplier: 1.8, empire_mode: 'aggressive' }, deceleration: { start_days_after: 2, end_days_after: 3, budget_multiplier: 0.6, empire_mode: 'conservative' } }, auto_apply: false },
    ],
  },

  // ── BLACK FRIDAY (global, même date) ────────────────────
  {
    event_name: 'Black Friday',
    event_type: 'promotion', is_global: true,
    regions: [
      { region: 'FR',     peak_date: '2026-11-27', phases: { preparation: { start_days_before: 14, end_days_before: 4, budget_multiplier: 1.5, empire_mode: 'balanced' }, acceleration: { start_days_before: 3, end_days_before: 1, budget_multiplier: 2.0, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 3, budget_multiplier: 2.5, empire_mode: 'aggressive' }, deceleration: { start_days_after: 4, end_days_after: 7, budget_multiplier: 0.4, empire_mode: 'conservative' } }, active_audiences: ['FR'], auto_apply: true },
      { region: 'UK',     peak_date: '2026-11-27', phases: { preparation: { start_days_before: 14, end_days_before: 4, budget_multiplier: 1.6, empire_mode: 'balanced' }, acceleration: { start_days_before: 3, end_days_before: 1, budget_multiplier: 2.1, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 4, budget_multiplier: 2.6, empire_mode: 'aggressive' }, deceleration: { start_days_after: 5, end_days_after: 8, budget_multiplier: 0.4, empire_mode: 'conservative' } }, active_audiences: ['GB'], auto_apply: false },
      { region: 'US',     peak_date: '2026-11-27', phases: { preparation: { start_days_before: 10, end_days_before: 3, budget_multiplier: 1.8, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 4, budget_multiplier: 3.0, empire_mode: 'aggressive' }, deceleration: { start_days_after: 5, end_days_after: 7, budget_multiplier: 0.3, empire_mode: 'conservative' } }, active_audiences: ['US'], auto_apply: false },
      { region: 'DE',     peak_date: '2026-11-27', phases: { preparation: { start_days_before: 14, end_days_before: 4, budget_multiplier: 1.4, empire_mode: 'balanced' }, peak: { start_days_before: 0, end_days_after: 3, budget_multiplier: 2.2, empire_mode: 'aggressive' }, deceleration: { start_days_after: 4, end_days_after: 7, budget_multiplier: 0.5, empire_mode: 'conservative' } }, active_audiences: ['DE','AT','CH'], auto_apply: false },
    ],
  },

  // ── NOËL (global, légères variations de timing) ─────────
  {
    event_name: 'Noël',
    event_type: 'holiday', is_global: true,
    regions: [
      { region: 'FR',     peak_date: '2026-12-25', phases: { preparation: { start_days_before: 28, end_days_before: 8, budget_multiplier: 1.4, empire_mode: 'balanced' }, acceleration: { start_days_before: 7, end_days_before: 2, budget_multiplier: 1.9, empire_mode: 'aggressive' }, peak: { start_days_before: 1, end_days_after: 1, budget_multiplier: 2.0, empire_mode: 'aggressive' }, deceleration: { start_days_after: 2, end_days_after: 6, budget_multiplier: 0.5, empire_mode: 'conservative' } }, active_audiences: ['FR','BE','CH'], auto_apply: true },
      { region: 'UK',     peak_date: '2026-12-25', phases: { preparation: { start_days_before: 21, end_days_before: 7, budget_multiplier: 1.5, empire_mode: 'balanced' }, acceleration: { start_days_before: 6, end_days_before: 2, budget_multiplier: 2.0, empire_mode: 'aggressive' }, peak: { start_days_before: 1, end_days_after: 0, budget_multiplier: 2.1, empire_mode: 'aggressive' }, deceleration: { start_days_after: 1, end_days_after: 5, budget_multiplier: 0.6, empire_mode: 'conservative' } }, active_audiences: ['GB'], auto_apply: false },
    ],
  },

  // ── SINGLES' DAY (Asie/international Amazon) ────────────
  {
    event_name: 'Singles\' Day',
    event_type: 'promotion', is_global: false,
    regions: [
      { region: 'GLOBAL', peak_date: '2026-11-11', phases: { acceleration: { start_days_before: 5, end_days_before: 1, budget_multiplier: 1.5, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 0, budget_multiplier: 2.0, empire_mode: 'aggressive' }, deceleration: { start_days_after: 1, end_days_after: 3, budget_multiplier: 0.6, empire_mode: 'conservative' } }, auto_apply: false },
    ],
  },

  // ── RAMADAN (comportement MENA) ──────────────────────────
  {
    event_name: 'Aïd el-Fitr',
    event_type: 'holiday', is_global: false,
    regions: [
      // Dates approx 2026 (dépend du croissant lunaire)
      { region: 'MENA',   peak_date: '2026-03-30', phases: { preparation: { start_days_before: 10, end_days_before: 1, budget_multiplier: 1.6, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 2, budget_multiplier: 2.0, empire_mode: 'aggressive' }, deceleration: { start_days_after: 3, end_days_after: 7, budget_multiplier: 0.5, empire_mode: 'conservative' } }, active_audiences: ['AE','SA','MA','TN'], auto_apply: false },
    ],
  },

  // ── RENTRÉE (FR/BE/CH seulement) ────────────────────────
  {
    event_name: 'Rentrée Beauté',
    event_type: 'seasonal', is_global: false,
    regions: [
      { region: 'FR', peak_date: '2026-09-07', phases: { preparation: { start_days_before: 14, end_days_before: 4, budget_multiplier: 1.2, empire_mode: 'balanced' }, acceleration: { start_days_before: 3, end_days_before: 1, budget_multiplier: 1.6, empire_mode: 'aggressive' }, peak: { start_days_before: 0, end_days_after: 2, budget_multiplier: 1.8, empire_mode: 'aggressive' }, deceleration: { start_days_after: 3, end_days_after: 7, budget_multiplier: 0.8, empire_mode: 'conservative' } }, active_audiences: ['FR','BE','CH'], auto_apply: true },
    ],
  },

  // ── PRIME DAY (Amazon, global) ───────────────────────────
  {
    event_name: 'Amazon Prime Day',
    event_type: 'competitive', is_global: true,
    regions: [
      // Typically mid-July, exact date TBD
      { region: 'GLOBAL', peak_date: '2026-07-14', phases: { preparation: { start_days_before: 7, end_days_before: 2, budget_multiplier: 0.8, empire_mode: 'conservative' }, peak: { start_days_before: 0, end_days_after: 1, budget_multiplier: 0.6, empire_mode: 'conservative' }, deceleration: { start_days_after: 2, end_days_after: 4, budget_multiplier: 1.2, empire_mode: 'balanced' } }, auto_apply: false },
      // Strategy: REDUCE spend during Prime Day (consumer attention elsewhere),
      // then INCREASE just after to capture post-Prime buyers
    ],
  },
];
