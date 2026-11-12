import { Emitter } from './lib/emitter.js';
import { fundamentalsSnapshot } from './analysis/xbrl.js';
import { analyzePillars, composite } from './analysis/pillars.js';
import { evaluateTrade, priceOn } from './analysis/trade.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Keeps every tracked ticker's data fresh within the API budget, re-runs the
 * five-pillar analysis when anything changes, and emits:
 *   'state' – the full evaluated portfolio (debounced)
 *   'news'  – each newly seen headline, for the live view's droplets
 */
export class Engine extends Emitter {
  constructor({ config, store, cache, source, limiter, log = console, now = () => Date.now() }) {
    super();
    this.config = config;
    this.store = store;
    this.cache = cache;
    this.source = source;
    this.limiter = limiter;
    this.log = log;
    this.now = now;
    this.inflight = new Set();
    this.retryAt = new Map();
    this.feedStatus = new Map();
    this.unsupported = new Map();
    this.evaluated = new Map();
    this.lastAlignment = new Map();
    this.timer = null;
    this.emitTimer = null;
    this.demo = source.kind === 'demo';
    this.lastChange = 0;
    this.authError = null;
  }

  start() {
    this.syncAnchors();
    this.recomputeAll();
    this.plan();
    this.timer = setInterval(() => this.plan(), this.demo ? 1000 : 2000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.emitTimer);
  }

  /** Called after trades are created, edited or deleted. */
  tradesChanged() {
    this.syncAnchors();
    const tickers = new Set(this.store.list().map((t) => t.ticker));
    for (const id of [...this.evaluated.keys()]) if (!this.store.get(id)) this.evaluated.delete(id);
    for (const t of tickers) this.recompute(t);
    this.plan();
    this.scheduleEmit(0);
  }

  syncAnchors() {
    if (!this.source.setAnchors) return;
    const byTicker = new Map();
    for (const t of this.store.list()) {
      if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
      byTicker.get(t.ticker).push({ date: t.entryDate, price: t.entryPrice });
      if (t.exitDate && t.exitPrice) byTicker.get(t.ticker).push({ date: t.exitDate, price: t.exitPrice });
    }
    for (const [ticker, anchors] of byTicker) this.source.setAnchors(ticker, anchors);
  }

  tickers() {
    const map = new Map();
    for (const t of this.store.list()) {
      const cur = map.get(t.ticker) || { ticker: t.ticker, open: false, earliest: t.entryDate };
      cur.open ||= !t.exitDate;
      if (t.entryDate < cur.earliest) cur.earliest = t.entryDate;
      map.set(t.ticker, cur);
    }
    return [...map.values()].sort((a, b) => Number(b.open) - Number(a.open));
  }

  ttl(name) {
    const r = this.config.refresh;
    if (this.demo) return { price: 60_000, live: 3_000, news: 15_000, details: 3600_000, shortInterest: 3600_000, fundamentals: 3600_000, rates: 3600_000 }[name];
    return { price: r.priceMs, live: 60_000, news: r.newsMs, details: r.detailsMs, shortInterest: r.shortInterestMs, fundamentals: r.fundamentalsMs, rates: r.ratesMs }[name];
  }

  /** All feeds the current trades need, with priorities (lower runs first). */
  feeds() {
    const out = [];
    const today = isoDay(this.now());
    out.push({ key: 'rates', name: 'rates', priority: 2, run: (o) => this.source.treasuryYields(o) });
    for (const info of this.tickers()) {
      const t = info.ticker;
      const base = info.open ? 0 : 3;
      const from = isoDay(Math.max(this.now() - 730 * DAY, Date.parse(info.earliest) - 70 * DAY));
      out.push({
        key: `price:${t}`, ticker: t, name: 'price', priority: base + 1,
        stale: (v) => !v || v.from > from,
        run: async (o) => ({ from, bars: await this.source.dailyBars(t, from, today, o) }),
      });
      out.push({ key: `news:${t}`, ticker: t, name: 'news', priority: base + 1, run: (o) => this.source.news(t, o) });
      out.push({ key: `details:${t}`, ticker: t, name: 'details', priority: base + 2, run: (o) => this.source.details(t, o) });
      const details = this.cache.get(`details:${t}`);
      if (details) {
        out.push({
          key: `fund:${t}`, ticker: t, name: 'fundamentals', priority: base + 3,
          run: (o) => this.source.fundamentals(details, o),
        });
      }
      out.push({ key: `si:${t}`, ticker: t, name: 'shortInterest', priority: base + 4, run: (o) => this.source.shortInterest(t, o) });
      if (info.open && this.source.livePrice && this.source.realtime !== false && this.cache.has(`price:${t}`)) {
        out.push({ key: `live:${t}`, ticker: t, name: 'live', priority: 6, run: (o) => this.source.livePrice(t, o) });
      }
    }
    return out;
  }

