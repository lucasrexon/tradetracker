import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveQuarters, ttmPair, instant, fundamentalsSnapshot } from '../server/analysis/xbrl.js';

// FY = calendar year. 10-Qs report Q (3m) and YTD; 10-K reports FY only.
const income = [
  // FY2024
  ['2024-01-01', '2024-03-31', 100, '2024-05-01'],
  ['2024-04-01', '2024-06-30', 110, '2024-08-01'],
  ['2024-01-01', '2024-06-30', 210, '2024-08-01'],
  ['2024-07-01', '2024-09-30', 120, '2024-11-01'],
  ['2024-01-01', '2024-09-30', 330, '2024-11-01'],
  ['2024-01-01', '2024-12-31', 460, '2025-02-15'], // Q4 = 130
  // FY2025
  ['2025-01-01', '2025-03-31', 125, '2025-05-01'],
  ['2025-04-01', '2025-06-30', 135, '2025-08-01'],
  ['2025-01-01', '2025-06-30', 260, '2025-08-01'],
  ['2025-07-01', '2025-09-30', 150, '2025-11-01'],
  ['2025-01-01', '2025-09-30', 410, '2025-11-01'],
  ['2025-01-01', '2025-12-31', 570, '2026-02-15'], // Q4 = 160
];

// Cash flow statements only report year-to-date.
const cashflowYtd = [
  ['2025-01-01', '2025-03-31', 30, '2025-05-01'],
  ['2025-01-01', '2025-06-30', 70, '2025-08-01'],
  ['2025-01-01', '2025-09-30', 100, '2025-11-01'],
  ['2025-01-01', '2025-12-31', 150, '2026-02-15'],
];

test('rebuilds Q4 from the annual figure', () => {
  const q = deriveQuarters(income);
  assert.equal(q.length, 8);
  const q4 = q.find((x) => x.end === '2024-12-31');
  assert.equal(q4.val, 130);
  assert.equal(q4.derived, true);
  assert.equal(q.find((x) => x.end === '2025-12-31').val, 160);
});

test('derives discrete quarters from year-to-date cash flows', () => {
  const q = deriveQuarters(cashflowYtd);
  assert.deepEqual(q.map((x) => x.val), [30, 40, 30, 50]);
});

test('TTM and prior-year TTM', () => {
  const { now, prior } = ttmPair(income);
  assert.equal(now.val, 570);
  assert.equal(prior.val, 460);
});

test('point-in-time: ignores filings made after the as-of date', () => {
  const { now, prior } = ttmPair(income, '2025-08-15');
  // Known then: Q3'24, Q4'24, Q1'25, Q2'25
  assert.equal(now.val, 120 + 130 + 125 + 135);
  assert.equal(now.end, '2025-06-30');
  assert.equal(prior, null);
});

test('prefers a directly reported quarter over a derived one', () => {
  const restated = [...income, ['2025-04-01', '2025-06-30', 136, '2025-08-02']];
  const q = deriveQuarters(restated);
  assert.equal(q.find((x) => x.end === '2025-06-30').val, 136);
});

test('instant facts: latest and nearest-to-date lookups', () => {
  const eq = [
    [null, '2024-12-31', 500, '2025-02-15'],
    [null, '2025-09-30', 650, '2025-11-01'],
    [null, '2025-12-31', 700, '2026-02-15'],
  ];
  assert.equal(instant(eq).val, 700);
  assert.equal(instant(eq, '2025-12-01').val, 650);
  assert.equal(instant(eq, undefined, '2025-01-05').val, 500);
});

test('snapshot returns null without statements', () => {
  assert.equal(fundamentalsSnapshot(null, '2026-01-01'), null);
  assert.equal(fundamentalsSnapshot({ metrics: {} }, '2026-01-01'), null);
});

test('snapshot derives liabilities from L+E when total liabilities is missing', () => {
  const snap = fundamentalsSnapshot(
    {
      metrics: {
        revenue: income,
        netIncome: income.map(([s, e, v, f]) => [s, e, v / 10, f]),
        equity: [[null, '2025-12-31', 300, '2026-02-15']],
        liabilitiesAndEquity: [[null, '2025-12-31', 1000, '2026-02-15']],
      },
      shares: [],
    },
    '2026-03-01',
  );
  assert.equal(snap.liabilities, 700);
  assert.equal(snap.revenue, 570);
  assert.equal(snap.netIncome, 57);
});
