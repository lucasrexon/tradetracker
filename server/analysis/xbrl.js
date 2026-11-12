/**
 * Point-in-time fundamentals from compact XBRL facts.
 *
 * 10-Qs report three-month and year-to-date values; cash flow statements only
 * year-to-date; Q4 is never reported on its own. We rebuild discrete quarters
 * by differencing cumulative values that share a start date, then sum four
 * consecutive quarters for trailing-twelve-month (TTM) figures.
 *
 * Every function takes an `asOf` date (YYYY-MM-DD) and ignores facts filed
 * after it, so the same code answers "what did the filings say when I entered
 * this trade?" and "what do they say now?".
 */

const DAY = 86_400_000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a, b) => (toMs(b) - toMs(a)) / DAY;
const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
const isQuarterSpan = (span) => span >= 75 && span <= 105;

/** @param {Array<[string|null,string,number,string]>} facts */
export function deriveQuarters(facts = [], asOf) {
  const latestByPeriod = new Map();
  for (const [start, end, val, filed] of facts) {
    if (!start || (asOf && filed > asOf)) continue;
    const k = `${start}|${end}`;
    const prev = latestByPeriod.get(k);
    if (!prev || filed > prev.filed) latestByPeriod.set(k, { start, end, val, filed });
  }

  const groups = new Map();
  for (const f of latestByPeriod.values()) {
    if (!groups.has(f.start)) groups.set(f.start, []);
    groups.get(f.start).push(f);
  }

  const quarters = [];
  const put = (q) => {
    if (!isQuarterSpan(daysBetween(q.start, q.end) + 1)) return;
    const i = quarters.findIndex((x) => Math.abs(daysBetween(x.end, q.end)) <= 10);
    if (i < 0) return void quarters.push(q);
    const cur = quarters[i];
    const better = (cur.derived && !q.derived) || (cur.derived === q.derived && q.filed > cur.filed);
    if (better) quarters[i] = q;
  };

  for (const list of groups.values()) {
    list.sort((a, b) => (a.end < b.end ? -1 : 1));
    let prev = null;
    for (const f of list) {
      const span = daysBetween(f.start, f.end) + 1;
      if (span > 380) {
        prev = null;
        continue;
      }
      if (!prev) {
        put({ start: f.start, end: f.end, val: f.val, filed: f.filed, derived: false });
      } else {
        put({
          start: addDays(prev.end, 1),
          end: f.end,
          val: f.val - prev.val,
          filed: f.filed > prev.filed ? f.filed : prev.filed,
          derived: true,
        });
      }
      prev = f;
    }
  }
  return quarters.sort((a, b) => (a.end < b.end ? -1 : 1));
}

/** Sum of the four consecutive quarters ending at index `i`. */
export function trailingSum(quarters, i) {
  if (i < 3 || i >= quarters.length) return null;
  const slice = quarters.slice(i - 3, i + 1);
  for (let k = 1; k < slice.length; k++) {
    if (Math.abs(daysBetween(slice[k - 1].end, slice[k].start)) > 12) return null;
  }
  return {
    val: slice.reduce((s, q) => s + q.val, 0),
    end: slice[3].end,
    filed: slice.reduce((m, q) => (q.filed > m ? q.filed : m), ''),
  };
}

function latestAnnual(facts = [], asOf) {
  let best = null;
  for (const [start, end, val, filed] of facts) {
    if (!start || (asOf && filed > asOf)) continue;
    const span = daysBetween(start, end) + 1;
    if (span < 350 || span > 380) continue;
    if (!best || end > best.end || (end === best.end && filed > best.filed)) best = { val, end, filed };
  }
  return best;
}

/**
 * TTM now and one year earlier for a duration metric.
 * Falls back to the latest annual figure when quarters can't be rebuilt.
 */
export function ttmPair(facts = [], asOf) {
  const q = deriveQuarters(facts, asOf);
  const n = q.length;
  const now = trailingSum(q, n - 1);
  if (!now) {
    const fy = latestAnnual(facts, asOf);
    return { now: fy && { ...fy, annualOnly: true }, prior: null, quarters: q };
  }
  const targetEnd = addDays(now.end, -364);
  const j = q.findIndex((x) => Math.abs(daysBetween(x.end, targetEnd)) <= 20);
  const prior = j >= 0 ? trailingSum(q, j) : null;
  return { now, prior, quarters: q };
}

