import { blend, scale, signalFor, fmt } from './scoring.js';

/**
 * The five fundamental analyses used to check a trade:
 *   1. Valuation       – what you pay for the earnings, sales and cash flow
 *   2. Growth          – is the business getting bigger and more profitable
 *   3. Profitability   – margins and return on equity
 *   4. Financial health– leverage, liquidity and earnings quality
 *   5. News & sentiment– what the news flow and short sellers are saying
 * Each returns a 0-100 score (higher = fundamentally stronger company).
 */
export const PILLARS = [
  { key: 'valuation', label: 'Valuation' },
  { key: 'growth', label: 'Growth' },
  { key: 'profitability', label: 'Profitability' },
  { key: 'health', label: 'Financial health' },
  { key: 'sentiment', label: 'News & sentiment' },
];

const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const metric = (label, value, display, score, weight, hint) => ({
  label,
  value,
  display,
  score: score == null ? null : Math.round(score),
  weight,
  hint,
});

function finish(key, metrics, notes, extra = {}) {
  const score = blend(metrics);
  const label = PILLARS.find((p) => p.key === key).label;
  const shown = metrics.filter((m) => m.score != null);
  return {
    key,
    label,
    score,
    signal: signalFor(score),
    summary: shown.length ? shown.slice(0, 3).map((m) => `${m.label} ${m.display}`).join(' · ') : 'Not enough data yet',
    metrics: metrics.map(({ weight, ...m }) => m),
    notes: notes.filter(Boolean),
    ...extra,
  };
}

const unavailable = (key, reason) => ({ ...finish(key, [], []), summary: reason, available: false });

export function valuationPillar(f, marketCap, rates) {
  if (!f || !marketCap) return unavailable('valuation', f ? 'Waiting for market cap' : 'No financial statements on file');
  const pe = f.netIncome > 0 ? marketCap / f.netIncome : null;
  const ps = ratio(marketCap, f.revenue);
  const fcf = f.operatingCashFlow != null ? f.operatingCashFlow - (f.capex || 0) : null;
  const fcfYield = ratio(fcf, marketCap);
  const niGrowth = f.netIncomePrior > 0 && f.netIncome > 0 ? f.netIncome / f.netIncomePrior - 1 : null;
  const peg = pe && niGrowth > 0.01 ? pe / (niGrowth * 100) : null;
  const y10 = rates?.y10 ?? null;
  const spread = pe && y10 != null ? 1 / pe - y10 / 100 : null;

  const metrics = [
    metric('P/E', pe, pe ? fmt.mult(pe) : f.netIncome != null ? 'n/m (loss)' : '—',
      pe ? scale(pe, [[8, 92], [15, 80], [22, 64], [30, 50], [45, 34], [70, 20], [120, 10]]) : f.netIncome != null ? 15 : null,
      0.3, 'Market cap ÷ trailing-twelve-month net income'),
    metric('P/S', ps, fmt.mult(ps), scale(ps, [[1, 88], [3, 72], [6, 56], [10, 42], [20, 25], [40, 12]]), 0.15,
      'Market cap ÷ TTM revenue'),
    metric('FCF yield', fcfYield, fmt.pctPlain(fcfYield),
      scale(fcfYield, [[-0.02, 15], [0, 30], [0.02, 50], [0.04, 68], [0.06, 82], [0.1, 92]]), 0.25,
      '(Operating cash flow − capex) ÷ market cap'),
    metric('PEG', peg, fmt.num(peg), scale(peg, [[0.5, 90], [1, 75], [1.5, 62], [2.5, 45], [4, 28], [8, 15]]), 0.15,
      'P/E ÷ earnings growth (%)'),
    metric('Earnings yield − 10Y', spread, spread == null ? '—' : `${spread >= 0 ? '+' : ''}${(spread * 100).toFixed(2)} pts`,
      scale(spread, [[-0.04, 18], [-0.02, 32], [0, 48], [0.02, 66], [0.04, 82], [0.07, 92]]), 0.15,
      'How much the stock earns vs. a risk-free Treasury'),
  ];
  const notes = [
    pe && pe > 40 && `Priced at ${fmt.mult(pe, 0)} earnings: the market already expects a lot of growth.`,
    pe && pe < 14 && `Only ${fmt.mult(pe, 0)} earnings: cheap unless profits are about to fall.`,
    spread != null && spread < 0 && `Earnings yield is below the ${y10.toFixed(2)}% 10-year Treasury.`,
    fcfYield != null && fcfYield < 0 && 'Burning cash after capital spending.',
  ];
  return finish('valuation', metrics, notes, { available: true });
}

