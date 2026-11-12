import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSummary, equityCurve, maxDrawdown, trackRecord } from '../server/analysis/account.js';
import { validateAccount } from '../server/analysis/validate.js';

const bars = {
  X: [
    { date: '2026-03-02', c: 100 },
    { date: '2026-03-03', c: 110 },
    { date: '2026-03-04', c: 90 },
    { date: '2026-03-05', c: 120 },
  ],
};
const evaluated = (t, pnlAbs, extra = {}) => ({ status: t.exitDate ? 'closed' : 'open', pnl: { abs: pnlAbs, pct: pnlAbs / (t.entryPrice * t.quantity), holdingDays: 3, r: null }, positionValue: 0, ...t, ...extra });

test('equity curve marks open trades to each close and books exits on their date', () => {
  const trades = [
    evaluated({ id: 'a', ticker: 'X', direction: 'long', quantity: 10, entryDate: '2026-03-02', entryPrice: 100 }, 200),
    evaluated({ id: 'b', ticker: 'X', direction: 'short', quantity: 5, entryDate: '2026-03-03', entryPrice: 110, exitDate: '2026-03-04', exitPrice: 90 }, 100),
  ];
  const curve = equityCurve({ settings: { startingCapital: 1000, startDate: '2026-03-01' }, trades, barsByTicker: bars, today: '2026-03-05' });
  const at = Object.fromEntries(curve);
  assert.equal(at['2026-03-01'], 1000);
  assert.equal(at['2026-03-02'], 1000); // long opened at 100, closed 100
  assert.equal(at['2026-03-03'], 1100); // long +100, short flat
  assert.equal(at['2026-03-04'], 1000); // long −100, short closed +100
  assert.equal(at['2026-03-05'], 1300); // long +200, short +100 booked
});

test('deposits and withdrawals change value from their date', () => {
  const curve = equityCurve({
    settings: { startingCapital: 1000, startDate: '2026-03-02', flows: [{ date: '2026-03-04', amount: 500 }, { date: '2026-03-05', amount: -200 }] },
    trades: [],
    barsByTicker: bars,
    today: '2026-03-05',
  });
  assert.deepEqual(curve.map((p) => p[1]), [1000, 1000, 1500, 1300]);
});

test('max drawdown finds the deepest peak-to-trough fall', () => {
  const dd = maxDrawdown([['d1', 100], ['d2', 120], ['d3', 90], ['d4', 130], ['d5', 117]]);
  assert.equal(dd.abs, -30);
  assert.equal(dd.pct, -0.25);
  assert.equal(dd.from, 'd2');
  assert.equal(dd.to, 'd3');
});

test('track record: win rate, profit factor, expectancy and streak', () => {
  const mk = (id, abs, exitDate, direction = 'long', r = null) => ({ id, ticker: id, direction, status: 'closed', exitDate, pnl: { abs, pct: abs / 1000, r, holdingDays: 10 } });
  const r = trackRecord([
    mk('A', 300, '2026-01-10', 'long', 1.5),
    mk('B', -100, '2026-02-10', 'short', -1),
    mk('C', 200, '2026-03-10'),
    mk('D', 100, '2026-04-10'),
    { id: 'O', status: 'open', pnl: { abs: 50 } },
  ]);
  assert.equal(r.closed, 4);
  assert.equal(r.winRate, 0.75);
  assert.equal(r.profitFactor, 6);
  assert.equal(r.expectancy, 125);
  assert.equal(r.avgR, 0.25);
  assert.deepEqual(r.streak, { kind: 'win', count: 2 });
  assert.equal(r.best.ticker, 'A');
  assert.equal(r.worst.ticker, 'B');
  assert.equal(r.short.winRate, 0);
  assert.equal(r.openInProfit, 1);
});

test('account summary: value, return, exposure and cash available', () => {
  const trades = [
    evaluated({ id: 'a', ticker: 'X', direction: 'long', quantity: 10, entryDate: '2026-03-02', entryPrice: 100 }, 200, { positionValue: 1200 }),
    evaluated({ id: 'b', ticker: 'X', direction: 'long', quantity: 5, entryDate: '2026-03-02', entryPrice: 100, exitDate: '2026-03-03', exitPrice: 110 }, 50),
  ];
  const a = accountSummary({ settings: { startingCapital: 10000, startDate: '2026-03-01', flows: [{ date: '2026-03-03', amount: 1000 }] }, trades, barsByTicker: bars, today: '2026-03-05' });
  assert.equal(a.contributed, 11000);
  assert.equal(a.equity, 11250);
  assert.equal(a.invested, 1200);
  assert.equal(a.available, 10050);
  assert.ok(Math.abs(a.totalReturn - 250 / 11000) < 1e-12);
  assert.equal(a.curve.at(-1)[1], 11250);
});

test('without capital the summary still reports P&L but no return or cash', () => {
  const a = accountSummary({ settings: null, trades: [], today: '2026-03-05' });
  assert.equal(a.hasCapital, false);
  assert.equal(a.totalReturn, null);
  assert.equal(a.available, null);
});

test('account validation', () => {
  const ok = validateAccount({ startingCapital: '25000', startDate: '2026-01-02', flows: [{ date: '2026-02-01', amount: '-500', note: 'tax' }] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.account.startingCapital, 25000);
  assert.equal(ok.account.flows[0].amount, -500);
  assert.match(validateAccount({ startingCapital: -5 }).errors.join(), /zero or a positive/);
  assert.match(validateAccount({ flows: [{ date: '2026-02-01', amount: 0 }] }).errors.join(), /non-zero/);
});
