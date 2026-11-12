import { esc, money, pct, tone, timeAgo, VERDICT_TONE } from '../format.js';
import { scoreCss, SENTIMENT } from '../theme.js';
import { morph } from './morph.js';

const rowHtml = (t, selectedId, hoverId) => {
  const sw = scoreCss(t.alignment);
  const cls = ['trade-row', t.id === selectedId ? 'selected' : '', t.id === hoverId ? 'hover' : ''].join(' ');
  const vtone = VERDICT_TONE[t.verdict?.code] || 'muted';
  const support = t.alignment == null ? '' : `<span class="minibar" title="Fundamental support ${t.alignment}"><i style="width:${t.alignment}%;background:${sw}"></i></span>`;
  return `<li><button class="${cls}" data-id="${esc(t.id)}" type="button">
    <span class="swatch" style="background:${sw}"></span>
    <span class="name"><b>${esc(t.ticker)}</b><span class="pill ${t.direction}">${t.direction}</span>${t.sample ? '<span class="pill">sample</span>' : ''}</span>
    <span class="pnl num ${tone(t.pnl?.pct)}">${pct(t.pnl?.pct)}</span>
    <span class="sub">${support}<span class="pill ${vtone}">${esc(t.verdict?.label || '')}</span><span class="num">${money(t.pnl?.abs, { sign: true, compact: true })}</span></span>
  </button></li>`;
};

function valueHero(a, open) {
  if (!a) return '';
  if (!a.hasCapital) {
    return `<button class="value-hero empty" data-action="account" type="button" aria-expanded="${open}">
      <span class="lbl">Portfolio value</span>
      <span class="set">Set your capital to track portfolio value and return</span>
      <span class="go" aria-hidden="true">→</span>
    </button>`;
  }
  return `<button class="value-hero" data-action="account" type="button" aria-expanded="${open}" aria-label="Open account: portfolio value ${money(a.equity)}">
    <span class="lbl">Portfolio value${a.sample ? ' <span class="pill">example</span>' : ''}</span>
    <strong class="num">${money(a.equity)}</strong>
    <span class="ret num ${tone(a.totalReturn)}">${pct(a.totalReturn)} <small>${money(a.realized + a.unrealized, { sign: true, compact: true })}</small></span>
    <span class="spark">${valueSpark(a.curve)}</span>
    <span class="go" aria-hidden="true">Account →</span>
  </button>`;
}

