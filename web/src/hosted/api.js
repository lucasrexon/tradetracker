/**
 * Data layer for the hosted (claude.ai Artifact) build of TradeTracker.
 *
 * There is no server: the page runs the same Engine and five-pillar
 * analysis in the browser. Trades live in the artifact's shared database
 * (`trades/*`). Market data (prices, news, SEC filings, Treasury yields) is
 * written into the database by a sync job (`scripts/sync-hosted.js`, run by
 * Claude) and streamed into the engine as it changes.
 *
 * When the database isn't available in this view (signed out, a preview)
 * the page falls back to the synthetic demo source.
 */
import { Engine } from '../../../server/engine.js';
import { MemoryCache } from '../../../server/lib/memoryCache.js';
import { RateLimiter } from '../../../server/lib/rateLimiter.js';
import { DemoSource } from '../../../server/providers/demo.js';
import { validateTrade } from '../../../server/analysis/validate.js';
import samples from '../../../data/sample-trades.json';

export { parseTradesCsv } from '../csv.js';

const CONFIG = {
  refresh: {
    newsMs: 600_000,
    priceMs: 900_000,
    detailsMs: 86_400_000,
    shortInterestMs: 86_400_000,
    fundamentalsMs: 43_200_000,
    ratesMs: 21_600_000,
  },
  weights: { valuation: 1, growth: 1, profitability: 1, health: 1, sentiment: 1 },
};

class MemoryStore {
  constructor(trades = []) {
    this.trades = trades;
  }

  list() {
    return this.trades.slice();
  }

  get(id) {
    return this.trades.find((t) => t.id === id) || null;
  }

  replace(trades) {
    this.trades = trades;
  }

  upsert(trade) {
    const i = this.trades.findIndex((t) => t.id === trade.id);
    if (i < 0) this.trades.push(trade);
    else this.trades[i] = trade;
  }

  remove(id) {
    this.trades = this.trades.filter((t) => t.id !== id);
  }
}

/** Engine fed from the database: it never fetches anything itself. */
class HostedEngine extends Engine {
  constructor(opts) {
    super(opts);
    this.syncInfo = null;
    this.canWrite = true;
  }

  plan() {}

  getState() {
    const state = super.getState();
    const tickers = [...new Set(this.store.list().map((t) => t.ticker))];
    state.mode = 'live';
    state.hosted = {
      demo: false,
      canWrite: this.canWrite,
      syncedAt: this.syncInfo?.syncedAt || null,
      pending: tickers.filter((t) => !this.cache.has(`price:${t}`)),
    };
    return state;
  }
}

class DemoEngine extends Engine {
  getState() {
    const state = super.getState();
    state.hosted = { demo: true, canWrite: true, syncedAt: null, pending: [] };
    return state;
  }
}

const expandBars = (rows = []) =>
  rows.map(([date, o, h, l, c, v]) => ({ t: Date.parse(`${date}T05:00:00Z`), date, o, h, l, c, v }));

let engine = null;
let store = null;
let db = null;
let mode = 'connecting';

function fail(message, errors = [message]) {
  const err = new Error(message);
  err.errors = errors;
  return err;
}

function dbError(err) {
  if (err?.code === 'quota_exceeded') return fail('The tracker is full. Delete some past trades and try again.');
  if (err?.code === 'revoked' || err?.code === 'not_granted') return fail('You have view-only access to this tracker.');
  return fail(`Couldn't save: ${err?.message || 'unknown error'}.`);
}

const plain = (trade) => JSON.parse(JSON.stringify(trade));

async function writeTrade(trade) {
  if (mode === 'demo') {
    store.upsert(trade);
    engine.tradesChanged();
    return;
  }
  try {
    await db.doc(`trades/${trade.id}`).set(plain(trade));
  } catch (err) {
    throw dbError(err);
  }
}

