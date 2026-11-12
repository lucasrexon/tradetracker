import { esc, money, pct, price, tone, timeAgo, shortDate, VERDICT_TONE } from '../format.js';
import { scoreCss, SENTIMENT, orient } from '../theme.js';
import { dial, priceChart, sparkline } from './charts.js';
import { morph } from './morph.js';

const PILLAR_HELP = {
  valuation: 'What you pay for earnings, sales and free cash flow, compared with Treasury yields.',
  growth: 'Is revenue and profit growing, and is that growth speeding up?',
  profitability: 'Margins and return on equity: how much of each dollar of sales the company keeps.',
  health: 'Leverage, liquidity and whether profits turn into cash.',
  sentiment: 'Recency-weighted tone of the latest news coverage, plus short-seller pressure.',
};

function pillarHtml(p, i, trade, open) {
  const then = trade.pillarsAtEntry?.find((x) => x.key === p.key);
  const s = orient(p.score, trade.direction);
  const sThen = then ? orient(then.score, trade.direction) : null;
  const color = scoreCss(s);
  const delta = s != null && sThen != null ? s - sThen : null;
  const signal = p.signal === 'unknown' ? '' : p.signal;
  const rows = (p.metrics || [])
    .filter((m) => m.display && m.display !== '—')
    .map(
      (m) => `<tr><td>${esc(m.label)}${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</td><td>${esc(m.display)}</td><td>${m.score == null ? '' : `${m.score}/100`}</td></tr>`,
    )
    .join('');
  return `<div class="pillar" data-key="${p.key}">
    <button type="button" aria-expanded="${open}" data-action="pillar" data-key="${p.key}">
      <span class="idx" style="background:${color}">${i + 1}</span>
      <span class="ttl">${esc(p.label)} ${signal ? `<span class="pill ${signal === 'bullish' ? 'good' : signal === 'bearish' ? 'bad' : ''}">${signal}</span>` : ''}</span>
      <span class="score num">${p.score ?? '–'}<small>${delta == null ? '' : `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta)}`}</small></span>
      <span class="bar"><i style="width:${p.score ?? 0}%;background:${scoreCss(p.score == null ? null : p.score)}"></i>${
        then?.score != null ? `<span class="then" style="left:${then.score}%" title="At entry: ${then.score}"></span>` : ''
      }</span>
      <span class="sum">${esc(p.summary)}</span>
    </button>
    ${
      open
        ? `<div class="more">
        <p class="hint" style="margin:0 0 8px">${PILLAR_HELP[p.key] || ''}</p>
        ${rows ? `<table>${rows}</table>` : ''}
        ${p.notes?.length ? `<ul>${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${then ? `<p class="hint" style="margin:8px 0 0">At entry (${shortDate(trade.entryDate)}): <b>${then.score ?? '–'}</b>, ${esc(then.summary)}</p>` : ''}
      </div>`
        : ''
    }
  </div>`;
}

function newsHtml(trade, expanded) {
  const items = trade.news || [];
  if (!items.length) return '<div class="empty">No recent headlines for this company.</div>';
  return `<ul class="news">${items
    .slice(0, 12)
    .map((a) => {
      const s = SENTIMENT[a.sentiment] || SENTIMENT.null;
      const head = a.url
        ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>`
        : `<span class="h">${esc(a.title)}</span>`;
      return `<li data-id="${esc(a.id)}"><span class="s" style="background:${s.css}" title="${s.label}"></span><div>
        ${head}
        <div class="m">${esc(a.publisher)} · ${timeAgo(a.publishedAt)} · <span style="color:${s.css}">${s.label}</span></div>
        ${a.reasoning && expanded.has(a.id) ? `<div class="r">${esc(a.reasoning)}</div>` : a.reasoning ? `<button class="btn ghost small" data-action="why" data-id="${esc(a.id)}" type="button" style="height:22px;padding:0;margin-top:2px;color:var(--ink-3)">Why ${s.label.toLowerCase()}?</button>` : ''}
      </div></li>`;
    })
    .join('')}</ul>`;
}

function rangeHtml(t) {
  if (t.stopLoss == null || t.takeProfit == null || t.price?.last == null) return '';
  const lo = Math.min(t.stopLoss, t.takeProfit);
  const hi = Math.max(t.stopLoss, t.takeProfit);
  const at = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const markPrice = t.status === 'closed' ? t.exitPrice : t.price.last;
  const [left, right] = t.direction === 'long' ? ['Stop', 'Target'] : ['Target', 'Stop'];
  return `<div class="progress" aria-label="Price between stop and target">
    <div class="track"><span class="entry" style="left:${at(t.entryPrice)}%"></span><span class="mark" style="left:${at(markPrice)}%"></span></div>
    <div class="ends"><span>${left} ${price(lo)}</span><span>entry ${price(t.entryPrice)}</span><span>${right} ${price(hi)}</span></div>
  </div>`;
}

export function renderDetail(el, trade, ui) {
  if (!trade) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const switched = el.dataset.id !== trade.id;
  el.hidden = false;
  el.dataset.id = trade.id;
  const v = trade.verdict || {};
  const vtone = VERDICT_TONE[v.code] || 'muted';
  const closed = trade.status === 'closed';
  const deltaText =
    trade.delta == null
      ? 'No entry-date baseline yet'
      : `${trade.delta >= 0 ? 'Up' : 'Down'} ${Math.abs(trade.delta)} pts since entry (${trade.alignmentAtEntry} → ${trade.alignment})`;
  const feeds = trade.feeds || {};
  const feedNames = { price: 'Prices', news: 'News', details: 'Profile', fundamentals: 'SEC filings', shortInterest: 'Short interest' };

  morph(el, `
    <div class="detail-head">
      <div>
        <h2>${esc(trade.ticker)}</h2>
        <div class="co">${esc(trade.name)}${trade.sector ? ` · ${esc(trade.sector)}` : ''}</div>
        <div class="co"><span class="pill ${trade.direction}">${trade.direction}</span><span class="pill">${closed ? 'closed' : 'open'}</span>${trade.sample ? '<span class="pill">sample</span>' : ''}</div>
      </div>
      <button class="icon-btn close" data-action="close" type="button" aria-label="Close detail">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="detail-body">
      <div class="verdict">
        ${dial(trade.alignment)}
        <div>
          <span class="pill ${vtone}">${esc(v.label || '')}</span>
          <h3 style="margin-top:6px">${closed ? `${pct(trade.pnl?.pct)} realized` : esc(v.label || '')}</h3>
          <p>${esc(v.detail || '')}</p>
          <div class="delta">${esc(deltaText)}${trade.coverage < 5 ? ` · ${trade.coverage}/5 pillars available` : ''}</div>
          ${trade.history?.length > 2 ? `<div style="margin-top:6px">${sparkline(trade.history)}</div>` : ''}
        </div>
      </div>

      <div class="kv">
        <div><label>${closed ? 'Exit' : 'Last'}</label><b>${price(closed ? trade.exitPrice : trade.price?.last)}</b></div>
        <div><label>Entry</label><b>${price(trade.entryPrice)}</b></div>
        <div><label>Quantity</label><b>${trade.quantity}</b></div>
        <div><label>P&amp;L</label><b class="${tone(trade.pnl?.abs)}">${money(trade.pnl?.abs, { sign: true })}</b></div>
        <div><label>Return</label><b class="${tone(trade.pnl?.pct)}">${pct(trade.pnl?.pct)}</b></div>
        <div><label>${trade.pnl?.r != null ? 'R multiple' : 'Held'}</label><b>${trade.pnl?.r != null ? `${trade.pnl.r >= 0 ? '+' : ''}${trade.pnl.r.toFixed(2)}R` : `${trade.pnl?.holdingDays ?? 0}d`}</b></div>
      </div>

      <div class="chart">
        ${priceChart(trade)}
        <div class="chart-legend">
          <span><i style="border-color:var(--ink-3);border-top-style:dotted"></i>entry ${shortDate(trade.entryDate)}</span>
          ${trade.stopLoss != null ? '<span><i style="border-color:var(--bad);border-top-style:dashed"></i>stop</span>' : ''}
          ${trade.takeProfit != null ? '<span><i style="border-color:var(--good);border-top-style:dashed"></i>target</span>' : ''}
          ${closed ? `<span>exit ${shortDate(trade.exitDate)} · since exit ${pct(trade.pnl?.sinceExit)}</span>` : `<span>${trade.price?.live ? 'live' : `close ${shortDate(trade.price?.date)}`}${trade.price?.dayChange != null ? ` · day ${pct(trade.price.dayChange)}` : ''}</span>`}
        </div>
      </div>
      ${rangeHtml(trade)}

      ${trade.alerts?.length ? `<ul class="alerts">${trade.alerts.map((a) => `<li class="${a.level}">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.text)}</a>` : esc(a.text)}</li>`).join('')}</ul>` : ''}

      <div class="section-title"><h3>Five fundamental checks</h3><span>${trade.fundamentalsAsOf ? `filings to ${shortDate(trade.fundamentalsAsOf)}` : ''}</span></div>
      <div class="pillars">${(trade.pillars || []).map((p, i) => pillarHtml(p, i, trade, ui.openPillars.has(p.key))).join('')}</div>
      <p class="hint" style="margin:8px 2px 0">Scores rate the company (100 = strongest). Colours show support for your ${trade.direction} position; the tick marks the score at entry.</p>

      ${trade.thesis ? `<div class="section-title"><h3>Your thesis</h3></div><blockquote class="thesis">${esc(trade.thesis)}</blockquote>` : ''}

      <div class="section-title"><h3>News</h3><span>${trade.news?.length || 0} recent</span></div>
      ${newsHtml(trade, ui.expandedNews)}

      <div class="feeds">${Object.entries(feedNames)
        .map(([k, label]) => `<span class="${feeds[k] || 'pending'}" title="${feeds[k] || 'pending'}">${label}${feeds[k] === 'none' ? ' (none filed)' : feeds[k] === 'unsupported' ? ' (not on plan)' : ''}</span>`)
        .join('')}</div>

      <div class="detail-actions">
        <button class="btn small" data-action="edit" type="button">Edit</button>
        ${closed ? '' : '<button class="btn small" data-action="close-trade" type="button">Close trade</button>'}
        <button class="btn small" data-action="refresh" type="button">Refresh data</button>
        <button class="btn small ghost danger" data-action="delete" type="button">Delete</button>
      </div>
    </div>`);
  if (switched) el.scrollTop = 0;
}
