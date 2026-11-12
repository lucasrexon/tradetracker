import { priceOn } from './trade.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const sum = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** P&L of one trade as of the close on `date`, using that day's bar. */
function pnlOn(trade, date, bars) {
  if (trade.entryDate > date) return 0;
  const dir = trade.direction === 'short' ? -1 : 1;
  if (trade.exitDate && trade.exitDate <= date) return dir * (trade.exitPrice - trade.entryPrice) * trade.quantity;
  const bar = priceOn(bars, date);
  // Before the first close after entry, the position is worth what was paid.
  const mark = bar && bar.date >= trade.entryDate ? bar.c : trade.entryPrice;
  return dir * (mark - trade.entryPrice) * trade.quantity;
}

/**
 * Daily portfolio value: capital + deposits/withdrawals to date + every
 * trade's realized or open P&L at that day's close. The last point uses the
 * live evaluation so it always matches the headline value.
 */
export function equityCurve({ settings, trades, barsByTicker, today, equityNow, maxPoints = 320 }) {
  if (!trades.length && !settings?.startingCapital) return [];
  const earliest = trades.reduce((m, t) => (t.entryDate < m ? t.entryDate : m), today);
  const start = settings?.startDate && settings.startDate < earliest ? settings.startDate : isoDay(Date.parse(earliest) - DAY);
  const capitalFrom = settings?.startDate || start;
  const capital = Number(settings?.startingCapital) || 0;
  const flows = (settings?.flows || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));

  const dateSet = new Set();
  for (const bars of Object.values(barsByTicker)) for (const b of bars || []) if (b.date >= start && b.date <= today) dateSet.add(b.date);
  if (!dateSet.size) {
    for (let t = Date.parse(start); t <= Date.parse(today); t += DAY) {
      const wd = new Date(t).getUTCDay();
      if (wd && wd !== 6) dateSet.add(isoDay(t));
    }
  }
  dateSet.add(start);
  const dates = [...dateSet].sort();

  let points = dates.map((date) => {
    const funded = (date >= capitalFrom ? capital : 0) + sum(flows.filter((f) => f.date <= date), (f) => f.amount);
    const pnl = sum(trades, (t) => pnlOn(t, date, barsByTicker[t.ticker]));
    return [date, Math.round((funded + pnl) * 100) / 100];
  });
  if (equityNow != null) {
    if (points.at(-1)?.[0] === today) points.at(-1)[1] = Math.round(equityNow * 100) / 100;
    else points.push([today, Math.round(equityNow * 100) / 100]);
  }
  if (points.length > maxPoints) {
    const step = Math.ceil(points.length / maxPoints);
    points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }
  return points;
}

/** Largest peak-to-trough fall of the curve, in dollars and (when funded) percent. */
export function maxDrawdown(curve) {
  let peak = null;
  let worst = { abs: 0, pct: null, from: null, to: null };
  for (const [date, v] of curve) {
    if (!peak || v > peak.v) peak = { v, date };
    const abs = v - peak.v;
    if (abs < worst.abs) worst = { abs, pct: peak.v > 0 ? abs / peak.v : null, from: peak.date, to: date };
  }
  return worst;
}

