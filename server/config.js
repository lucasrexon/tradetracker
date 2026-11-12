import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function loadConfig(env = process.env, argv = process.argv) {
  const apiKey = (env.MASSIVE_API_KEY || '').trim();
  const requested = (env.DATA_MODE || 'auto').toLowerCase();
  const mode = requested === 'demo' || requested === 'live' ? requested : apiKey ? 'live' : 'demo';

  return {
    mode,
    dev: argv.includes('--dev'),
    port: num(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    massive: {
      apiKey,
      baseUrl: (env.MASSIVE_BASE_URL || 'https://api.massive.com').replace(/\/$/, ''),
      perMinute: num(env.MASSIVE_RPM, 5),
    },
    sec: {
      enabled: env.SEC_ENABLED !== '0',
      userAgent: env.SEC_USER_AGENT || 'TradeTracker/0.1 (self-hosted research tool)',
      baseUrl: 'https://data.sec.gov',
    },
    refresh: {
      newsMs: num(env.NEWS_REFRESH_MIN, 10) * 60_000,
      priceMs: num(env.PRICE_REFRESH_MIN, 15) * 60_000,
      detailsMs: 24 * 3600_000,
      shortInterestMs: 24 * 3600_000,
      fundamentalsMs: 12 * 3600_000,
      ratesMs: 6 * 3600_000,
    },
    // Equal weights: each of the five fundamental analyses counts the same.
    weights: { valuation: 1, growth: 1, profitability: 1, health: 1, sentiment: 1 },
  };
}
