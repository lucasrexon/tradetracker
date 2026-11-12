/** Trade validation shared by the server and the hosted (browser) build. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const optNum = (v) => (v === '' || v == null ? null : Number(v));

/** Validate and normalise user input into a trade record. */
export function validateTrade(input, existing = {}) {
  const t = { ...existing, ...input };
  const errors = [];
  const trade = {
    id: existing.id || t.id || globalThis.crypto.randomUUID(),
    ticker: String(t.ticker || '').trim().toUpperCase(),
    direction: t.direction === 'short' ? 'short' : 'long',
    quantity: Number(t.quantity),
    entryDate: String(t.entryDate || ''),
    entryPrice: Number(t.entryPrice),
    stopLoss: optNum(t.stopLoss),
    takeProfit: optNum(t.takeProfit),
    exitDate: t.exitDate ? String(t.exitDate) : null,
    exitPrice: optNum(t.exitPrice),
    thesis: String(t.thesis || '').slice(0, 2000),
    sample: false,
    createdAt: existing.createdAt || t.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const today = new Date().toISOString().slice(0, 10);

  if (!TICKER_RE.test(trade.ticker)) errors.push('Ticker must be a US symbol like AAPL or BRK.B.');
  if (!(trade.quantity > 0)) errors.push('Quantity must be greater than zero.');
  if (!DATE_RE.test(trade.entryDate)) errors.push('Entry date must be YYYY-MM-DD.');
  else if (trade.entryDate > today) errors.push('Entry date cannot be in the future.');
  if (!(trade.entryPrice > 0)) errors.push('Entry price must be greater than zero.');
  for (const k of ['stopLoss', 'takeProfit', 'exitPrice']) {
    if (trade[k] != null && !(trade[k] > 0)) errors.push(`${k} must be a positive number.`);
  }
  if ((trade.exitDate == null) !== (trade.exitPrice == null)) errors.push('A closed trade needs both an exit date and an exit price.');
  if (trade.exitDate) {
    if (!DATE_RE.test(trade.exitDate)) errors.push('Exit date must be YYYY-MM-DD.');
    else if (trade.exitDate < trade.entryDate) errors.push('Exit date must be on or after the entry date.');
    else if (trade.exitDate > today) errors.push('Exit date cannot be in the future.');
  }
  const long = trade.direction === 'long';
  if (trade.stopLoss != null && trade.entryPrice > 0 && (long ? trade.stopLoss >= trade.entryPrice : trade.stopLoss <= trade.entryPrice)) {
    errors.push(long ? 'For a long trade the stop must sit below the entry price.' : 'For a short trade the stop must sit above the entry price.');
  }
  if (trade.takeProfit != null && trade.entryPrice > 0 && (long ? trade.takeProfit <= trade.entryPrice : trade.takeProfit >= trade.entryPrice)) {
    errors.push(long ? 'For a long trade the target must sit above the entry price.' : 'For a short trade the target must sit below the entry price.');
  }
  return { trade, errors };
}