export const api = {
  async createTrade(input) {
    const { trade, errors } = validateTrade({ ...input, id: undefined });
    if (errors.length) throw fail(errors.join(' '), errors);
    await writeTrade(trade);
    return trade;
  },

  async updateTrade(id, patch) {
    const existing = store?.get(id);
    if (!existing) throw fail('That trade no longer exists.');
    const { trade, errors } = validateTrade({ ...patch, id }, existing);
    if (errors.length) throw fail(errors.join(' '), errors);
    trade.sample = false;
    await writeTrade(trade);
    return trade;
  },

  async deleteTrade(id) {
    if (mode === 'demo') {
      store.remove(id);
      engine.tradesChanged();
      return null;
    }
    try {
      await db.doc(`trades/${id}`).delete();
    } catch (err) {
      throw dbError(err);
    }
    return null;
  },

  async importTrades(rows) {
    let created = 0;
    const failed = [];
    for (const [i, row] of rows.slice(0, 500).entries()) {
      const { trade, errors } = validateTrade({ ...row, id: undefined });
      if (errors.length) {
        failed.push({ row: i + 1, errors });
        continue;
      }
      await writeTrade(trade);
      created++;
    }
    if (!created && failed.length) throw Object.assign(fail('Nothing imported.'), { failed });
    return { created, failed };
  },

  /** Ask the next data sync to prioritise this ticker. */
  async refresh(ticker) {
    if (mode === 'demo') return { message: 'Demo data refreshes by itself.' };
    try {
      await db.doc(`requests/${ticker}`).set({ ticker, requestedAt: new Date().toISOString() });
    } catch (err) {
      throw dbError(err);
    }
    return { message: `${ticker} will be refreshed on the next data sync.` };
  },

  /** Claude's plain-language read of a trade, streamed through `onText`. */
  async askClaude(trade, { onText, signal } = {}) {
    const sample = await window.claude?.use?.('sample');
    if (!sample) throw fail("Claude isn't available in this view.");
    const brief = {
      ticker: trade.ticker,
      company: trade.name,
      direction: trade.direction,
      status: trade.status,
      entry: { date: trade.entryDate, price: trade.entryPrice },
      exit: trade.exitDate ? { date: trade.exitDate, price: trade.exitPrice } : null,
      last: trade.price?.last,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      pnlPct: trade.pnl?.pct != null ? +(trade.pnl.pct * 100).toFixed(1) : null,
      verdict: trade.verdict?.label,
      fundamentalSupportNow: trade.alignment,
      fundamentalSupportAtEntry: trade.alignmentAtEntry,
      pillars: (trade.pillars || []).map((p) => ({
        pillar: p.label,
        scoreNow: p.score,
        scoreAtEntry: trade.pillarsAtEntry?.find((x) => x.key === p.key)?.score ?? null,
        summary: p.summary,
        notes: p.notes,
      })),
      recentNews: (trade.news || []).slice(0, 8).map((a) => ({ title: a.title, sentiment: a.sentiment, published: a.publishedAt })),
      thesis: trade.thesis || null,
    };
    const prompt = [
      'You are reviewing one position in a personal trade journal.',
      'Scores are 0-100 for the company (higher = stronger). "Fundamental support" is oriented to the trade direction: for a short, weak fundamentals count as support.',
      'In 4 to 6 plain sentences, with no headings or bullet points: say whether the original thesis still holds, what has changed since entry, the main risk now, and one concrete thing to watch next.',
      'Refer to the numbers given. Do not invent data. Analysis only, not personal financial advice.',
      '',
      JSON.stringify(brief),
    ].join('\n');
    return sample(prompt, { onText, signal, cache: false });
  },
};

async function startDemo(handlers) {
  mode = 'demo';
  store = new MemoryStore(samples.map((t, i) => ({ ...t, id: `sample-${i + 1}`, sample: true })));
  engine = new DemoEngine({
    config: CONFIG,
    store,
    cache: new MemoryCache(),
    source: new DemoSource(),
    limiter: new RateLimiter({ perMinute: 10_000 }),
  });
  engine.on('state', handlers.onState);
  engine.on('news', handlers.onNews);
  engine.start();
  engine.scheduleEmit(0);
  handlers.onConnection?.('live');
}

function startHosted(handlers) {
  mode = 'hosted';
  store = new MemoryStore([]);
  engine = new HostedEngine({
    config: CONFIG,
    store,
    cache: new MemoryCache(),
    source: { kind: 'live', realtime: false },
    limiter: new RateLimiter({ perMinute: 5 }),
  });
  engine.on('state', handlers.onState);
  engine.on('news', handlers.onNews);

  // Say so if the store hasn't answered within 10 s; never resubscribe.
  let answered = false;
  const timer = setTimeout(() => {
    if (!answered) handlers.onConnection?.('reconnecting');
  }, 10_000);
  const settled = () => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    handlers.onConnection?.('live');
  };
  const onError = (err) => {
    settled();
    console.warn('[tradetracker] database listener stopped:', err?.code, err?.message);
    handlers.onConnection?.('closed');
  };

  db.collection('trades')
    .orderBy('createdAt')
    .onSnapshot((snap) => {
      store.replace(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      engine.tradesChanged();
      if (!snap.metadata.fromCache) settled();
    }, onError);

  const feed = (collection, apply) =>
    db.collection(collection).onSnapshot((snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') continue;
        apply(change.doc.id, change.doc.data());
      }
    }, onError);

  feed('market', (ticker, d) => {
    if (d.details) engine.accept({ key: `details:${ticker}`, name: 'details', ticker }, d.details);
    if (d.bars) engine.accept({ key: `price:${ticker}`, name: 'price', ticker }, { from: d.from, bars: expandBars(d.bars) });
    if (d.shortInterest) engine.accept({ key: `si:${ticker}`, name: 'shortInterest', ticker }, d.shortInterest);
  });
  feed('news', (ticker, d) => engine.accept({ key: `news:${ticker}`, name: 'news', ticker }, d.articles || []));
  feed('filings', (ticker, d) => engine.accept({ key: `fund:${ticker}`, name: 'fundamentals', ticker }, d.facts || null));
  feed('macro', (id, d) => {
    if (id === 'rates') engine.accept({ key: 'rates', name: 'rates' }, d.rates || []);
  });
  feed('meta', (id, d) => {
    if (id === 'sync') {
      engine.syncInfo = d;
      engine.scheduleEmit();
    }
  });
}

/** Same contract as the server build's `connect`: state + news callbacks. */
export function connect(handlers) {
  handlers.onConnection?.('reconnecting');
  (async () => {
    db = (await window.claude?.use?.('db')) || null;
    if (!db) return startDemo(handlers);
    startHosted(handlers);
    const user = await window.claude.use('user');
    if (user) {
      const can = await user.can('data.write');
      engine.canWrite = can !== false;
      engine.scheduleEmit();
    }
  })().catch((err) => {
    console.error(err);
    if (mode === 'connecting') startDemo(handlers);
  });
  return () => engine?.stop();
}
