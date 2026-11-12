import { ProviderError } from './errors.js';

/**
 * XBRL concepts we read, in order of preference. Companies switch concepts over
 * time (e.g. SalesRevenueNet -> RevenueFromContractWithCustomer...), so each
 * metric merges every candidate and lets the most recently used one win.
 */
export const CONCEPTS = {
  revenue: {
    kind: 'duration',
    candidates: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'RevenuesNetOfInterestExpense',
    ],
  },
  grossProfit: { kind: 'duration', candidates: ['GrossProfit'] },
  operatingIncome: { kind: 'duration', candidates: ['OperatingIncomeLoss'] },
  netIncome: {
    kind: 'duration',
    candidates: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  },
  operatingCashFlow: {
    kind: 'duration',
    candidates: [
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
    ],
  },
  capex: {
    kind: 'duration',
    candidates: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  },
  equity: {
    kind: 'instant',
    candidates: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  },
  liabilities: { kind: 'instant', candidates: ['Liabilities'] },
  liabilitiesAndEquity: { kind: 'instant', candidates: ['LiabilitiesAndStockholdersEquity'] },
  assetsCurrent: { kind: 'instant', candidates: ['AssetsCurrent'] },
  liabilitiesCurrent: { kind: 'instant', candidates: ['LiabilitiesCurrent'] },
  cash: {
    kind: 'instant',
    candidates: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    ],
  },
  longTermDebt: { kind: 'instant', candidates: ['LongTermDebt', 'LongTermDebtNoncurrent'] },
};

const FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A', '10-KT', '10-QT']);

/**
 * Reduce SEC "companyfacts" JSON (often several MB) to the handful of facts we
 * need. Each fact is stored as [start|null, end, value, filed].
 */
export function compactCompanyFacts(raw, { sinceYear = new Date().getUTCFullYear() - 7 } = {}) {
  const gaap = raw?.facts?.['us-gaap'] || {};
  const since = `${sinceYear}-01-01`;
  const out = { cik: raw?.cik ?? null, name: raw?.entityName ?? null, metrics: {}, shares: [] };

  for (const [metric, { kind, candidates }] of Object.entries(CONCEPTS)) {
    const ranked = candidates
      .map((c) => {
        const units = gaap[c]?.units;
        const facts = units?.USD || (units && Object.values(units)[0]) || [];
        const usable = facts.filter((f) => FORMS.has(f.form) && f.end >= since && Number.isFinite(f.val));
        const latest = usable.reduce((m, f) => (f.end > m ? f.end : m), '');
        return { c, usable, latest };
      })
      .filter((r) => r.usable.length)
      .sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));

    // Walk candidates best-first; a lower-ranked concept only fills periods the
    // better ones lack. All filings of a period are kept for point-in-time use.
    const covered = new Set();
    const merged = [];
    for (const { usable } of ranked) {
      const added = new Set();
      for (const f of usable) {
        const start = kind === 'duration' ? f.start || null : null;
        if (kind === 'duration' && !start) continue;
        const period = `${start}|${f.end}`;
        if (covered.has(period)) continue;
        added.add(period);
        merged.push([start, f.end, f.val, f.filed]);
      }
      for (const p of added) covered.add(p);
    }
    merged.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    out.metrics[metric] = merged;
  }

  // Cover-page share counts; multi-class companies report one row per class.
  const shareFacts = raw?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  const byFiling = new Map();
  for (const f of shareFacts) {
    if (f.end < since) continue;
    const k = `${f.accn}|${f.end}`;
    const prev = byFiling.get(k) || { end: f.end, filed: f.filed, val: 0 };
    prev.val += f.val;
    byFiling.set(k, prev);
  }
  out.shares = [...byFiling.values()]
    .map((s) => [null, s.end, s.val, s.filed])
    .sort((a, b) => (a[1] < b[1] ? -1 : 1));
  return out;
}

export class SecClient {
  constructor({ userAgent, baseUrl = 'https://data.sec.gov', limiter, fetchImpl = fetch }) {
    this.userAgent = userAgent;
    this.baseUrl = baseUrl;
    this.limiter = limiter;
    this.fetch = fetchImpl;
  }

  async companyFacts(cik, { priority = 5 } = {}) {
    const padded = String(cik).replace(/\D/g, '').padStart(10, '0');
    const url = `${this.baseUrl}/api/xbrl/companyfacts/CIK${padded}.json`;
    const run = async () => {
      let res;
      try {
        res = await this.fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        throw new ProviderError('network', `SEC request failed: ${err.message}`, { source: 'sec' });
      }
      if (res.status === 404) throw new ProviderError('not_found', `No XBRL facts for CIK ${padded}`, { status: 404, source: 'sec' });
      if (res.status === 429) throw new ProviderError('rate_limited', 'SEC rate limit', { status: 429, source: 'sec' });
      if (!res.ok) throw new ProviderError('http', `SEC HTTP ${res.status}`, { status: res.status, source: 'sec' });
      return compactCompanyFacts(await res.json());
    };
    return this.limiter.schedule(run, { priority, key: `sec:${padded}` });
  }
}
