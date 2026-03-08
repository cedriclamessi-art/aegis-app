/**
 * CurrencyService v4.1
 * Fetches daily exchange rates from ECB.
 * Normalises all financial metrics to shop base currency.
 * Blissal = EUR. Future: BE (EUR), CH (CHF), CA (CAD).
 */
import { Pool } from 'pg';

const SUPPORTED_CURRENCIES = ['EUR', 'GBP', 'CHF', 'CAD', 'USD', 'SEK', 'DKK', 'NOK'] as const;
type Currency = typeof SUPPORTED_CURRENCIES[number];

export class CurrencyService {
  constructor(private db: Pool) {}

  /** Fetch and cache ECB rates daily. */
  async refreshRates(): Promise<void> {
    try {
      // ECB publishes EUR-based rates
      const res  = await fetch('https://api.frankfurter.app/latest?from=EUR');
      const data = await res.json() as any;
      const rates = data.rates as Record<string, number>;

      for (const [currency, rate] of Object.entries(rates)) {
        if (!SUPPORTED_CURRENCIES.includes(currency as Currency)) continue;
        await this.db.query(`
          INSERT INTO currency_rates (from_currency, to_currency, rate, source)
          VALUES ($1,'EUR',$2,'ecb')
          ON CONFLICT (from_currency, to_currency, DATE(fetched_at)) DO UPDATE SET rate=$2, fetched_at=NOW()`,
          [currency, 1 / rate]); // Store as X→EUR rate
      }
      // EUR→EUR = 1
      await this.db.query(`
        INSERT INTO currency_rates (from_currency, to_currency, rate, source)
        VALUES ('EUR','EUR',1.0,'ecb')
        ON CONFLICT DO NOTHING`);
    } catch {
      // Non-critical — use cached rates
    }
  }

  /** Convert amount from one currency to another. */
  async convert(amount: number, from: Currency, to: Currency): Promise<number> {
    if (from === to) return amount;

    // Get from→EUR rate
    const toEur = await this.getRate(from, 'EUR');
    if (to === 'EUR') return amount * toEur;

    // Get EUR→to rate
    const fromEur = await this.getRate('EUR', to);
    return amount * toEur * fromEur;
  }

  /** Get cached exchange rate, fallback to 1.0 if unavailable. */
  async getRate(from: Currency, to: Currency): Promise<number> {
    if (from === to) return 1.0;
    const { rows } = await this.db.query(`
      SELECT rate FROM currency_rates
      WHERE from_currency=$1 AND to_currency=$2
      ORDER BY fetched_at DESC LIMIT 1`, [from, to]);
    return parseFloat(rows[0]?.rate ?? 1.0);
  }

  /**
   * Normalise a financial value to the shop's base currency.
   * Used by all agents before persisting metrics.
   */
  async toBase(amount: number, fromCurrency: Currency, shopId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT base_currency FROM shops WHERE id=$1`, [shopId]);
    const base = (rows[0]?.base_currency ?? 'EUR') as Currency;
    return this.convert(amount, fromCurrency, base);
  }

  /** Get all current rates as a display object. */
  async getRateTable(): Promise<Record<string, number>> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT ON (from_currency) from_currency, rate
      FROM currency_rates WHERE to_currency='EUR'
      ORDER BY from_currency, fetched_at DESC`);
    return Object.fromEntries(rows.map((r: any) => [r.from_currency, parseFloat(r.rate)]));
  }
}
