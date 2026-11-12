/** Piecewise-linear map from a metric value to a 0-100 score. */
export function scale(x, points) {
  if (x == null || !Number.isFinite(x)) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points.at(-1)[1];
}

/** Weighted mean over the metrics that actually have a score. */
export function blend(metrics) {
  let s = 0;
  let w = 0;
  for (const m of metrics) {
    if (m.score == null) continue;
    s += m.score * m.weight;
    w += m.weight;
  }
  return w ? Math.round(s / w) : null;
}

export function signalFor(score) {
  if (score == null) return 'unknown';
  if (score >= 62) return 'bullish';
  if (score <= 40) return 'bearish';
  return 'neutral';
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const fmt = {
  pct: (x, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`),
  pctPlain: (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`),
  mult: (x, d = 1) => (x == null ? '—' : `${x.toFixed(d)}×`),
  num: (x, d = 2) => (x == null ? '—' : x.toFixed(d)),
  money(x) {
    if (x == null) return '—';
    const a = Math.abs(x);
    const sign = x < 0 ? '-' : '';
    if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    return `${sign}$${a.toFixed(0)}`;
  },
};
