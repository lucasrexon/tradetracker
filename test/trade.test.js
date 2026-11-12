import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrade, orient } from '../server/analysis/trade.js';

const bars = [
  { date: '2026-09-01', c: 100, h: 101, l: 99 },
  { date: '2026-09-02', c: 104, h: 105, l: 99.5 },
  { date: '2026-09-03', c: 96, h: 104, l: 94 },
  { date: '2026-09-04', c: 110, h: 111, l: 95 },
];
const pillars = (score) => ['valuation', 'growth', 'profitability', 'health', 'sentiment'].map((key) => ({ key, label: key, score }));
const now = new Date('2026-09-05T12:00:00Z');
const base = { id: 't1', ticker: 'X', direction: 'long', quantity: 10, entryDate: '2026-09-01', entryPrice: 100 };

test('long P&L, R multiple and holding period', () => {
  const t = evaluateTrade({ ...base, stopLoss: 90 }, { bars, compositeNow: { score: 70 } }, now);
  assert.equal(t.status, 'open');
  assert.ok(Math.abs(t.pnl.pct - 0.1) < 1e-9);
  assert.equal(t.pnl.abs, 100);
  assert.equal(t.pnl.r, 1);
  assert.equal(t.pnl.holdingDays, 4);
  assert.equal(t.verdict.code, 'strong');
});

test('short trades invert P&L and fundamental alignment', () => {
  const t = evaluateTrade({ ...base, direction: 'short' }, { bars, compositeNow: { score: 30 } }, now);
  assert.ok(t.pnl.pct < 0);
  assert.equal(t.alignment, 70);
  assert.equal(orient(30, 'short'), 70);
});

test('stop breach is detected from intraday lows', () => {
  const t = evaluateTrade({ ...base, stopLoss: 95 }, { bars, compositeNow: { score: 70 } }, now);
  assert.equal(t.verdict.code, 'stop');
  assert.ok(t.alerts.some((a) => a.level === 'danger'));
});

test('target reached', () => {
  const t = evaluateTrade({ ...base, takeProfit: 108 }, { bars, compositeNow: { score: 55 } }, now);
  assert.equal(t.verdict.code, 'target');
});

test('verdict tiers follow alignment', () => {
  const v = (s) => evaluateTrade(base, { bars, compositeNow: { score: s } }, now).verdict.code;
  assert.equal(v(80), 'strong');
  assert.equal(v(55), 'intact');
  assert.equal(v(42), 'weakening');
  assert.equal(v(20), 'broken');
  assert.equal(v(null), 'pending');
});

test('closed trades use the exit price and report the move since exit', () => {
  const t = evaluateTrade({ ...base, exitDate: '2026-09-03', exitPrice: 96 }, { bars, compositeNow: { score: 60 } }, now);
  assert.equal(t.status, 'closed');
  assert.ok(Math.abs(t.pnl.pct + 0.04) < 1e-9);
  assert.equal(t.verdict.code, 'closed');
  assert.ok(t.pnl.sinceExit > 0.14);
});

test('alerts when a pillar flips against the trade', () => {
  const nowP = pillars(70).map((p) => (p.key === 'growth' ? { ...p, score: 30 } : p));
  const t = evaluateTrade(base, { bars, pillarsNow: nowP, pillarsAtEntry: pillars(70), compositeNow: { score: 62 } }, now);
  assert.ok(t.alerts.some((a) => /growth/.test(a.text)));
});

test('adverse news alert depends on direction', () => {
  const news = [{ id: 'n', title: 'Bad', sentiment: 'negative', publishedAt: '2026-09-05T08:00:00Z' }];
  const long = evaluateTrade(base, { bars, news, compositeNow: { score: 60 } }, now);
  const short = evaluateTrade({ ...base, direction: 'short' }, { bars, news, compositeNow: { score: 60 } }, now);
  assert.ok(long.alerts.some((a) => a.text.startsWith('Adverse news')));
  assert.ok(!short.alerts.some((a) => a.text.startsWith('Adverse news')));
});

test('a close from before the entry date is not used for P&L', () => {
  const t = evaluateTrade({ ...base, entryDate: '2026-09-05', entryPrice: 95 }, { bars, compositeNow: { score: 60 } }, now);
  assert.equal(t.price.awaiting, true);
  assert.equal(t.pnl.pct, null);
  assert.equal(t.pnl.abs, null);
  assert.ok(t.alerts.some((a) => /No closing price since you bought/.test(a.text)));
});
