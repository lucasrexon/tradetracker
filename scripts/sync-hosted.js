/**
 * Market-data sync for the hosted site.
 *
 * The hosted page can't call Massive or SEC EDGAR itself, so this script
 * fetches everything its trades need (using the same Engine, cache and rate
 * limiter as the server) and writes one JSON file per database document:
 *
 *   <out>/market/<TICKER>.json   profile, daily bars, short interest
 *   <out>/news/<TICKER>.json     recent articles with sentiment
 *   <out>/filings/<TICKER>.json  compact SEC XBRL facts (or null)
 *   <out>/macro/rates.json       Treasury yields
 *   <out>/meta/sync.json         when and what was synced
 *   <out>/manifest.json          docs + suggested write batches (≤50 docs, <900 KB)
 *
 * Usage:
 *   NODE_USE_ENV_PROXY=1 MASSIVE_API_KEY=... node scripts/sync-hosted.js \
 *     --trades <dir of exported trade docs | trades.json> --out <dir> \
 *     [--cache <dir>] [--force AAPL,NVDA] [--seed]
 *
 * --seed writes data/sample-trades.json as trade documents too (first run).
 * Claude then writes the files with the ArtifactData tool (batch, file_path).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, ROOT } from '../server/config.js';
import { Cache } from '../server/lib/cache.js';
import { RateLimiter } from '../server/lib/rateLimiter.js';
import { MassiveClient, sentenceCase } from '../server/providers/massive.js';
import { SecClient } from '../server/providers/sec.js';
import { LiveSource } from '../server/providers/live.js';
import { Engine } from '../server/engine.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const out = path.resolve(args.out || 'sync-out');
const cacheDir = path.resolve(args.cache || path.join(ROOT, 'data'));

function readTrades() {
  if (args.seed) {
    const base = Date.parse('2026-01-01T00:00:00Z');
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sample-trades.json'), 'utf8')).map((t, i) => ({
      ...t,
      id: crypto.randomUUID(),
      sample: true,
      stopLoss: t.stopLoss ?? null,
      takeProfit: t.takeProfit ?? null,
      exitDate: t.exitDate ?? null,
      exitPrice: t.exitPrice ?? null,
      createdAt: new Date(base + i * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
  const src = path.resolve(args.trades || '');
  const unwrap = (d) => (d && d.data && typeof d.data === 'object' && 'version' in d ? { ...d.data, id: d.id ?? d.data.id } : d);
  if (fs.statSync(src).isDirectory()) {
    const files = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.json')) files.push(p);
      }
    };
    walk(src);
    return files.map((f) => ({ id: path.basename(f, '.json'), ...unwrap(JSON.parse(fs.readFileSync(f, 'utf8'))) }));
  }
  return JSON.parse(fs.readFileSync(src, 'utf8')).map(unwrap);
}

const trades = readTrades().filter((t) => t.ticker && t.entryDate);
if (!trades.length) {
  console.error('No trades found.');
  process.exit(1);
}

const config = loadConfig({ ...process.env, DATA_MODE: 'live', DATA_DIR: cacheDir }, []);
const limiter = new RateLimiter({ perMinute: config.massive.perMinute });
const source = new LiveSource({
  massive: new MassiveClient({ apiKey: config.massive.apiKey, baseUrl: config.massive.baseUrl, limiter }),
  sec: new SecClient({ userAgent: config.sec.userAgent, limiter: new RateLimiter({ perMinute: 120 }) }),
});
source.realtime = false; // the page only uses daily bars
const cache = new Cache(path.join(cacheDir, 'cache.json'));
for (const t of String(args.force || '').split(',').filter(Boolean)) {
  for (const k of [`news:${t.toUpperCase()}`, `price:${t.toUpperCase()}`]) if (cache.has(k)) cache.set(k, cache.get(k), 0);
}
const store = { list: () => trades, get: (id) => trades.find((t) => t.id === id) || null };
const engine = new Engine({ config, store, cache, source, limiter, log: { warn: (m) => console.warn(m) } });

engine.start();
const started = Date.now();
await new Promise((resolve, reject) => {
  const check = setInterval(() => {
    const { feeds } = engine.status();
    const busy = engine.inflight.size || limiter.stats().queued;
    process.stdout.write(`\r  feeds ${feeds.loaded}/${feeds.total}  queued ${limiter.stats().queued}   `);
    if (feeds.loaded >= feeds.total && !busy) {
      clearInterval(check);
      resolve();
    } else if (Date.now() - started > 20 * 60_000) {
      clearInterval(check);
      reject(new Error('Timed out after 20 minutes'));
    }
  }, 1000);
});
engine.stop();
cache.flush();
console.log(`\n  fetched in ${((Date.now() - started) / 1000).toFixed(0)}s`);

// ---------- write documents ----------
const syncedAt = new Date().toISOString();
const round = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const docs = [];
const put = (collection, id, body) => {
  const file = path.join(out, collection, `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(body);
  if (json.length > 250_000) throw new Error(`${collection}/${id} is ${json.length} bytes (limit 256 KiB)`);
  fs.writeFileSync(file, json);
  docs.push({ collection, doc_id: id, file_path: path.relative(process.cwd(), file), bytes: json.length });
};

fs.rmSync(out, { recursive: true, force: true });
const tickers = [...new Set(trades.map((t) => t.ticker))];
for (const ticker of tickers) {
  const earliest = trades.filter((t) => t.ticker === ticker).reduce((m, t) => (t.entryDate < m ? t.entryDate : m), '9999');
  const price = cache.get(`price:${ticker}`);
  put('market', ticker, {
    ticker,
    syncedAt,
    details: (() => {
      const d = cache.get(`details:${ticker}`);
      return d ? { ...d, sector: d.sector && d.sector === d.sector.toUpperCase() ? sentenceCase(d.sector) : d.sector, description: undefined } : null;
    })(),
    from: price?.from || null,
    bars: (price?.bars || []).map((b) => [b.date, round(b.o), round(b.h), round(b.l), round(b.c), Math.round(b.v || 0)]),
    shortInterest: cache.get(`si:${ticker}`) || [],
  });
  const news = (cache.get(`news:${ticker}`) || []).slice(0, 40).map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    publisher: a.publisher,
    publishedAt: a.publishedAt,
    description: (a.description || '').slice(0, 400),
    sentiment: a.sentiment,
    reasoning: a.reasoning,
  }));
  put('news', ticker, { ticker, syncedAt, articles: news });
  // Keep filings from two years before the first entry: enough for TTM and YoY at entry.
  const facts = cache.get(`fund:${ticker}`) ?? null;
  const since = `${Number(earliest.slice(0, 4)) - 2}-01-01`;
  const trimmed = facts && {
    ...facts,
    metrics: Object.fromEntries(Object.entries(facts.metrics).map(([k, rows]) => [k, rows.filter((r) => r[1] >= since)])),
    shares: facts.shares.filter((r) => r[1] >= since),
  };
  put('filings', ticker, { ticker, syncedAt, available: !!trimmed, facts: trimmed });
}
put('macro', 'rates', { syncedAt, rates: (cache.get('rates') || []).slice(-400) });
put('meta', 'sync', {
  syncedAt,
  source: 'Massive (prices, news, short interest, Treasury yields) and SEC EDGAR (filings)',
  tickers,
});
if (args.seed) for (const t of trades) put('trades', t.id, t);

// Group into write batches: at most 50 docs and ~900 KB per batch.
const batches = [];
let cur = [];
let size = 0;
for (const d of docs) {
  if (cur.length && (cur.length >= 50 || size + d.bytes > 900_000)) {
    batches.push(cur);
    cur = [];
    size = 0;
  }
  cur.push(d);
  size += d.bytes;
}
if (cur.length) batches.push(cur);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ syncedAt, tickers, docs, batches }, null, 2));
console.log(`  wrote ${docs.length} documents in ${batches.length} batch(es) to ${path.relative(process.cwd(), out)}`);
for (const d of docs) console.log(`    ${d.collection}/${d.doc_id}  ${(d.bytes / 1024).toFixed(1)} KB`);
process.exit(0);