export function growthPillar(f) {
  if (!f) return unavailable('growth', 'No financial statements on file');
  const rg = f.revenuePrior > 0 ? f.revenue / f.revenuePrior - 1 : null;
  let ni = null;
  let niScore = null;
  let niDisplay = '—';
  if (f.netIncome != null && f.netIncomePrior != null) {
    if (f.netIncomePrior > 0) {
      ni = f.netIncome / f.netIncomePrior - 1;
      niScore = scale(ni, [[-0.4, 10], [-0.15, 25], [0, 42], [0.1, 60], [0.25, 76], [0.5, 90]]);
      niDisplay = fmt.pct(ni);
    } else if (f.netIncome > 0) {
      niScore = 75;
      niDisplay = 'turned profitable';
    } else {
      niScore = f.netIncome > f.netIncomePrior ? 35 : 20;
      niDisplay = f.netIncome > f.netIncomePrior ? 'loss narrowing' : 'loss widening';
    }
  }
  const accel = f.revenueGrowthQ != null && f.revenueGrowthQPrev != null ? f.revenueGrowthQ - f.revenueGrowthQPrev : null;
  const metrics = [
    metric('Revenue', rg, fmt.pct(rg), scale(rg, [[-0.15, 10], [-0.05, 25], [0, 40], [0.05, 55], [0.1, 68], [0.2, 82], [0.35, 92]]),
      0.45, 'TTM revenue vs. the prior TTM'),
    metric('Earnings', ni, niDisplay, niScore, 0.4, 'TTM net income vs. the prior TTM'),
    metric('Momentum', accel, accel == null ? '—' : `${accel >= 0 ? '+' : ''}${(accel * 100).toFixed(1)} pts`,
      scale(accel, [[-0.1, 25], [-0.03, 40], [0, 50], [0.03, 62], [0.1, 78]]), 0.15,
      'Change in quarterly YoY revenue growth (acceleration)'),
  ];
  const notes = [
    rg != null && rg < 0 && 'Revenue is shrinking year over year.',
    rg != null && rg > 0.25 && `Revenue growing ${fmt.pct(rg, 0)} a year.`,
    accel != null && accel < -0.05 && 'Growth is decelerating quarter over quarter.',
    accel != null && accel > 0.05 && 'Growth is accelerating.',
  ];
  return finish('growth', metrics, notes, { available: true });
}

