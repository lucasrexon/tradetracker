import { scoreCss } from '../theme.js';
import { price, shortDate } from '../format.js';

/** Circular gauge for the 0-100 "fundamentals support" score. */
export function dial(score, { size = 92, label = 'SUPPORT' } = {}) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = scoreCss(score);
  return `<svg class="dial" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Fundamental support ${score ?? 'unknown'} out of 100">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
    <text x="50" y="53" text-anchor="middle" font-size="27">${score ?? '–'}</text>
    <text x="50" y="68" text-anchor="middle" class="sub">${label}</text>
  </svg>`;
}

/** Closing prices since shortly before entry, with entry / stop / target / exit levels. */
export function priceChart(trade, { width = 360, height = 132 } = {}) {
  const series = trade.price?.series || [];
  if (series.length < 2) return '<div class="empty">Price history loading…</div>';
  const pad = { l: 4, r: 44, t: 8, b: 16 };
  const levels = [trade.entryPrice, trade.stopLoss, trade.takeProfit, trade.exitPrice].filter((x) => x != null);
  const closes = series.map((s) => s[1]);
  let lo = Math.min(...closes, ...levels);
  let hi = Math.max(...closes, ...levels);
  const span = hi - lo || 1;
  lo -= span * 0.06;
  hi += span * 0.06;
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / (series.length - 1)) * w;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * h;
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${(pad.t + h).toFixed(1)}L${pad.l},${(pad.t + h).toFixed(1)}Z`;
  const up = (trade.pnl?.pct ?? 0) >= 0;
  const stroke = up ? 'var(--good)' : 'var(--bad)';
  const idxOf = (date) => {
    const i = series.findIndex((s) => s[0] >= date);
    return i < 0 ? series.length - 1 : i;
  };
  const lastY = y(series.at(-1)[1]);
  const level = (v, color, name, dash = '4 3') =>
    v == null
      ? ''
      : `<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="${dash}" opacity="0.85"/>
         ${Math.abs(y(v) - lastY) < 11 ? '' : `<text class="axis" x="${pad.l + w + 4}" y="${(y(v) + 3).toFixed(1)}" fill="${color}">${name}</text>`}`;
  const ei = idxOf(trade.entryDate);
  const xi = trade.exitDate ? idxOf(trade.exitDate) : null;
  const last = series.at(-1);
  const id = `g${trade.id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Price since entry">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${stroke}" stop-opacity="0.22"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
    </linearGradient></defs>
    <rect x="${x(ei).toFixed(1)}" y="${pad.t}" width="${((xi ?? series.length - 1) - ei) * (w / (series.length - 1))}" height="${h}" fill="currentColor" opacity="0.035"/>
    <path d="${area}" fill="url(#${id})"/>
    ${level(trade.stopLoss, 'var(--bad)', 'stop')}
    ${level(trade.takeProfit, 'var(--good)', 'target')}
    ${level(trade.entryPrice, 'var(--ink-3)', 'entry', '2 3')}
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(ei).toFixed(1)}" cy="${y(trade.entryPrice).toFixed(1)}" r="3.5" fill="var(--glass-solid)" stroke="var(--ink-2)" stroke-width="1.5"/>
    ${xi != null ? `<circle cx="${x(xi).toFixed(1)}" cy="${y(trade.exitPrice).toFixed(1)}" r="3.5" fill="var(--clay)" stroke="var(--glass-solid)" stroke-width="1.5"/>` : ''}
    <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3.5" fill="${stroke}"/>
    <text class="axis" x="${pad.l + w + 4}" y="${(y(last[1]) + 3).toFixed(1)}" font-weight="600" fill="${stroke}">${price(last[1])}</text>
    <text class="axis" x="${pad.l}" y="${height - 3}">${shortDate(series[0][0])}</text>
    <text class="axis" x="${pad.l + w}" y="${height - 3}" text-anchor="end">${shortDate(last[0])}</text>
  </svg>`;
}

/** Small line of the support score over time. */
export function sparkline(points, { width = 120, height = 28 } = {}) {
  if (!points || points.length < 2) return '';
  const vals = points.map((p) => p[1]);
  const lo = Math.min(...vals, 40);
  const hi = Math.max(...vals, 60);
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${scoreCss(vals.at(-1))}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}