/** Success rate and the stats around it, from closed trades. */
export function trackRecord(trades) {
  const closed = trades
    .filter((t) => t.status === 'closed' && t.pnl?.abs != null)
    .sort((a, b) => (a.exitDate < b.exitDate ? -1 : 1));
  const open = trades.filter((t) => t.status === 'open' && t.pnl?.abs != null);
  const wins = closed.filter((t) => t.pnl.abs > 0);
  const losses = closed.filter((t) => t.pnl.abs < 0);
  const grossWin = sum(wins, (t) => t.pnl.abs);
  const grossLoss = -sum(losses, (t) => t.pnl.abs);
  const withR = closed.filter((t) => t.pnl.r != null);

  let streak = null;
  for (let i = closed.length - 1; i >= 0; i--) {
    const kind = closed[i].pnl.abs > 0 ? 'win' : closed[i].pnl.abs < 0 ? 'loss' : 'flat';
    if (!streak) streak = { kind, count: 1 };
    else if (streak.kind === kind) streak.count++;
    else break;
  }

  const pick = (t) => t && { id: t.id, ticker: t.ticker, direction: t.direction, abs: t.pnl.abs, pct: t.pnl.pct };
  const byDirection = (dir) => {
    const list = closed.filter((t) => t.direction === dir);
    const w = list.filter((t) => t.pnl.abs > 0).length;
    return { count: list.length, wins: w, winRate: list.length ? w / list.length : null };
  };
  const sorted = closed.slice().sort((a, b) => b.pnl.abs - a.pnl.abs);

  return {
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    flat: closed.length - wins.length - losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? grossLoss / losses.length : null,
    avgWinPct: mean(wins.map((t) => t.pnl.pct)),
    avgLossPct: mean(losses.map((t) => t.pnl.pct)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    noLosses: closed.length > 0 && grossLoss === 0,
    expectancy: closed.length ? (grossWin - grossLoss) / closed.length : null,
    avgR: mean(withR.map((t) => t.pnl.r)),
    rCount: withR.length,
    avgHoldDays: mean(closed.map((t) => t.pnl.holdingDays)),
    best: pick(sorted[0]),
    worst: pick(sorted.length > 1 ? sorted.at(-1) : null),
    streak,
    long: byDirection('long'),
    short: byDirection('short'),
    openCount: open.length,
    openInProfit: open.filter((t) => t.pnl.abs > 0).length,
  };
}

/**
 * Everything the Account view shows. `trades` are evaluated trades (with
 * `pnl`, `status`, `positionValue`); `settings` is the saved capital setup.
 */
export function accountSummary({ settings, trades, barsByTicker = {}, today = isoDay(Date.now()) }) {
  const capital = Number(settings?.startingCapital) || 0;
  const flows = settings?.flows || [];
  const netFlows = sum(flows, (f) => f.amount);
  const contributed = capital + netFlows;
  const open = trades.filter((t) => t.status === 'open');
  const closed = trades.filter((t) => t.status === 'closed');
  const realized = sum(closed, (t) => t.pnl?.abs);
  const unrealized = sum(open, (t) => t.pnl?.abs);
  const equity = contributed + realized + unrealized;
  const longValue = sum(open.filter((t) => t.direction === 'long'), (t) => t.positionValue);
  const shortValue = sum(open.filter((t) => t.direction === 'short'), (t) => t.positionValue);
  const invested = longValue + shortValue;
  const hasCapital = capital > 0;
  // What you paid for the open positions that have a price since entry, and
  // how far they've moved from those entry prices.
  const priced = open.filter((t) => t.pnl?.pct != null);
  const costBasis = sum(priced, (t) => t.entryPrice * t.quantity);
  const openReturn = costBasis > 0 ? sum(priced, (t) => t.pnl.abs) / costBasis : null;
  const awaiting = open.filter((t) => t.price?.awaiting).map((t) => t.ticker);
  const curve = equityCurve({ settings, trades, barsByTicker, today, equityNow: equity });

  return {
    hasCapital,
    sample: !!settings?.sample,
    capital,
    startDate: settings?.startDate || null,
    flows,
    netFlows,
    contributed,
    equity,
    realized,
    unrealized,
    invested,
    costBasis,
    openReturn,
    awaiting,
    longValue,
    shortValue,
    available: hasCapital ? equity - invested : null,
    exposure: hasCapital && equity > 0 ? invested / equity : null,
    totalReturn: contributed > 0 ? (realized + unrealized) / contributed : null,
    curve,
    drawdown: maxDrawdown(curve),
    record: trackRecord(trades),
  };
}