  plan() {
    const now = this.now();
    for (const f of this.feeds()) {
      if (this.inflight.has(f.key) || this.unsupported.has(f.name)) continue;
      if ((this.retryAt.get(f.key) || 0) > now) continue;
      const value = this.cache.get(f.key);
      const fresh = this.cache.isFresh(f.key, this.ttl(f.name), now) && !(f.stale && f.stale(value));
      if (fresh) continue;
      // Refreshes of data we already have yield to first-time loads.
      const priority = f.priority + (this.cache.has(f.key) ? 3 : 0);
      this.runFeed(f, priority);
    }
  }

  async runFeed(f, priority) {
    this.inflight.add(f.key);
    this.feedStatus.set(f.key, { ...(this.feedStatus.get(f.key) || {}), state: 'loading' });
    try {
      const value = await f.run({ priority, key: f.key });
      this.feedStatus.set(f.key, { state: 'ok', at: this.now() });
      if (f.name !== 'fundamentals') this.authError = null;
      this.retryAt.delete(f.key);
      this.accept(f, value);
    } catch (err) {
      const code = err.code || 'error';
      this.feedStatus.set(f.key, { state: 'error', code, message: err.message, at: this.now() });
      if (code === 'unauthorized') {
        this.authError = err.message;
        this.retryAt.set(f.key, this.now() + 10 * 60_000);
      } else if (code === 'not_entitled' && f.name !== 'live') {
        this.unsupported.set(f.name, err.message);
        this.log.warn?.(`[engine] ${f.name} not available on this plan: ${err.message}`);
      } else if (code === 'not_found') {
        this.retryAt.set(f.key, this.now() + 12 * 3600_000);
        if (f.name === 'fundamentals') this.cache.set(f.key, null);
      } else {
        this.retryAt.set(f.key, this.now() + (code === 'rate_limited' ? 70_000 : 5 * 60_000));
        this.log.warn?.(`[engine] ${f.key} failed (${code}): ${err.message}`);
      }
      if (f.ticker) this.recompute(f.ticker);
      this.scheduleEmit();
    } finally {
      this.inflight.delete(f.key);
    }
  }

  accept(f, value) {
    if (f.name === 'news') {
      const prev = this.cache.get(f.key);
      const seen = new Set((prev || []).map((a) => a.id));
      const cutoff = this.now() - 45 * DAY;
      const merged = new Map((prev || []).map((a) => [a.id, a]));
      for (const a of value) merged.set(a.id, a);
      const list = [...merged.values()]
        .filter((a) => Date.parse(a.publishedAt) >= cutoff)
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
        .slice(0, 120);
      this.cache.set(f.key, list);
      if (prev) {
        const fresh = value.filter((a) => !seen.has(a.id)).sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
        for (const article of fresh.slice(-5)) this.emit('news', { ticker: f.ticker, article });
      }
    } else {
      this.cache.set(f.key, value);
    }
    if (f.ticker) this.recompute(f.ticker);
    else this.recomputeAll();
    this.scheduleEmit();
  }

  ratesAt(date) {
    const list = this.cache.get('rates') || [];
    let found = null;
    for (const r of list) {
      if (r.date <= date) found = r;
      else break;
    }
    return found || null;
  }

  recomputeAll() {
    for (const { ticker } of this.tickers()) this.recompute(ticker);
  }

  /** Re-run the five pillars for one ticker and re-evaluate its trades. */
  recompute(ticker) {
    const nowMs = this.now();
    const today = isoDay(nowMs);
    const details = this.cache.get(`details:${ticker}`) || null;
    const bars = this.cache.get(`price:${ticker}`)?.bars || [];
    const news = this.cache.get(`news:${ticker}`) || [];
    const si = this.cache.get(`si:${ticker}`) || [];
    const facts = this.cache.get(`fund:${ticker}`) || null;
    const liveRaw = this.cache.get(`live:${ticker}`) || null;
    // Only trust an intraday quote that is newer than the last daily bar.
    const live = liveRaw && liveRaw.at > (bars.at(-1)?.t ?? 0) && nowMs - liveRaw.at < 36 * 3600_000 ? liveRaw : null;
    const weights = this.config.weights;

    const lastClose = live?.price ?? bars.at(-1)?.c ?? null;
    const fNow = facts ? fundamentalsSnapshot(facts, today) : null;
    const shares = details?.sharesOutstanding || fNow?.shares || null;
    const mcapNow = lastClose && shares ? lastClose * shares : details?.marketCap ?? null;
    const oldestNews = news.at(-1)?.publishedAt?.slice(0, 10) || today;

    const pillarsAt = (date, price) => {
      const f = facts ? fundamentalsSnapshot(facts, date) : null;
      // Bars are split-adjusted, so scale today's market cap by the adjusted price ratio.
      const bar = priceOn(bars, date);
      const refPrice = bar?.c ?? price;
      const mcap = mcapNow && lastClose && refPrice ? mcapNow * (refPrice / lastClose) : null;
      const newsCovered = oldestNews <= isoDay(Date.parse(date) - 7 * DAY);
      const pillars = analyzePillars({
        fundamentals: f,
        marketCap: mcap,
        rates: this.ratesAt(date),
        news: newsCovered ? news : [],
        shortInterest: si,
        asOf: `${date}T23:59:59Z`,
      });
      if (!newsCovered) {
        const s = pillars.find((p) => p.key === 'sentiment');
        if (s.score == null) s.summary = 'No archived news from that date';
      }
      return { pillars, comp: composite(pillars, weights), f };
    };

    const pillarsNow = analyzePillars({
      fundamentals: fNow,
      marketCap: mcapNow,
      rates: this.ratesAt(today),
      news,
      shortInterest: si,
      asOf: new Date(nowMs).toISOString(),
    });
    const compNow = composite(pillarsNow, weights);

    for (const trade of this.store.list().filter((t) => t.ticker === ticker)) {
      const entry = pillarsAt(trade.entryDate, trade.entryPrice);
      const exit = trade.exitDate ? pillarsAt(trade.exitDate, trade.exitPrice) : null;
      const evaluated = evaluateTrade(
        trade,
        {
          bars,
          details,
          live: live && !trade.exitDate ? live : null,
          pillarsNow,
          compositeNow: compNow,
          pillarsAtEntry: entry.pillars,
          compositeAtEntry: entry.comp,
          pillarsAtExit: exit?.pillars || null,
          compositeAtExit: exit?.comp || null,
          news,
          fundamentals: fNow,
        },
        new Date(nowMs),
      );
      evaluated.history = this.trackHistory(trade.id, evaluated.alignment, nowMs);
      evaluated.feeds = this.tickerFeeds(ticker);
      this.evaluated.set(trade.id, evaluated);
    }
    this.lastChange = nowMs;
  }

