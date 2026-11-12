async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.errors || [`Request failed (${res.status})`]).join(' '));
    err.errors = data.errors || [];
    err.failed = data.failed || [];
    throw err;
  }
  return data;
}

export const api = {
  state: () => call('GET', '/api/state'),
  createTrade: (t) => call('POST', '/api/trades', t),
  updateTrade: (id, t) => call('PUT', `/api/trades/${encodeURIComponent(id)}`, t),
  deleteTrade: (id) => call('DELETE', `/api/trades/${encodeURIComponent(id)}`),
  importTrades: (rows) => call('POST', '/api/trades/import', rows),
  refresh: (ticker) => call('POST', `/api/refresh/${encodeURIComponent(ticker)}`),
};

/** Live stream of portfolio state + headlines. EventSource reconnects on its own. */
export function connect({ onState, onNews, onConnection }) {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('news', (e) => onNews(JSON.parse(e.data)));
  es.addEventListener('open', () => onConnection?.('live'));
  es.addEventListener('error', () => onConnection?.(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'));
  return () => es.close();
}

const ALIASES = {
  ticker: ['ticker', 'symbol'],
  direction: ['direction', 'side'],
  quantity: ['quantity', 'qty', 'shares'],
  entryDate: ['entry_date', 'entrydate', 'opened', 'open_date'],
  entryPrice: ['entry_price', 'entryprice', 'entry', 'open_price'],
  exitDate: ['exit_date', 'exitdate', 'closed', 'close_date'],
  exitPrice: ['exit_price', 'exitprice', 'exit', 'close_price'],
  stopLoss: ['stop', 'stop_loss', 'stoploss'],
  takeProfit: ['target', 'take_profit', 'takeprofit'],
  thesis: ['thesis', 'notes', 'note'],
};

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Parse a simple CSV of trades. Header names are matched loosely. */
export function parseTradesCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const index = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) index[field] = i;
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    for (const [field, i] of Object.entries(index)) row[field] = cells[i] ?? '';
    const side = String(row.direction || 'long').toLowerCase();
    row.direction = side.startsWith('s') ? 'short' : 'long';
    for (const k of ['exitDate', 'exitPrice', 'stopLoss', 'takeProfit']) if (row[k] === '') delete row[k];
    return row;
  });
}
