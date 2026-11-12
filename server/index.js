import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { loadConfig, ROOT } from './config.js';
import { Cache } from './lib/cache.js';
import { RateLimiter } from './lib/rateLimiter.js';
import { SseHub } from './lib/sse.js';
import { MassiveClient } from './providers/massive.js';
import { SecClient } from './providers/sec.js';
import { LiveSource } from './providers/live.js';
import { DemoSource } from './providers/demo.js';
import { TradeStore, AccountStore } from './store.js';
import { Engine } from './engine.js';

export const DEMO_ACCOUNT = { startingCapital: 100_000, startDate: '2026-01-02', flows: [], currency: 'USD', sample: true };

export async function createServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new TradeStore(path.join(config.dataDir, 'trades.json'), path.join(ROOT, 'data', 'sample-trades.json'));
  const limiter = new RateLimiter({ perMinute: config.mode === 'demo' ? 10_000 : config.massive.perMinute });

  let source;
  let cache;
  if (config.mode === 'live') {
    cache = new Cache(path.join(config.dataDir, 'cache.json'));
    const massive = new MassiveClient({ apiKey: config.massive.apiKey, baseUrl: config.massive.baseUrl, limiter });
    const sec = config.sec.enabled
      ? new SecClient({ userAgent: config.sec.userAgent, baseUrl: config.sec.baseUrl, limiter: new RateLimiter({ perMinute: 120 }) })
      : null;
    source = new LiveSource({ massive, sec });
  } else {
    cache = new Cache(null); // demo data is regenerated, never persisted
    source = new DemoSource();
  }

  const engine = new Engine({ config, store, cache, source, limiter });
  // Demo mode gets an example account so the portfolio view isn't empty.
  const accounts = new AccountStore(
    path.join(config.dataDir, config.mode === 'demo' ? 'account.demo.json' : 'account.json'),
    config.mode === 'demo' ? DEMO_ACCOUNT : null,
  );
  engine.setAccount(accounts.get());
  const hub = new SseHub();
  engine.on('state', (state) => hub.broadcast('state', state));
  engine.on('news', (payload) => hub.broadcast('news', payload));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, mode: config.mode }));
  app.get('/api/state', (req, res) => res.json(engine.getState()));
  app.get('/api/stream', (req, res) => hub.attach(req, res, [['state', engine.getState()]]));

  app.get('/api/account', (req, res) => res.json(accounts.get()));
  app.put('/api/account', (req, res) => {
    const { account, errors } = accounts.save(req.body || {});
    if (errors) return res.status(400).json({ errors });
    engine.setAccount(account);
    res.json(account);
  });

  app.get('/api/trades', (req, res) => res.json(store.list()));
  app.post('/api/trades', (req, res) => {
    const { trade, errors } = store.create(req.body || {});
    if (errors) return res.status(400).json({ errors });
    engine.tradesChanged();
    res.status(201).json(trade);
  });
  app.post('/api/trades/import', (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : req.body?.trades;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ errors: ['Send an array of trades.'] });
    const created = [];
    const failed = [];
    rows.slice(0, 500).forEach((row, i) => {
      const { trade, errors } = store.create(row);
      if (errors) failed.push({ row: i + 1, errors });
      else created.push(trade);
    });
    if (created.length) engine.tradesChanged();
    res.status(failed.length && !created.length ? 400 : 201).json({ created: created.length, failed });
  });
  app.put('/api/trades/:id', (req, res) => {
    const result = store.update(req.params.id, req.body || {});
    if (result.notFound) return res.status(404).json({ errors: ['Trade not found.'] });
    if (result.errors) return res.status(400).json({ errors: result.errors });
    engine.tradesChanged();
    res.json(result.trade);
  });
  app.delete('/api/trades/:id', (req, res) => {
    if (!store.remove(req.params.id)) return res.status(404).json({ errors: ['Trade not found.'] });
    engine.tradesChanged();
    res.status(204).end();
  });
  app.post('/api/refresh/:ticker', (req, res) => {
    const t = req.params.ticker.toUpperCase();
    for (const k of [`news:${t}`, `price:${t}`]) if (cache.has(k)) cache.set(k, cache.get(k), 0);
    engine.plan();
    res.json({ queued: true });
  });

  let vite = null;
  if (config.dev) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ configFile: path.join(ROOT, 'vite.config.js'), server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(ROOT, 'web', 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.warn('[server] web/dist missing: run `npm run build` (or use `npm run dev`).');
    }
    app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  engine.start();
  return {
    app,
    engine,
    store,
    cache,
    async close() {
      engine.stop();
      hub.close();
      cache.flush?.();
      await vite?.close();
    },
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith(path.join('server', 'index.js'));
if (isMain) {
  const config = loadConfig();
  const server = await createServer(config);
  const http = server.app.listen(config.port, config.host, () => {
    const mode = config.mode === 'live' ? 'LIVE (Massive + SEC EDGAR)' : 'DEMO (synthetic data, set MASSIVE_API_KEY for live)';
    console.log(`\n  TradeTracker  →  http://${config.host}:${config.port}\n  data: ${mode}\n`);
  });
  const shutdown = async () => {
    http.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
