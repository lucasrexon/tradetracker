import test from 'node:test';
import assert from 'node:assert/strict';
import { scale } from '../server/analysis/scoring.js';
import { analyzePillars, composite, sentimentPillar, valuationPillar } from '../server/analysis/pillars.js';

const strong = {
  revenue: 100e9, revenuePrior: 80e9, netIncome: 25e9, netIncomePrior: 18e9,
  grossProfit: 60e9, operatingIncome: 32e9, operatingCashFlow: 30e9, capex: 4e9,
  netMarginPrior: 0.225, revenueGrowthQ: 0.27, revenueGrowthQPrev: 0.22,
  equity: 90e9, equityYearAgo: 75e9, liabilities: 60e9, assetsCurrent: 70e9, liabilitiesCurrent: 30e9,
  cash: 40e9, longTermDebt: 20e9, shares: 1e9,
};
const weak = {
  revenue: 10e9, revenuePrior: 11.5e9, netIncome: -1.2e9, netIncomePrior: 0.3e9,
  grossProfit: 2e9, operatingIncome: -0.9e9, operatingCashFlow: -0.5e9, capex: 0.8e9,
  netMarginPrior: 0.026, revenueGrowthQ: -0.18, revenueGrowthQPrev: -0.08,
  equity: 2e9, equityYearAgo: 3.5e9, liabilities: 14e9, assetsCurrent: 3e9, liabilitiesCurrent: 5e9,
  cash: 0.5e9, longTermDebt: 6e9, shares: 1e9,
};
const asOf = '2026-11-12T12:00:00Z';
const article = (sentiment, hoursAgo) => ({
  id: `${sentiment}${hoursAgo}`, title: `${sentiment} story`, sentiment,
  publishedAt: new Date(Date.parse(asOf) - hoursAgo * 3600_000).toISOString(),
});

test('scale interpolates and clamps', () => {
  const pts = [[0, 0], [10, 100]];
  assert.equal(scale(5, pts), 50);
  assert.equal(scale(-3, pts), 0);
  assert.equal(scale(30, pts), 100);
  assert.equal(scale(null, pts), null);
});

test('a strong company outscores a weak one on every statement pillar', () => {
  const s = analyzePillars({ fundamentals: strong, marketCap: 500e9, rates: { y10: 4.2 }, news: [], shortInterest: [], asOf });
  const w = analyzePillars({ fundamentals: weak, marketCap: 8e9, rates: { y10: 4.2 }, news: [], shortInterest: [], asOf });
  for (const key of ['growth', 'profitability', 'health']) {
    const a = s.find((p) => p.key === key).score;
    const b = w.find((p) => p.key === key).score;
    assert.ok(a > b + 20, `${key}: ${a} vs ${b}`);
  }
  assert.equal(s.find((p) => p.key === 'growth').signal, 'bullish');
  assert.equal(w.find((p) => p.key === 'health').signal, 'bearish');
});

test('valuation reflects price paid', () => {
  const cheap = valuationPillar(strong, 250e9, { y10: 4 }).score;
  const rich = valuationPillar(strong, 2500e9, { y10: 4 }).score;
  assert.ok(cheap > rich + 25, `${cheap} vs ${rich}`);
});

test('loss-making company gets n/m P/E rather than a negative multiple', () => {
  const v = valuationPillar(weak, 8e9, { y10: 4 });
  assert.equal(v.metrics.find((m) => m.label === 'P/E').display, 'n/m (loss)');
});

test('missing statements make pillars unavailable, not zero', () => {
  const p = analyzePillars({ fundamentals: null, marketCap: null, news: [], shortInterest: [], asOf });
  assert.equal(p.slice(0, 4).every((x) => x.score === null && x.signal === 'unknown'), true);
  assert.equal(composite(p).score, null);
});

test('news sentiment is recency-weighted', () => {
  const recentBad = sentimentPillar([article('negative', 2), article('positive', 24 * 20)], [], asOf);
  const recentGood = sentimentPillar([article('positive', 2), article('negative', 24 * 20)], [], asOf);
  assert.ok(recentGood.score > 60 && recentBad.score < 40, `${recentGood.score} / ${recentBad.score}`);
});

test('news published after the as-of date is ignored', () => {
  const p = sentimentPillar([article('negative', -5)], [], asOf);
  assert.equal(p.score, null);
});

test('heavy short interest drags sentiment', () => {
  const light = sentimentPillar([], [{ date: '2026-10-30', shortInterest: 1, daysToCover: 1 }], asOf).score;
  const heavy = sentimentPillar([], [{ date: '2026-10-30', shortInterest: 1, daysToCover: 12 }], asOf).score;
  assert.ok(light > heavy);
});

test('composite needs at least two pillars', () => {
  assert.equal(composite([{ key: 'a', score: 80 }]).score, null);
  assert.equal(composite([{ key: 'a', score: 80 }, { key: 'b', score: 60 }]).score, 70);
});
