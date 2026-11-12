const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function money(x, { sign = false, compact = false } = {}) {
  if (x == null || !Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  let body;
  if (compact && abs >= 1e6) body = `$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  else if (compact && abs >= 1e4) body = `$${(abs / 1e3).toFixed(1)}k`;
  else {
    const d = abs < 1000 ? 2 : 0;
    body = `$${abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  }
  const s = x < 0 ? '−' : sign && x > 0 ? '+' : '';
  return s + body;
}

export const price = (x) =>
  x == null ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: x < 10 ? 3 : 2 });

export function pct(x, d = 1, { sign = true } = {}) {
  if (x == null || !Number.isFinite(x)) return '—';
  const v = Math.abs(x * 100).toFixed(d);
  return `${x < 0 ? '−' : sign && x > 0 ? '+' : ''}${v}%`;
}

export const tone = (x) => (x == null ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');

export function timeAgo(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(new Date(t).toISOString().slice(0, 10));
}

export function shortDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const sameYear = y === new Date().getUTCFullYear();
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

export const VERDICT_TONE = {
  strong: 'good',
  intact: 'good',
  target: 'good',
  weakening: 'warn',
  broken: 'bad',
  stop: 'bad',
  pending: 'muted',
  closed: 'muted',
};
