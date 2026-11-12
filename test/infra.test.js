import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../server/lib/rateLimiter.js';
import { validateTrade } from '../server/store.js';
import { normalizeArticle } from '../server/providers/massive.js';
import { compactCompanyFacts } from '../server/providers/sec.js';

test('rate limiter never exceeds the per-window budget and honours priority', async () => {
  let clock = 0;
  const limiter = new RateLimiter({ perMinute: 2, windowMs: 1000, now: () => clock });
  const order = [];
  const jobs = [
    limiter.schedule(() => order.push('a'), { priority: 5 }),
    limiter.schedule(() => order.push('b'), { priority: 5 }),
    limiter.schedule(() => order.push('low'), { priority: 9 }),
    limiter.schedule(() => order.push('high'), { priority: 1 }),
  ];
  await new Promise((r) => setTimeout(r, 10));
  // Jobs scheduled together are sorted before the first two slots are used.
  assert.deepEqual(order, ['high', 'a']);
  assert.equal(limiter.stats().queued, 2);
  clock = 1001;
  limiter.pump();
  await Promise.all(jobs);
  assert.deepEqual(order, ['high', 'a', 'b', 'low']);
});

test('rate limiter collapses duplicate keys', async () => {
  const limiter = new RateLimiter({ perMinute: 100 });
  let calls = 0;
  limiter.pause(20);
  const p1 = limiter.schedule(() => ++calls, { key: 'k' });
  const p2 = limiter.schedule(() => ++calls, { key: 'k' });
  assert.equal(await p1, 1);
  assert.equal(await p2, 1);
  assert.equal(calls, 1);
});

test('trade validation', () => {
  const ok = validateTrade({ ticker: 'aapl', direction: 'long', quantity: '5', entryDate: '2026-01-02', entryPrice: '200', stopLoss: '180' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.trade.ticker, 'AAPL');
  assert.equal(ok.trade.quantity, 5);

  const badStop = validateTrade({ ticker: 'AAPL', direction: 'long', quantity: 1, entryDate: '2026-01-02', entryPrice: 100, stopLoss: 120 });
  assert.match(badStop.errors.join(), /below the entry/);

  const halfClosed = validateTrade({ ticker: 'AAPL', quantity: 1, entryDate: '2026-01-02', entryPrice: 100, exitPrice: 120 });
  assert.match(halfClosed.errors.join(), /both an exit date and an exit price/);

  const future = validateTrade({ ticker: 'AAPL', quantity: 1, entryDate: '2999-01-01', entryPrice: 100 });
  assert.match(future.errors.join(), /future/);
});

test('news normalisation picks the insight for the requested ticker', () => {
  const a = normalizeArticle(
    {
      id: '1', title: 'T', article_url: 'u', publisher: { name: 'P' }, published_utc: '2026-01-01T00:00:00Z',
      insights: [
        { ticker: 'NVDA', sentiment: 'negative', sentiment_reasoning: 'r1' },
        { ticker: 'MSFT', sentiment: 'neutral', sentiment_reasoning: 'r2' },
      ],
    },
    'MSFT',
  );
  assert.equal(a.sentiment, 'neutral');
  assert.equal(a.reasoning, 'r2');
});

test('SEC compaction merges renamed concepts and sums share classes', () => {
  const raw = {
    cik: 1,
    entityName: 'Co',
    facts: {
      'us-gaap': {
        SalesRevenueNet: { units: { USD: [{ start: '2021-01-01', end: '2021-03-31', val: 10, form: '10-Q', filed: '2021-05-01' }] } },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [
            { start: '2024-01-01', end: '2024-03-31', val: 20, form: '10-Q', filed: '2024-05-01' },
            { start: '2024-01-01', end: '2024-03-31', val: 99, form: '8-K', filed: '2024-04-20' },
          ] },
        },
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: { shares: [
            { end: '2024-04-20', val: 100, accn: 'a', filed: '2024-05-01' },
            { end: '2024-04-20', val: 50, accn: 'a', filed: '2024-05-01' },
          ] },
        },
      },
    },
  };
  const c = compactCompanyFacts(raw, { sinceYear: 2020 });
  assert.deepEqual(c.metrics.revenue.map((f) => f[2]), [10, 20]);
  assert.equal(c.shares[0][2], 150);
});
