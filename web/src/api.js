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
  saveAccount: (account) => call('PUT', '/api/account', account),
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

export { parseTradesCsv } from './csv.js';