export function profitabilityPillar(f) {
  if (!f) return unavailable('profitability', 'No financial statements on file');
  const nm = ratio(f.netIncome, f.revenue);
  const om = ratio(f.operatingIncome, f.revenue);
  const gm = ratio(f.grossProfit, f.revenue);
  const avgEq = f.equity > 0 && f.equityYearAgo > 0 ? (f.equity + f.equityYearAgo) / 2 : f.equity > 0 ? f.equity : null;
  const roe = ratio(f.netIncome, avgEq);
  const trend = nm != null && f.netMarginPrior != null ? nm - f.netMarginPrior : null;
  const metrics = [
    metric('Net margin', nm, fmt.pctPlain(nm), scale(nm, [[-0.2, 8], [-0.05, 20], [0, 32], [0.05, 48], [0.1, 62], [0.2, 78], [0.3, 90]]), 0.3),
    metric('Operating margin', om, fmt.pctPlain(om), scale(om, [[-0.1, 12], [0, 30], [0.08, 50], [0.15, 65], [0.25, 80], [0.35, 90]]), 0.25),
    metric('Gross margin', gm, fmt.pctPlain(gm), scale(gm, [[0.15, 25], [0.3, 45], [0.45, 62], [0.6, 78], [0.75, 90]]), 0.15),
    metric('ROE', roe, roe == null && f.equity != null && f.equity <= 0 ? 'n/m (neg. equity)' : fmt.pctPlain(roe),
      scale(roe, [[-0.1, 12], [0, 30], [0.08, 48], [0.15, 65], [0.25, 80], [0.4, 90]]), 0.2, 'Net income ÷ average equity'),
    metric('Margin trend', trend, trend == null ? '—' : `${trend >= 0 ? '+' : ''}${(trend * 100).toFixed(1)} pts`,
      scale(trend, [[-0.05, 25], [-0.01, 42], [0, 50], [0.01, 58], [0.05, 75]]), 0.1, 'Net margin vs. a year ago'),
  ];
  const notes = [
    nm != null && nm < 0 && 'Company is losing money on a trailing basis.',
    trend != null && trend < -0.02 && 'Margins are compressing.',
    trend != null && trend > 0.02 && 'Margins are expanding.',
  ];
  return finish('profitability', metrics, notes, { available: true });
}

export function healthPillar(f) {
  if (!f) return unavailable('health', 'No financial statements on file');
  const de = f.equity > 0 ? ratio(f.liabilities, f.equity) : null;
  const cr = ratio(f.assetsCurrent, f.liabilitiesCurrent);
  const netDebt = f.longTermDebt != null || f.cash != null ? (f.longTermDebt || 0) - (f.cash || 0) : null;
  let levScore = null;
  let levDisplay = '—';
  let lev = null;
  if (netDebt != null) {
    if (netDebt <= 0) {
      levScore = 88;
      levDisplay = 'net cash';
    } else if (f.operatingCashFlow > 0) {
      lev = netDebt / f.operatingCashFlow;
      levScore = scale(lev, [[0.5, 80], [1.5, 68], [3, 50], [5, 32], [8, 18]]);
      levDisplay = `${lev.toFixed(1)} yrs`;
    } else {
      levScore = 15;
      levDisplay = 'debt, no cash flow';
    }
  }
  let quality = null;
  let qScore = null;
  if (f.operatingCashFlow != null && f.netIncome != null) {
    if (f.netIncome > 0) {
      quality = f.operatingCashFlow / f.netIncome;
      qScore = scale(quality, [[0.5, 25], [0.8, 45], [1, 62], [1.2, 75], [1.5, 85]]);
    } else qScore = f.operatingCashFlow > 0 ? 60 : 15;
  }
  const metrics = [
    metric('Liabilities/equity', de, f.equity != null && f.equity <= 0 ? 'neg. equity' : fmt.mult(de, 2),
      f.equity != null && f.equity <= 0 ? 22 : scale(de, [[0.3, 90], [0.7, 78], [1.2, 64], [2, 48], [3.5, 32], [6, 18]]), 0.3),
    metric('Current ratio', cr, fmt.num(cr), scale(cr, [[0.6, 18], [0.8, 32], [1, 48], [1.5, 68], [2, 80], [3, 88]]), 0.25,
      'Current assets ÷ current liabilities'),
    metric('Net debt payback', lev, levDisplay, levScore, 0.25, '(Long-term debt − cash) ÷ operating cash flow'),
    metric('Cash conversion', quality, quality == null ? (qScore == null ? '—' : f.operatingCashFlow > 0 ? 'cash positive' : 'cash negative') : fmt.mult(quality, 2),
      qScore, 0.2, 'Operating cash flow ÷ net income'),
  ];
  const notes = [
    f.equity != null && f.equity <= 0 && 'Negative shareholder equity (often from buybacks, but leaves little cushion).',
    cr != null && cr < 1 && 'Short-term liabilities exceed short-term assets.',
    quality != null && quality < 0.7 && 'Profits are not turning into cash.',
  ];
  return finish('health', metrics, notes, { available: true });
}

