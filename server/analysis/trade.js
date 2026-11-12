import { clamp } from './scoring.js';

const DAY = 86_400_000;
const fmtDate = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Turn a company score into "how well do fundamentals support this position". */
export const orient = (score, direction) => (score == null ? null : direction === 'short' ? 100 - score : score);

export function priceOn(bars, date) {
  if (!bars?.length || !date) return null;
  let found = null;
  for (const b of bars) {
    if (b.date <= date) found = b;
    else break;
  }
  return found;
}

function annualisedVol(bars, n = 20) {
  if (!bars || bars.length < n + 1) return null;
  const tail = bars.slice(-(n + 1));
  const rets = [];
  for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i].c / tail[i - 1].c));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

function firstBreach(bars, fromDate, toDate, test) {
  for (const b of bars || []) {
    if (b.date <= fromDate) continue;
    if (toDate && b.date > toDate) break;
    if (test(b)) return b.date;
  }
  return null;
}

function verdictFor({ closed, alignment, delta, stopHit, targetHit, pnlPct, sinceExit }) {
  if (closed) {
    const label = pnlPct >= 0 ? 'Closed in profit' : 'Closed at a loss';
    let detail = '';
    if (sinceExit != null) {
      const word = sinceExit >= 0 ? 'risen' : 'fallen';
      detail = `Price has ${word} ${Math.abs(sinceExit * 100).toFixed(1)}% since you exited.`;
    }
    return { code: 'closed', label, detail };
  }
  if (stopHit) return { code: 'stop', label: 'Stop breached', detail: `Price traded through your stop on ${fmtDate(stopHit)}. Respect the exit plan.` };
  if (targetHit) return { code: 'target', label: 'Target reached', detail: `Hit your target on ${fmtDate(targetHit)}. Consider taking profit or trailing the stop.` };
  if (alignment == null) return { code: 'pending', label: 'Gathering data', detail: 'Waiting for enough fundamentals to judge the thesis.' };
  const drift = delta != null && delta <= -8 ? ' Fundamentals have slipped since entry.' : delta != null && delta >= 8 ? ' Fundamentals have improved since entry.' : '';
  if (alignment >= 65) return { code: 'strong', label: 'Thesis strong', detail: `Fundamentals clearly support the position.${drift}` };
  if (alignment >= 50) return { code: 'intact', label: 'Thesis intact', detail: `Fundamentals lean your way. Keep monitoring.${drift}` };
  if (alignment >= 38) return { code: 'weakening', label: 'Thesis weakening', detail: `Fundamentals are mixed or turning against you. Review the position.${drift}` };
  return { code: 'broken', label: 'Thesis broken', detail: `Fundamentals contradict the position. Consider exiting.${drift}` };
}

/**
 * Full state of one trade: P&L, risk levels, the five pillar analyses now and
 * at entry/exit, a verdict and any alerts.
 */
