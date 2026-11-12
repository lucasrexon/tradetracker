/**
 * Synthetic data source so the app runs without an API key. Everything is
 * deterministic per ticker (seeded PRNG) but evolves with the clock: prices
 * tick every few seconds and new headlines arrive every minute or so.
 * Price paths are bridged through your trades' entry/exit prices so P&L looks
 * plausible.
 */

const DAY = 86_400_000;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r) => {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

const PROFILES = {
  AAPL: { name: 'Apple Inc.', sector: 'Consumer electronics', price: 340, vol: 0.24, rev: 470e9, g: 0.09, nm: 0.27, gm: 0.47, om: 0.32, lev: 2.4, cr: 1.0, cashPct: 0.08, shares: 14.6e9, bias: 0.08, dtc: 2.4 },
  NVDA: { name: 'NVIDIA Corp.', sector: 'Semiconductors', price: 190, vol: 0.5, rev: 210e9, g: 0.45, nm: 0.53, gm: 0.74, om: 0.6, lev: 0.35, cr: 3.9, cashPct: 0.12, shares: 24.3e9, bias: -0.1, dtc: 1.3 },
  MSFT: { name: 'Microsoft Corp.', sector: 'Software', price: 520, vol: 0.22, rev: 300e9, g: 0.15, nm: 0.36, gm: 0.69, om: 0.45, lev: 0.75, cr: 1.3, cashPct: 0.06, shares: 7.43e9, bias: 0.12, dtc: 1.8 },
  TSLA: { name: 'Tesla Inc.', sector: 'Automobiles', price: 410, vol: 0.6, rev: 95e9, g: -0.03, nm: 0.06, gm: 0.17, om: 0.06, lev: 0.65, cr: 2.0, cashPct: 0.3, shares: 3.22e9, bias: -0.18, dtc: 1.2 },
  AMZN: { name: 'Amazon.com Inc.', sector: 'E-commerce & cloud', price: 240, vol: 0.3, rev: 690e9, g: 0.11, nm: 0.1, gm: 0.49, om: 0.11, lev: 1.0, cr: 1.05, cashPct: 0.07, shares: 10.7e9, bias: 0.1, dtc: 1.6 },
  META: { name: 'Meta Platforms Inc.', sector: 'Internet media', price: 690, vol: 0.35, rev: 190e9, g: 0.19, nm: 0.38, gm: 0.81, om: 0.42, lev: 0.55, cr: 2.6, cashPct: 0.18, shares: 2.52e9, bias: 0.02, dtc: 1.4 },
};

function profileFor(ticker) {
  if (PROFILES[ticker]) return PROFILES[ticker];
  const r = rng(hash(`profile:${ticker}`));
  return {
    name: `${ticker} Holdings (demo)`,
    sector: 'Diversified',
    price: 20 + r() * 280,
    vol: 0.2 + r() * 0.4,
    rev: (2 + r() * 60) * 1e9,
    g: -0.08 + r() * 0.35,
    nm: -0.05 + r() * 0.3,
    gm: 0.2 + r() * 0.5,
    om: -0.02 + r() * 0.3,
    lev: 0.3 + r() * 2.5,
    cr: 0.8 + r() * 2,
    cashPct: 0.05 + r() * 0.25,
    shares: (0.1 + r() * 2) * 1e9,
    bias: -0.15 + r() * 0.3,
    dtc: 1 + r() * 8,
  };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const TEMPLATES = {
  positive: [
    '{name} beats estimates as demand accelerates',
    'Analysts lift {ticker} price targets after a strong quarter',
    '{name} expands share buyback by $10B',
    '{name} wins a multi-year enterprise contract',
    'Upgrade: {ticker} moved to Buy on improving margins',
    '{name} guides above consensus for next quarter',
  ],
  negative: [
    '{name} faces regulatory probe over business practices',
    '{ticker} slides as guidance disappoints investors',
    'Supply constraints weigh on {name} outlook',
    'Downgrade: {ticker} cut to Underperform on valuation',
    'Executive departure at {name} raises succession questions',
    '{name} warns of softer demand in key markets',
  ],
  neutral: [
    '{name} to present at investor conference next week',
    "What to watch in {name}'s upcoming earnings report",
    '{ticker} options activity picks up ahead of macro data',
    '{name} reorganizes divisions under new leadership',
    'Sector roundup: where {ticker} stands after the rotation',
  ],
};
const REASONS = {
  positive: 'Coverage points to stronger demand and improving financial results for the company.',
  negative: 'Coverage highlights risks to revenue, margins or management stability.',
  neutral: 'Informational coverage without a clear positive or negative read-through.',
};
const PUBLISHERS = ['Demo Wire', 'Synthetic Street Journal', 'Sample Markets Daily', 'Placeholder Financial'];

export class DemoSource {
  constructor({ now = () => Date.now() } = {}) {
    this.kind = 'demo';
    this.now = now;
    this.anchors = new Map();
    this.realtime = true;
  }

  setAnchors(ticker, anchors) {
    this.anchors.set(ticker, anchors.filter((a) => a.price > 0).sort((a, b) => (a.date < b.date ? -1 : 1)));
  }

  /** Daily bars for ~2 years, bridged through trade anchors. */
  bars(ticker) {
    const p = profileFor(ticker);
    const r = rng(hash(`bars:${ticker}`));
    const end = this.now();
    const days = [];
    for (let t = end - 730 * DAY; t <= end; t += DAY) {
      const wd = new Date(t).getUTCDay();
      if (wd !== 0 && wd !== 6) days.push(isoDay(t));
    }
    const sigma = p.vol / Math.sqrt(252);
    let lp = Math.log(p.price) - 0.15;
    const logs = days.map(() => (lp += 0.0003 + sigma * gauss(r)));
    const shift = Math.log(p.price) - logs.at(-1);
    for (let i = 0; i < logs.length; i++) logs[i] += shift;

    const anchors = (this.anchors.get(ticker) || [])
      .map((a) => ({ i: days.findIndex((d) => d >= a.date), lp: Math.log(a.price) }))
      .filter((a) => a.i >= 0);
    if (anchors.length) {
      const corr = anchors.map((a) => ({ i: a.i, c: a.lp - logs[a.i] }));
      for (let i = 0; i < logs.length; i++) {
        let c;
        if (i <= corr[0].i) c = corr[0].c * (i / Math.max(1, corr[0].i)) ** 0.5;
        else if (i >= corr.at(-1).i) {
          // Ease back to the profile's current price after the last anchor.
          const last = corr.at(-1);
          const span = Math.max(1, logs.length - 1 - last.i);
          c = last.c * (1 - (i - last.i) / span);
        }
        else {
          const k = corr.findIndex((x) => x.i >= i);
          const a = corr[k - 1];
          const b = corr[k];
          c = a.c + ((i - a.i) / (b.i - a.i)) * (b.c - a.c);
        }
        logs[i] += c;
      }
    }
    return days.map((date, i) => {
      const c = Math.exp(logs[i]);
      const o = i ? Math.exp(logs[i - 1]) : c;
      const wiggle = sigma * 0.6 * c;
      return { t: Date.parse(`${date}T16:00:00Z`), date, o, h: Math.max(o, c) + wiggle * r(), l: Math.min(o, c) - wiggle * r(), c, v: 1e6 * (5 + r() * 20) };
    });
  }

  async dailyBars(ticker, from, to) {
    return this.bars(ticker).filter((b) => b.date >= from && b.date <= to);
  }

  async livePrice(ticker) {
    const bars = this.bars(ticker);
    const last = bars.at(-1).c;
    const t = this.now() / 1000;
    const seed = hash(ticker) % 1000;
    const drift = 0.006 * Math.sin(t / 47 + seed) + 0.003 * Math.sin(t / 13 + seed * 2);
    return { price: last * (1 + drift), date: isoDay(this.now()), at: this.now() };
  }

  async details(ticker) {
    const p = profileFor(ticker);
    const last = this.bars(ticker).at(-1).c;
    return { ticker, name: p.name, cik: `demo-${ticker}`, type: 'CS', exchange: 'DEMO', marketCap: last * p.shares, sharesOutstanding: p.shares, sector: p.sector, homepage: null, description: `${p.name} (synthetic demo data)`, listDate: null };
  }

  /** Quarterly statements in the same compact XBRL shape the SEC client returns. */
  async fundamentals(details) {
    const ticker = details.ticker;
    const p = profileFor(ticker);
    const r = rng(hash(`fund:${ticker}`));
    const metrics = { revenue: [], grossProfit: [], operatingIncome: [], netIncome: [], operatingCashFlow: [], capex: [], equity: [], liabilities: [], liabilitiesAndEquity: [], assetsCurrent: [], liabilitiesCurrent: [], cash: [], longTermDebt: [] };
    const shares = [];
    const now = this.now();
    const year = new Date(now).getUTCFullYear();
    const qEnds = [];
    for (let y = year - 4; y <= year; y++) for (const md of ['03-31', '06-30', '09-30', '12-31']) qEnds.push(`${y}-${md}`);
    const n = qEnds.length;
    qEnds.forEach((end, i) => {
      const filed = isoDay(Date.parse(end) + 38 * DAY);
      if (filed > isoDay(now)) return;
      const start = isoDay(Date.parse(end) - 90 * DAY);
      const yearsBack = (n - 1 - i) / 4;
      const rev = (p.rev / 4) * (1 + p.g) ** -yearsBack * (0.96 + r() * 0.08);
      const marginDrift = (r() - 0.5) * 0.03 - yearsBack * 0.004 * Math.sign(p.g);
      const ni = rev * (p.nm + marginDrift);
      metrics.revenue.push([start, end, rev, filed]);
      metrics.grossProfit.push([start, end, rev * p.gm, filed]);
      metrics.operatingIncome.push([start, end, rev * (p.om + marginDrift), filed]);
      metrics.netIncome.push([start, end, ni, filed]);
      metrics.operatingCashFlow.push([start, end, ni * (1.05 + r() * 0.3), filed]);
      metrics.capex.push([start, end, rev * 0.05, filed]);
      const equity = p.rev * 0.5;
      const liabilities = equity * p.lev;
      metrics.equity.push([null, end, equity, filed]);
      metrics.liabilities.push([null, end, liabilities, filed]);
      metrics.liabilitiesAndEquity.push([null, end, equity + liabilities, filed]);
      metrics.liabilitiesCurrent.push([null, end, liabilities * 0.4, filed]);
      metrics.assetsCurrent.push([null, end, liabilities * 0.4 * p.cr, filed]);
      metrics.cash.push([null, end, p.rev * p.cashPct, filed]);
      metrics.longTermDebt.push([null, end, liabilities * 0.3, filed]);
      shares.push([null, end, p.shares, filed]);
    });
    return { cik: details.cik, name: p.name, metrics, shares };
  }

  async shortInterest(ticker) {
    const p = profileFor(ticker);
    const now = this.now();
    return [0, 1].map((k) => ({
      date: isoDay(now - (10 + k * 15) * DAY),
      shortInterest: p.shares * 0.01 * (1 + k * 0.05),
      avgDailyVolume: (p.shares * 0.01) / p.dtc,
      daysToCover: p.dtc * (1 - k * 0.04),
    }));
  }

  async treasuryYields() {
    const out = [];
    const now = this.now();
    for (let k = 400; k >= 0; k--) {
      const t = now - k * DAY;
      const wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const y10 = 4.35 + 0.25 * Math.sin(k / 60) + 0.05 * Math.sin(k / 7);
      out.push({ date: isoDay(t), y10: +y10.toFixed(2), y2: +(y10 - 0.3).toFixed(2), y3m: +(y10 - 0.1).toFixed(2) });
    }
    return out;
  }

  article(ticker, bucketMs, r) {
    const p = profileFor(ticker);
    const roll = r();
    const sentiment = roll < 0.36 + p.bias ? 'positive' : roll > 0.74 + p.bias ? 'negative' : 'neutral';
    const list = TEMPLATES[sentiment];
    const title = list[Math.floor(r() * list.length)].replaceAll('{name}', p.name).replaceAll('{ticker}', ticker);
    const publishedAt = new Date(bucketMs + Math.floor(r() * 50_000)).toISOString().replace(/\.\d+Z$/, 'Z');
    return {
      id: `demo-${ticker}-${bucketMs}`,
      title: `${title} [demo]`,
      url: null,
      publisher: PUBLISHERS[Math.floor(r() * PUBLISHERS.length)],
      publishedAt,
      description: 'Synthetic headline generated in demo mode. Set MASSIVE_API_KEY for real news.',
      image: null,
      tickers: [ticker],
      keywords: [],
      sentiment,
      reasoning: REASONS[sentiment],
    };
  }

  /** ~1 article/day of history plus a fresh one every few minutes while running. */
  async news(ticker) {
    const now = this.now();
    const out = [];
    const HOUR = 3600_000;
    for (let b = Math.floor((now - 30 * DAY) / HOUR) * HOUR; b < now - HOUR; b += HOUR) {
      const r = rng(hash(`news:${ticker}:${b}`));
      if (r() < 0.045) out.push(this.article(ticker, b, r));
    }
    const MIN = 60_000;
    for (let b = Math.floor((now - HOUR) / MIN) * MIN; b <= now - MIN; b += MIN) {
      const r = rng(hash(`live:${ticker}:${b}`));
      if (r() < 0.12) out.push(this.article(ticker, b, r));
    }
    return out.filter((a) => Date.parse(a.publishedAt) <= now).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, 50);
  }
}