const SENT = { positive: 1, neutral: 0, negative: -1 };

/** News sentiment (recency-weighted) blended with short-interest pressure. */
export function sentimentPillar(news = [], shortInterest = [], asOf = new Date().toISOString()) {
  const asOfMs = Date.parse(asOf);
  const window = news.filter((a) => {
    const t = Date.parse(a.publishedAt);
    return a.sentiment && t <= asOfMs && asOfMs - t <= 30 * 86_400_000;
  });
  let ws = 0;
  let w = 0;
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const a of window) {
    const age = (asOfMs - Date.parse(a.publishedAt)) / 86_400_000;
    const weight = Math.exp(-age / 5);
    ws += weight * SENT[a.sentiment];
    w += weight;
    counts[a.sentiment]++;
  }
  const tone = window.length ? ws / (w + 0.6) : null;
  const newsScore = tone == null ? null : 50 + 45 * tone;

  const si = shortInterest.filter((s) => s.date <= asOf.slice(0, 10));
  const latest = si[0];
  const prev = si[1];
  let siScore = null;
  let siChange = null;
  if (latest?.daysToCover != null) {
    siScore = scale(latest.daysToCover, [[1, 62], [3, 52], [6, 40], [10, 28], [15, 18]]);
    if (prev?.shortInterest) {
      siChange = latest.shortInterest / prev.shortInterest - 1;
      if (siChange > 0.15) siScore -= 6;
      if (siChange < -0.15) siScore += 4;
    }
  }
  const last72h = news.filter((a) => {
    const t = Date.parse(a.publishedAt);
    return t <= asOfMs && asOfMs - t <= 72 * 3600_000;
  }).length;

  const metrics = [
    metric('News tone', tone, tone == null ? 'no recent coverage' : `${tone >= 0 ? '+' : ''}${tone.toFixed(2)}`, newsScore, 0.75,
      'Recency-weighted sentiment of the last 30 days (−1 … +1)'),
    metric('Days to cover', latest?.daysToCover ?? null,
      latest ? `${latest.daysToCover.toFixed(1)}d${siChange != null ? ` (${fmt.pct(siChange, 0)})` : ''}` : '—', siScore, 0.25,
      'Short interest ÷ average daily volume'),
    metric('Articles (72h)', last72h, String(last72h), null, 0),
  ];
  const negatives = window.filter((a) => a.sentiment === 'negative').slice(0, 1);
  const positives = window.filter((a) => a.sentiment === 'positive').slice(0, 1);
  const notes = [
    window.length && `${counts.positive} positive · ${counts.neutral} neutral · ${counts.negative} negative in 30 days.`,
    ...negatives.map((a) => `Bearish: “${a.title}”`),
    ...positives.map((a) => `Bullish: “${a.title}”`),
    latest?.daysToCover > 8 && 'Heavy short interest: crowded bet against the stock.',
  ];
  const result = finish('sentiment', metrics, notes, { available: window.length > 0 || siScore != null, counts, last72h });
  if (window.length === 0 && siScore == null) result.summary = 'No recent coverage';
  return result;
}

export function analyzePillars({ fundamentals, marketCap, rates, news, shortInterest, asOf }) {
  return [
    valuationPillar(fundamentals, marketCap, rates),
    growthPillar(fundamentals),
    profitabilityPillar(fundamentals),
    healthPillar(fundamentals),
    sentimentPillar(news, shortInterest, asOf),
  ];
}

export function composite(pillars, weights = {}) {
  let s = 0;
  let w = 0;
  let n = 0;
  for (const p of pillars) {
    if (p.score == null) continue;
    const wt = weights[p.key] ?? 1;
    s += p.score * wt;
    w += wt;
    n++;
  }
  return { score: n >= 2 && w ? Math.round(s / w) : null, coverage: n };
}