function valueSpark(curve, width = 132, height = 34) {
  if (!curve || curve.length < 2) return '';
  const vals = curve.map((c) => c[1]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (i) => (i / (curve.length - 1)) * width;
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4);
  const d = curve.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c[1]).toFixed(1)}`).join('');
  const up = vals.at(-1) >= vals[0];
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <path d="${d}L${width},${height}L0,${height}Z" fill="${up ? 'var(--good)' : 'var(--bad)'}" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="${up ? 'var(--good)' : 'var(--bad)'}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

export function renderPortfolio(el, state, { selectedId, hoverId, collapsed, view }) {
  const p = state.portfolio || {};
  const a = state.account;
  const rec = a?.record;
  const accountOpen = view === 'account';
  const open = state.trades.filter((t) => t.status === 'open');
  const closed = state.trades.filter((t) => t.status === 'closed');
  const sampleCount = state.trades.filter((t) => t.sample).length;
  const notices = [];
  const hosted = state.hosted;
  if (state.mode === 'demo') {
    notices.push(
      hosted
        ? '<div class="notice"><b>Demo data.</b> Prices, headlines and financials here are synthetic. Open this page signed in to claude.ai to see the live tracker.</div>'
        : '<div class="notice"><b>Demo data.</b> Prices, headlines and financials are synthetic. Add <code>MASSIVE_API_KEY</code> to <code>.env</code> for live data.</div>',
    );
  }
  if (hosted?.pending?.length) {
    notices.push(`<div class="notice"><b>${hosted.pending.map(esc).join(', ')}</b> ${hosted.pending.length > 1 ? 'were' : 'was'} added after the last data sync. Prices, news and filings arrive with the next sync.</div>`);
  }
  if (hosted && !hosted.canWrite) notices.push('<div class="notice">You can view this tracker but not change it.</div>');
  if (state.status?.authError) notices.push(`<div class="notice bad"><b>Massive key rejected.</b> ${esc(state.status.authError)}</div>`);
  const unsupported = Object.keys(state.status?.unsupported || {});
  if (unsupported.length) notices.push(`<div class="notice">Not on your Massive plan: <b>${unsupported.map(esc).join(', ')}</b>. Those inputs are skipped.</div>`);
  if (sampleCount) notices.push(`<div class="notice">${sampleCount} sample trade${sampleCount > 1 ? 's are' : ' is'} loaded so you can explore. Delete them from each trade's panel.</div>`);

  el.classList.toggle('collapsed', !!collapsed);
  morph(el, `
    <div class="section-title" style="margin-top:0">
      <p class="eyebrow" style="margin:0">Portfolio <span class="collapsed-summary num">${
        a?.hasCapital
          ? `<b>${money(a.equity, { compact: true })}</b> <b class="${tone(a.totalReturn)}">${pct(a.totalReturn)}</b>`
          : `<b class="${tone(p.openPnl)}">${money(p.openPnl, { sign: true, compact: true })}</b> open`
      } · win rate <b>${rec?.winRate == null ? '–' : `${Math.round(rec.winRate * 100)}%`}</b></span></p>
      <button class="btn ghost small mobile-toggle" data-action="collapse" type="button" aria-expanded="${!collapsed}">${collapsed ? 'Show' : 'Hide'}</button>
    </div>
    ${valueHero(a, accountOpen)}
    <div class="stats">
      <div class="stat"><label>Open P&amp;L</label><strong class="${tone(p.openPnl)}">${money(p.openPnl, { sign: true, compact: true })}</strong><small>${money(p.openValue, { compact: true })} at market</small></div>
      <div class="stat"><label>Realized</label><strong class="${tone(p.realizedPnl)}">${money(p.realizedPnl, { sign: true, compact: true })}</strong><small>${p.closedCount} closed trade${p.closedCount === 1 ? '' : 's'}</small></div>
      <div class="stat"><label>Success rate</label><strong>${rec?.winRate == null ? '–' : `${Math.round(rec.winRate * 100)}%`}</strong><small>${rec?.closed ? `${rec.wins} of ${rec.closed} closed in profit` : 'no closed trades yet'}</small></div>
      <div class="stat"><label>Fundamental support</label><strong style="color:${scoreCss(p.alignment)}">${p.alignment ?? '–'}</strong><small>value-weighted, /100</small></div>
    </div>
    <div class="section-title"><h3>Open positions</h3><span>${p.atRisk ? `<span class="pill bad">${p.atRisk} need${p.atRisk === 1 ? 's' : ''} attention</span> ` : ''}${open.length}</span></div>
    ${open.length ? `<ul class="trade-list">${open.map((t) => rowHtml(t, selectedId, hoverId)).join('')}</ul>` : '<div class="empty">No open trades. Add one to start tracking.</div>'}
    <div class="section-title"><h3>Past trades</h3><span>${closed.length}</span></div>
    ${closed.length ? `<ul class="trade-list">${closed.map((t) => rowHtml(t, selectedId, hoverId)).join('')}</ul>` : '<div class="empty">Closed trades land here with a post-mortem.</div>'}
    ${notices.join('')}
    ${hosted && !hosted.canWrite ? '' : '<div class="panel-foot"><button class="btn small" data-action="import" type="button">Import CSV</button></div>'}`);
}

export function renderStatus(el, state, connection) {
  const s = state.status || {};
  const feeds = s.feeds || { loaded: 0, total: 0 };
  const warming = feeds.total && feeds.loaded < feeds.total;
  const chips = [];
  const live = state.mode === 'live';
  const conn = connection === 'live' ? '' : ' (reconnecting)';
  const synced = state.hosted?.syncedAt ? ` · synced ${timeAgo(state.hosted.syncedAt)}` : null;
  const detail = live ? (synced ?? (s.realtime ? ' · real-time' : ' · end-of-day')) : ' · synthetic';
  chips.push(
    `<span class="chip mode ${live ? 'live' : 'demo'} ${connection !== 'live' ? 'alert' : ''}" title="${live ? 'Prices are end-of-day; news and filings update with each sync' : 'Synthetic demo data'}"><span class="dot"></span><b>${live ? 'Live' : 'Demo'}</b>${conn || detail}</span>`,
  );
  if (warming && !state.hosted) {
    const frac = feeds.loaded / feeds.total;
    chips.push(`<span class="chip optional" title="Loading within your Massive rate limit">Loading data <span class="meter"><i style="width:${(frac * 100).toFixed(0)}%"></i></span> <b class="num">${feeds.loaded}/${feeds.total}</b></span>`);
  }
  const m = state.macro;
  if (m?.y10 != null) {
    const ch = m.y10Change30d;
    const arrow = ch == null ? '' : ch > 0 ? '▲' : ch < 0 ? '▼' : '';
    chips.push(`<span class="chip optional" title="10-year Treasury yield, change over 30 days">10Y <b class="num">${m.y10.toFixed(2)}%</b> <span class="num ${ch > 0 ? 'down' : ch < 0 ? 'up' : ''}">${arrow}${ch == null ? '' : Math.abs(ch)}bp</span></span>`);
  }
  if (s.limiter && live && s.limiter.queued) {
    chips.push(`<span class="chip optional" title="Requests waiting for the API rate limit">Queue <b class="num">${s.limiter.queued}</b></span>`);
  }
  morph(el, chips.join(''));
}