  trackHistory(id, alignment, nowMs) {
    const key = `hist:${id}`;
    const hist = this.cache.get(key) || [];
    if (alignment != null && hist.at(-1)?.[1] !== alignment) {
      hist.push([nowMs, alignment]);
      if (hist.length > 240) hist.splice(0, hist.length - 240);
      this.cache.set(key, hist);
    }
    return hist;
  }

  tickerFeeds(ticker) {
    const names = { price: 'price', news: 'news', details: 'details', fund: 'fundamentals', si: 'shortInterest' };
    const out = {};
    for (const [prefix, name] of Object.entries(names)) {
      const key = `${prefix}:${ticker}`;
      if (this.unsupported.has(name)) out[name] = 'unsupported';
      else if (prefix === 'fund' && this.cache.has(key) && this.cache.get(key) === null) out[name] = 'none';
      else if (this.cache.has(key)) out[name] = 'ok';
      else out[name] = this.feedStatus.get(key)?.state === 'error' ? 'error' : 'pending';
    }
    return out;
  }

  scheduleEmit(delay = 350) {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('state', this.getState());
    }, delay);
    this.emitTimer.unref?.();
  }

  portfolio(trades) {
    const open = trades.filter((t) => t.status === 'open');
    const closed = trades.filter((t) => t.status === 'closed');
    const sum = (list, f) => list.reduce((s, t) => s + (f(t) ?? 0), 0);
    const weighted = open.filter((t) => t.alignment != null);
    const wSum = sum(weighted, (t) => t.positionValue);
    return {
      openCount: open.length,
      closedCount: closed.length,
      openValue: sum(open, (t) => t.positionValue),
      openPnl: sum(open, (t) => t.pnl.abs),
      realizedPnl: sum(closed, (t) => t.pnl.abs),
      winRate: closed.length ? closed.filter((t) => t.pnl.abs > 0).length / closed.length : null,
      alignment: wSum ? Math.round(sum(weighted, (t) => t.alignment * t.positionValue) / wSum) : null,
      atRisk: open.filter((t) => ['stop', 'broken', 'weakening'].includes(t.verdict.code)).length,
    };
  }

  macro() {
    const list = this.cache.get('rates') || [];
    const last = list.at(-1);
    if (!last) return null;
    const monthAgo = list.find((r) => r.date >= isoDay(Date.parse(last.date) - 30 * DAY));
    return {
      date: last.date,
      y10: last.y10,
      y2: last.y2,
      curve: last.y10 != null && last.y2 != null ? +(last.y10 - last.y2).toFixed(2) : null,
      y10Change30d: monthAgo && last.y10 != null ? Math.round((last.y10 - monthAgo.y10) * 100) : null,
    };
  }

  status() {
    const feeds = this.feeds();
    const loaded = feeds.filter((f) => this.cache.has(f.key) && f.name !== 'live').length;
    const total = feeds.filter((f) => f.name !== 'live').length;
    return {
      mode: this.source.kind,
      realtime: this.source.realtime,
      feeds: { loaded, total },
      limiter: this.limiter.stats(),
      unsupported: Object.fromEntries(this.unsupported),
      authError: this.authError || null,
      lastChange: this.lastChange,
    };
  }

  getState() {
    const order = new Map(this.store.list().map((t, i) => [t.id, i]));
    const trades = [...this.evaluated.values()]
      .filter((t) => order.has(t.id))
      .sort((a, b) => (a.status === b.status ? order.get(a.id) - order.get(b.id) : a.status === 'open' ? -1 : 1));
    return {
      generatedAt: this.now(),
      mode: this.source.kind,
      trades,
      portfolio: this.portfolio(trades),
      macro: this.macro(),
      status: this.status(),
    };
  }
}
