/**
 * AGENT_SEASONAL_CALENDAR v4.2 — Global extension
 * Extends v4.1 with per-region peak dates.
 * Seeds global calendar on first setup.
 * Phase detection uses audience regions from active Meta campaigns.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { GLOBAL_CALENDAR_2026_2027 } from './seasonal-calendar-global';

export class AgentSeasonalCalendarGlobal extends BaseAgent {
  readonly name = 'AGENT_SEASONAL_CALENDAR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'seed_global':       return this.seedGlobal(task);
      case 'check_phases':      return this.checkPhasesGlobal(task);
      case 'get_upcoming':      return this.getUpcomingGlobal(task);
      case 'get_active_regions':return this.getActiveRegions(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Seeds all global events with per-region dates. */
  private async seedGlobal(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    let eventsSeeded = 0, regionsSeeded = 0;

    for (const ev of GLOBAL_CALENDAR_2026_2027) {
      // Upsert the event
      const { rows: [event] } = await this.db.query(`
        INSERT INTO seasonal_events (shop_id, event_name, event_type, peak_date, phases, is_active)
        VALUES ($1,$2,$3,$4,'{}',true)
        ON CONFLICT (shop_id, event_name, peak_date) DO UPDATE
          SET event_type=$3
        RETURNING id`,
        [shop_id, ev.event_name, ev.event_type, ev.regions[0]?.peak_date ?? '2026-01-01']);
      eventsSeeded++;

      // Upsert each regional variant
      for (const region of ev.regions) {
        await this.db.query(`
          INSERT INTO seasonal_event_regions
            (event_id, region, peak_date, phases, auto_apply)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (event_id, region) DO UPDATE SET
            peak_date=$3, phases=$4, auto_apply=$5`,
          [event.id, region.region, region.peak_date,
           JSON.stringify(region.phases), region.auto_apply ?? false]);
        regionsSeeded++;
      }
    }

    return { success: true, data: { events: eventsSeeded, regions: regionsSeeded } };
  }

  /** Checks phases for ALL active regions for this shop's active audiences. */
  private async checkPhasesGlobal(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Determine which regions are active (from Meta ad geotargeting)
    const { rows: activeRegions } = await this.db.query(`
      SELECT DISTINCT UNNEST(targeting_regions) AS region
      FROM ad_sets WHERE shop_id=$1 AND status='active'`, [shop_id])
      .catch(() => ({ rows: [] }));

    const regions = activeRegions.length
      ? [...new Set(['FR', ...activeRegions.map((r: any) => r.region)])]
      : ['FR']; // default to FR

    const transitions: any[] = [];

    for (const region of regions) {
      const { rows: eventRegions } = await this.db.query(`
        SELECT ser.*, se.event_name, se.event_type
        FROM seasonal_event_regions ser
        JOIN seasonal_events se ON se.id = ser.event_id
        WHERE se.shop_id=$1 AND ser.region=$2 AND ser.is_active=true
          AND ser.peak_date BETWEEN CURRENT_DATE - INTERVAL '10 days' AND CURRENT_DATE + INTERVAL '35 days'`,
        [shop_id, region]);

      for (const er of eventRegions) {
        const peak     = new Date(er.peak_date);
        const daysDiff = Math.round((peak.getTime() - today.getTime()) / 86400000);
        const phases   = er.phases as any;
        let   active: string | null = null;

        for (const [name, cfg] of Object.entries(phases) as [string, any][]) {
          const beforeStart = cfg.start_days_before ?? 999;
          const beforeEnd   = cfg.end_days_before   ?? 999;
          const afterEnd    = cfg.end_days_after     ?? 0;

          if (daysDiff >= 0 && daysDiff <= beforeStart && daysDiff >= beforeEnd)
            { active = name; break; }
          if (daysDiff < 0 && Math.abs(daysDiff) <= afterEnd)
            { active = name; break; }
        }

        if (active !== er.current_phase && er.auto_apply && active) {
          const phaseConfig = phases[active] as any;

          await this.db.query(`UPDATE seasonal_event_regions SET current_phase=$1 WHERE id=$2`,
            [active, er.id]);

          await this.db.query(`
            INSERT INTO seasonal_phase_log
              (shop_id, event_id, phase_name, budget_multiplier_applied, empire_mode_set)
            VALUES ($1,$2,$3,$4,$5)`,
            [shop_id, er.event_id, active,
             phaseConfig.budget_multiplier, phaseConfig.empire_mode]);

          // Apply empire_mode override
          await this.db.query(`
            UPDATE world_state SET empire_mode=$1,
              seasonal_override=$2, updated_at=NOW()
            WHERE shop_id=$3`,
            [phaseConfig.empire_mode,
             JSON.stringify({ event: er.event_name, region, phase: active }),
             shop_id]);

          transitions.push({
            event: er.event_name, region, phase: active,
            days_to_peak: daysDiff, multiplier: phaseConfig.budget_multiplier,
          });

          await this.remember(shop_id, {
            memory_key: `seasonal_${er.event_name.replace(/\s/g,'_')}_${region}`,
            memory_type: 'opportunity',
            value: {
              event: er.event_name, region, phase: active, days_to_peak: daysDiff,
              budget_multiplier: phaseConfig.budget_multiplier,
              message: `[${region}] ${er.event_name} → phase ${active} ×${phaseConfig.budget_multiplier}`,
              severity: 'info',
            },
            ttl_hours: 24,
          });
        }
      }
    }

    return { success: true, data: { regions_checked: regions, transitions } };
  }

  private async getUpcomingGlobal(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows } = await this.db.query(`
      SELECT se.event_name, se.event_type,
             ser.region, ser.peak_date, ser.current_phase,
             (ser.peak_date - CURRENT_DATE) AS days_until_peak
      FROM seasonal_events se
      JOIN seasonal_event_regions ser ON ser.event_id = se.id
      WHERE se.shop_id=$1 AND ser.is_active=true AND ser.peak_date >= CURRENT_DATE
      ORDER BY ser.peak_date ASC LIMIT 12`, [shop_id]);
    return { success: true, data: { upcoming: rows } };
  }

  private async getActiveRegions(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT region FROM seasonal_event_regions ser
      JOIN seasonal_events se ON se.id = ser.event_id
      WHERE se.shop_id=$1 AND ser.is_active=true`, [task.shop_id]);
    return { success: true, data: { regions: rows.map((r: any) => r.region) } };
  }
}