export class NewsRiver {
  constructor(el, { onPick }) {
    this.el = el;
    this.onPick = onPick;
    this.fresh = new Map(); // id → 'arrive' (animate once) | 'fresh' (highlight)
    el.innerHTML = '<span class="lbl">News</span><ol></ol>';
    this.list = el.querySelector('ol');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) this.onPick?.(b.dataset.ticker, b.dataset.id);
    });
  }

  markFresh(id) {
    this.fresh.set(id, 'arrive');
    setTimeout(() => this.fresh.delete(id), 9000);
  }

  render(state) {
    const seen = new Set();
    const items = [];
    for (const t of state.trades) {
      for (const a of t.news || []) {
        if (seen.has(a.id + t.ticker)) continue;
        seen.add(a.id + t.ticker);
        items.push({ ...a, ticker: t.ticker, open: t.status === 'open' });
      }
    }
    const dedup = new Map();
    for (const a of items.sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : -1))) {
      if (!dedup.has(a.id)) dedup.set(a.id, a);
    }
    const list = [...dedup.values()].slice(0, 24);
    if (!list.length) {
      morph(this.list, '<li class="hint" style="padding:0 8px">Headlines appear here as they are published.</li>');
      return;
    }
    const html = list
      .map((a) => {
        const s = SENTIMENT[a.sentiment] || SENTIMENT.null;
        const f = this.fresh.get(a.id);
        if (f === 'arrive') this.fresh.set(a.id, 'fresh');
        return `<li class="${f === 'arrive' ? 'fresh arrive' : f ? 'fresh' : ''}" data-key="${esc(a.id)}"><button type="button" data-id="${esc(a.id)}" data-ticker="${esc(a.ticker)}" title="${esc(a.title)}">
          <span class="s" style="background:${s.css}" aria-label="${s.label}"></span>
          <span class="tk">${esc(a.ticker)}</span>
          <span class="hl">${esc(a.title)}</span>
          <span class="ago">${timeAgo(a.publishedAt)}</span>
        </button></li>`;
      })
      .join('');
    morph(this.list, html);
  }
}

export function renderLegend(el) {
  el.innerHTML = `
    <h3>Reading the pool</h3>
    <dl>
      <dt><svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="var(--clay)" opacity=".85"/></svg></dt>
      <dd><b>Each liquid cell is a trade.</b> Bigger means a larger position.</dd>
      <dt><svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 3v16M6 8l5-5 5 5" stroke="var(--ink-2)" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></dt>
      <dd><b>Height is P&amp;L.</b> Winners float up; losers sink into the pool.</dd>
      <dt><svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="5" fill="var(--ink-3)"/><circle cx="19" cy="11" r="2.3" fill="var(--ink-3)"/><circle cx="3" cy="11" r="2.3" fill="var(--ink-3)"/><circle cx="11" cy="3" r="2.3" fill="var(--ink-3)"/></svg></dt>
      <dd><b>Five orbiting droplets are the fundamental pillars:</b> valuation, growth, profitability, financial health and news sentiment. They fuse back into the cell as they orbit. Size and colour show their score.</dd>
      <dt><svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 2c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z" fill="#6F9A74"/></svg></dt>
      <dd><b>Falling drops are new headlines</b>, coloured by sentiment, rippling the pool when they land.</dd>
      <dt><svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="7" fill="#bcb3a6"/></svg></dt>
      <dd><b>Matte stones on the outer ring</b> are past trades.</dd>
    </dl>
    <div class="ramp" style="background:linear-gradient(90deg, ${[0, 25, 50, 75, 100].map((s) => scoreCss(s)).join(',')})"></div>
    <div class="ramp-labels"><span>Fundamentals against you</span><span>Supporting you</span></div>
    <p class="hint" style="margin:10px 0 0">For a short, weak fundamentals count as support. Drag to orbit, scroll to zoom, click a cell to inspect.</p>`;
}

export function toast(container, { title, body, color, onClick, ttl = 6000 }) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="s" style="background:${color || 'var(--clay)'}"></span><div>${esc(title)}${body ? `<small>${esc(body)}</small>` : ''}</div>`;
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', () => {
    onClick?.();
    dismiss();
  });
  container.prepend(el);
  while (container.children.length > 4) container.lastElementChild.remove();
  setTimeout(dismiss, ttl);
}