export function evaluateTrade(trade, ctx, now = new Date()) {
  const { bars = [], details = null, pillarsNow = [], compositeNow = { score: null }, pillarsAtEntry = [],
    compositeAtEntry = { score: null }, pillarsAtExit = null, compositeAtExit = null, news = [], fundamentals = null,
    live = null } = ctx;

  const dir = trade.direction === 'short' ? -1 : 1;
  const closed = trade.exitPrice != null && trade.exitDate != null;
  const lastBar = bars.at(-1) || null;
  const lastPrice = live?.price ?? lastBar?.c ?? null;
  const lastDate = live?.date ?? lastBar?.date ?? null;
  const prevBar = bars.length > 1 ? bars.at(live ? -1 : -2) : null;
  const dayChange = lastPrice != null && prevBar ? lastPrice / prevBar.c - 1 : null;
  const mark = closed ? trade.exitPrice : lastPrice;

  const pnlPct = mark != null ? (dir * (mark - trade.entryPrice)) / trade.entryPrice : null;
  const pnlAbs = mark != null ? dir * (mark - trade.entryPrice) * trade.quantity : null;
  const risk = trade.stopLoss != null ? Math.abs(trade.entryPrice - trade.stopLoss) : null;
  const rMultiple = risk && mark != null ? (dir * (mark - trade.entryPrice)) / risk : null;
  const endDate = closed ? trade.exitDate : now.toISOString().slice(0, 10);
  const holdingDays = Math.max(0, Math.round((Date.parse(endDate) - Date.parse(trade.entryDate)) / DAY));
  const targetProgress =
    trade.takeProfit != null && mark != null && trade.takeProfit !== trade.entryPrice
      ? clamp((mark - trade.entryPrice) / (trade.takeProfit - trade.entryPrice), -1, 1.5)
      : null;

  const isLong = dir === 1;
  const stopHit =
    !closed && trade.stopLoss != null
      ? firstBreach(bars, trade.entryDate, null, (b) => (isLong ? b.l <= trade.stopLoss : b.h >= trade.stopLoss)) ||
        (lastPrice != null && (isLong ? lastPrice <= trade.stopLoss : lastPrice >= trade.stopLoss) ? lastDate : null)
      : null;
  const targetHit =
    !closed && trade.takeProfit != null
      ? firstBreach(bars, trade.entryDate, null, (b) => (isLong ? b.h >= trade.takeProfit : b.l <= trade.takeProfit))
      : null;

  const alignment = orient(compositeNow.score, trade.direction);
  const alignmentAtEntry = orient(compositeAtEntry.score, trade.direction);
  const alignmentAtExit = compositeAtExit ? orient(compositeAtExit.score, trade.direction) : null;
  const delta = alignment != null && alignmentAtEntry != null ? alignment - alignmentAtEntry : null;
  const sinceExit = closed && lastPrice != null ? lastPrice / trade.exitPrice - 1 : null;

  const verdict = verdictFor({ closed, alignment, delta, stopHit, targetHit, pnlPct, sinceExit });

  const alerts = [];
  if (!closed) {
    if (stopHit) alerts.push({ level: 'danger', text: `Stop ${trade.stopLoss} breached on ${fmtDate(stopHit)}.` });
    if (targetHit) alerts.push({ level: 'good', text: `Target ${trade.takeProfit} reached on ${fmtDate(targetHit)}.` });
    if (pnlPct != null && pnlPct <= -0.08 && trade.stopLoss == null) {
      alerts.push({ level: 'warn', text: `Down ${(pnlPct * 100).toFixed(1)}% with no stop set.` });
    }
    const adverse = isLong ? 'negative' : 'positive';
    const recentAdverse = news.find(
      (a) => a.sentiment === adverse && now - Date.parse(a.publishedAt) < 48 * 3600_000,
    );
    if (recentAdverse) alerts.push({ level: 'warn', text: `Adverse news: “${recentAdverse.title}”`, url: recentAdverse.url });
    for (const p of pillarsNow) {
      const then = pillarsAtEntry.find((x) => x.key === p.key);
      if (!then || then.score == null || p.score == null) continue;
      const nowO = orient(p.score, trade.direction);
      const thenO = orient(then.score, trade.direction);
      if (thenO >= 55 && nowO <= 40) alerts.push({ level: 'warn', text: `${p.label} has turned against the trade since entry.` });
      if (thenO <= 45 && nowO >= 60) alerts.push({ level: 'good', text: `${p.label} has turned in your favour since entry.` });
    }
    if (fundamentals?.latestFiled && fundamentals.latestFiled > trade.entryDate) {
      const days = (now - Date.parse(fundamentals.latestFiled)) / DAY;
      if (days <= 14) alerts.push({ level: 'info', text: `New filing on ${fmtDate(fundamentals.latestFiled)}: fundamentals refreshed.` });
    }
  }

  const seriesStart = new Date(Date.parse(trade.entryDate) - 45 * DAY).toISOString().slice(0, 10);
  const series = bars.filter((b) => b.date >= seriesStart).map((b) => [b.date, b.c]);
  if (live?.price && lastDate && series.at(-1)?.[0] !== lastDate) series.push([lastDate, live.price]);

  return {
    ...trade,
    status: closed ? 'closed' : 'open',
    name: details?.name || trade.ticker,
    sector: details?.sector || null,
    price: { last: lastPrice, date: lastDate, dayChange, live: !!live, series },
    pnl: { pct: pnlPct, abs: pnlAbs, r: rMultiple, holdingDays, targetProgress, sinceExit },
    positionValue: mark != null ? Math.abs(mark * trade.quantity) : Math.abs(trade.entryPrice * trade.quantity),
    pillars: pillarsNow,
    pillarsAtEntry,
    pillarsAtExit,
    composite: compositeNow.score,
    coverage: compositeNow.coverage ?? 0,
    alignment,
    alignmentAtEntry,
    alignmentAtExit,
    delta,
    verdict,
    alerts,
    volatility: annualisedVol(bars),
    activity: pillarsNow.find((p) => p.key === 'sentiment')?.last72h ?? 0,
    news: news.slice(0, 20),
    fundamentalsAsOf: fundamentals?.periodEnd || null,
  };
}
