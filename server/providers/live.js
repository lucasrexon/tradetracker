/**
 * Live data source: Massive for market data and news, SEC EDGAR for
 * financial statements.
 */
export class LiveSource {
  constructor({ massive, sec }) {
    this.massive = massive;
    this.sec = sec;
    this.kind = 'live';
    this.realtime = null; // unknown until the first snapshot attempt
  }

  dailyBars(ticker, from, to, opts) {
    return this.massive.dailyBars(ticker, from, to, opts);
  }

  news(ticker, opts) {
    return this.massive.news(ticker, opts);
  }

  details(ticker, opts) {
    return this.massive.details(ticker, opts);
  }

  shortInterest(ticker, opts) {
    return this.massive.shortInterest(ticker, opts);
  }

  treasuryYields(opts) {
    return this.massive.treasuryYields(opts);
  }

  async fundamentals(details, opts) {
    if (!this.sec || !details?.cik) return null;
    return this.sec.companyFacts(details.cik, opts);
  }

  /** Intraday snapshot. Only paid Massive plans have it; on others we stop asking. */
  async livePrice(ticker, opts) {
    if (this.realtime === false) return null;
    try {
      const body = await this.massive.request(
        `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`,
        opts,
      );
      const s = body?.ticker;
      const price = s?.lastTrade?.p ?? s?.min?.c ?? s?.day?.c ?? null;
      this.realtime = true;
      if (!price) return null;
      const ts = s.lastTrade?.t ? Math.floor(s.lastTrade.t / 1e6) : s.updated ? Math.floor(s.updated / 1e6) : Date.now();
      return { price, date: new Date(ts).toISOString().slice(0, 10), at: ts };
    } catch (err) {
      if (err.code === 'not_entitled') {
        this.realtime = false;
        return null;
      }
      throw err;
    }
  }
}