/** Latest-quarter YoY growth and the same figure one quarter earlier. */
export function quarterlyYoY(quarters) {
  const yoyAt = (i) => {
    if (i < 0) return null;
    const cur = quarters[i];
    const target = addDays(cur.end, -364);
    const prev = quarters.find((x) => Math.abs(daysBetween(x.end, target)) <= 20);
    if (!prev || prev.val <= 0) return null;
    return cur.val / prev.val - 1;
  };
  const n = quarters.length;
  return { latest: yoyAt(n - 1), previous: yoyAt(n - 2) };
}

/** Latest balance-sheet value known at `asOf`, optionally near a target date. */
export function instant(facts = [], asOf, nearDate) {
  let best = null;
  for (const [, end, val, filed] of facts) {
    if (asOf && filed > asOf) continue;
    if (nearDate) {
      const dist = Math.abs(daysBetween(end, nearDate));
      if (dist > 45) continue;
      if (!best || dist < best.dist || (dist === best.dist && filed > best.filed)) best = { val, end, filed, dist };
    } else if (!best || end > best.end || (end === best.end && filed > best.filed)) {
      best = { val, end, filed };
    }
  }
  return best;
}

const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

/**
 * Everything the pillar analyses need from the filings, as known on `asOf`.
 * Returns null if the company has no usable statements (ETFs, foreign filers).
 */
export function fundamentalsSnapshot(compact, asOf) {
  const m = compact?.metrics;
  if (!m) return null;

  const rev = ttmPair(m.revenue, asOf);
  const ni = ttmPair(m.netIncome, asOf);
  if (!rev.now && !ni.now) return null;

  const gp = ttmPair(m.grossProfit, asOf);
  const op = ttmPair(m.operatingIncome, asOf);
  const ocf = ttmPair(m.operatingCashFlow, asOf);
  const capex = ttmPair(m.capex, asOf);

  const equity = instant(m.equity, asOf);
  const periodEnd = equity?.end || rev.now?.end || ni.now?.end;
  const equityYearAgo = periodEnd ? instant(m.equity, asOf, addDays(periodEnd, -365)) : null;
  let liabilities = instant(m.liabilities, asOf);
  if (!liabilities || (periodEnd && liabilities.end < periodEnd)) {
    const le = instant(m.liabilitiesAndEquity, asOf);
    if (le && equity && le.end === equity.end) liabilities = { val: le.val - equity.val, end: le.end, filed: le.filed };
  }

  const revNow = rev.now?.val ?? null;
  const niNow = ni.now?.val ?? null;
  const revYoY = quarterlyYoY(rev.quarters);
  const filedDates = [rev.now, ni.now, equity].filter(Boolean).map((x) => x.filed);

  return {
    asOf: asOf || null,
    periodEnd: periodEnd || null,
    latestFiled: filedDates.sort().at(-1) || null,
    annualOnly: !!rev.now?.annualOnly,
    revenue: revNow,
    revenuePrior: rev.prior?.val ?? null,
    netIncome: niNow,
    netIncomePrior: ni.prior?.val ?? null,
    grossProfit: gp.now?.val ?? null,
    operatingIncome: op.now?.val ?? null,
    operatingCashFlow: ocf.now?.val ?? null,
    capex: capex.now?.val ?? null,
    netMarginPrior: ratio(ni.prior?.val, rev.prior?.val),
    revenueGrowthQ: revYoY.latest,
    revenueGrowthQPrev: revYoY.previous,
    equity: equity?.val ?? null,
    equityYearAgo: equityYearAgo?.val ?? null,
    liabilities: liabilities?.val ?? null,
    assetsCurrent: instant(m.assetsCurrent, asOf)?.val ?? null,
    liabilitiesCurrent: instant(m.liabilitiesCurrent, asOf)?.val ?? null,
    cash: instant(m.cash, asOf)?.val ?? null,
    longTermDebt: instant(m.longTermDebt, asOf)?.val ?? null,
    shares: instant(compact.shares, asOf)?.val ?? null,
  };
}
