import { ProviderError } from './errors.js';

const RATE_LIMIT_RE = /exceeded the maximum requests|rate limit/i;
const ENTITLEMENT_RE = /not entitled|NOT_AUTHORIZED|upgrade your plan/i;
const AUTH_RE = /unknown api key|invalid api key|api key (is )?(missing|required)/i;

/**
 * Client for the Massive REST API (formerly Polygon.io). Every request is
 * routed through the shared rate limiter, and responses are normalised into
 * the small shapes the analysis layer expects.
 */
export class MassiveClient {
  constructor({ apiKey, baseUrl, limiter, fetchImpl = fetch, log = console }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.limiter = limiter;
    this.fetch = fetchImpl;
    this.log = log;
  }

  async request(pathAndQuery, { priority = 5, key = pathAndQuery, retries = 2 } = {}) {
    const run = async () => {
      const headers = { Accept: 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      let res;
      try {
        res = await this.fetch(this.baseUrl + pathAndQuery, { headers, signal: AbortSignal.timeout(20_000) });
      } catch (err) {
        throw new ProviderError('network', `Massive request failed: ${err.message}`, { source: 'massive' });
      }
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      const message = body?.error || body?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      if (res.status === 429 || RATE_LIMIT_RE.test(message)) {
        throw new ProviderError('rate_limited', message, { status: res.status, source: 'massive' });
      }
      if (res.status === 401 || AUTH_RE.test(message)) {
        throw new ProviderError('unauthorized', `Massive rejected the API key: ${message}`, { status: res.status, source: 'massive' });
      }
      if (res.status === 403 || body?.status === 'NOT_AUTHORIZED' || ENTITLEMENT_RE.test(message)) {
        throw new ProviderError('not_entitled', message, { status: res.status, source: 'massive' });
      }
      if (res.status === 404) throw new ProviderError('not_found', message, { status: 404, source: 'massive' });
      if (!res.ok || body?.status === 'ERROR') {
        throw new ProviderError('http', message, { status: res.status, source: 'massive' });
      }
      return body;
    };

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.limiter.schedule(run, { priority, key });
      } catch (err) {
        if (err.code === 'rate_limited' && attempt < retries) {
          this.log.warn?.(`[massive] rate limited, cooling down 65s (${pathAndQuery.split('?')[0]})`);
          this.limiter.pause(65_000);
          continue;
        }
        throw err;
      }
    }
  }

  /** Daily OHLCV bars, split-adjusted, oldest first. */
  async dailyBars(ticker, from, to, opts) {
    const body = await this.request(
      `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000`,
      opts,
    );
    return (body?.results || []).map((r) => ({
      t: r.t,
      date: new Date(r.t).toISOString().slice(0, 10),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));
  }

  /** Recent articles mentioning the ticker, with the ticker-specific sentiment insight. */
  async news(ticker, { limit = 50, ...opts } = {}) {
    const body = await this.request(
      `/v2/reference/news?ticker=${encodeURIComponent(ticker)}&order=desc&sort=published_utc&limit=${limit}`,
      opts,
    );
    return (body?.results || []).map((a) => normalizeArticle(a, ticker));
  }

  async details(ticker, opts) {
    const body = await this.request(`/v3/reference/tickers/${encodeURIComponent(ticker)}`, opts);
    const r = body?.results;
    if (!r) throw new ProviderError('not_found', `No details for ${ticker}`, { source: 'massive' });
    return {
      ticker: r.ticker,
      name: r.name,
      cik: r.cik || null,
      type: r.type || null,
      exchange: r.primary_exchange || null,
      marketCap: r.market_cap ?? null,
      sharesOutstanding: r.share_class_shares_outstanding ?? r.weighted_shares_outstanding ?? null,
      sector: sentenceCase(r.sic_description),
      homepage: r.homepage_url || null,
      description: r.description || null,
      listDate: r.list_date || null,
    };
  }

  async shortInterest(ticker, opts) {
    const body = await this.request(
      `/stocks/v1/short-interest?ticker=${encodeURIComponent(ticker)}&sort=settlement_date.desc&limit=6`,
      opts,
    );
    return (body?.results || []).map((r) => ({
      date: r.settlement_date,
      shortInterest: r.short_interest,
      avgDailyVolume: r.avg_daily_volume,
      daysToCover: r.days_to_cover,
    }));
  }

  async treasuryYields(opts) {
    const body = await this.request(`/fed/v1/treasury-yields?sort=date.desc&limit=90`, opts);
    return (body?.results || [])
      .map((r) => ({ date: r.date, y2: r.yield_2_year ?? null, y10: r.yield_10_year ?? null, y3m: r.yield_3_month ?? null }))
      .reverse();
  }
}

/** SEC industry names arrive in capitals ("SEMICONDUCTORS & RELATED DEVICES"). */
export function sentenceCase(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function normalizeArticle(a, ticker) {
  const insight = (a.insights || []).find((i) => i.ticker === ticker);
  return {
    id: a.id,
    title: a.title,
    url: a.article_url,
    publisher: a.publisher?.name || 'Unknown',
    publishedAt: a.published_utc,
    description: a.description || '',
    image: a.image_url || null,
    tickers: a.tickers || [],
    keywords: a.keywords || [],
    sentiment: insight?.sentiment || null,
    reasoning: insight?.sentiment_reasoning || null,
  };
}
