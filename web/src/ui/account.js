import { esc, money, pct, tone, shortDate } from '../format.js';
import { dial } from './charts.js';
import { morph } from './morph.js';

/** Portfolio value over time, with the capital you put in as a dashed line. */
function valueChart(a, { width = 368, height = 150 } = {}) {
  const curve = a.curve || [];
  if (curve.length < 2) return '<div class="empty">The value chart appears once you have trades.</div>';
  const pad = { l: 4, r: 52, t: 10, b: 16 };
  const vals = curve.map((c) => c[1]);
  const refs = a.hasCapital ? [a.contributed] : [0];
  let lo = Math.min(...vals, ...refs);
  let hi = Math.max(...vals, ...refs);
  const span = hi - lo || Math.abs(hi) || 1;
  lo -= span * 0.08;
  hi += span * 0.08;
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / (curve.length - 1)) * w;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * h;
  const line = curve.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c[1]).toFixed(1)}`).join('');
  // Capital put in, stepping up/down with each deposit or withdrawal.
  const fundedAt = (date) =>
    a.hasCapital
      ? (a.startDate && date < a.startDate ? 0 : a.capital) + (a.flows || []).filter((f) => f.date <= date).reduce((s2, f) => s2 + f.amount, 0)
      : 0;
  const funded = curve.map((c) => fundedAt(c[0]));
  const fundedLine = funded.map((v, i) => `${i ? `H${x(i).toFixed(1)}V` : `M${x(i).toFixed(1)},`}${y(v).toFixed(1)}`).join('');
  const base = y(funded.at(-1));
  const bottom = pad.t + h;
  const area = `${line}L${x(curve.length - 1).toFixed(1)},${bottom}L${pad.l},${bottom}Z`;
  const up = vals.at(-1) >= funded.at(-1);
  const stroke = up ? 'var(--good)' : 'var(--bad)';
  const dd = a.drawdown;
  const ddFrom = dd?.from ? curve.findIndex((c) => c[0] >= dd.from) : -1;
  const ddTo = dd?.to ? curve.findIndex((c) => c[0] >= dd.to) : -1;
  const lastY = y(vals.at(-1));
  const fmtAxis = (v) => money(v, { compact: true });
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Portfolio value from ${shortDate(curve[0][0])} to ${shortDate(curve.at(-1)[0])}">
    <defs><linearGradient id="valfill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${stroke}" stop-opacity="0.22"/><stop offset="1" stop-color="${stroke}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${ddFrom >= 0 && ddTo > ddFrom ? `<rect x="${x(ddFrom).toFixed(1)}" y="${pad.t}" width="${(x(ddTo) - x(ddFrom)).toFixed(1)}" height="${h}" fill="var(--bad)" opacity="0.07"><title>Max drawdown</title></rect>` : ''}
    <path d="${area}" fill="url(#valfill)"/>
    <path d="${fundedLine}" fill="none" stroke="var(--ink-3)" stroke-width="1.2" stroke-dasharray="3 3"/>
    ${Math.abs(base - lastY) > 11 ? `<text class="axis" x="${pad.l + w + 4}" y="${(base + 3).toFixed(1)}">${a.hasCapital ? 'capital' : 'break-even'}</text>` : ''}
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(curve.length - 1).toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="${stroke}"/>
    <text class="axis" x="${pad.l + w + 4}" y="${(lastY + 3).toFixed(1)}" font-weight="600" fill="${stroke}">${fmtAxis(vals.at(-1))}</text>
    <text class="axis" x="${pad.l}" y="${height - 3}">${shortDate(curve[0][0])}</text>
    <text class="axis" x="${pad.l + w}" y="${height - 3}" text-anchor="end">${shortDate(curve.at(-1)[0])}</text>
  </svg>`;
}

function recordHtml(r) {
  if (!r.closed) {
    return `<div class="empty">Close your first trade to start a track record.${r.openCount ? ` Right now ${r.openInProfit} of ${r.openCount} open trades are in profit.` : ''}</div>`;
  }
  const rate = r.winRate == null ? null : Math.round(r.winRate * 100);
  const winW = (r.wins / r.closed) * 100;
  const lossW = (r.losses / r.closed) * 100;
  const pf = r.noLosses ? 'no losses' : r.profitFactor == null ? '—' : `${r.profitFactor.toFixed(2)}×`;
  const streak = r.streak ? `${r.streak.count} ${r.streak.kind === 'win' ? 'win' : r.streak.kind === 'loss' ? 'loss' : 'flat'}${r.streak.count > 1 ? (r.streak.kind === 'loss' ? 'es' : 's') : ''}` : '—';
  const dirRate = (d) => (d.count ? `${Math.round(d.winRate * 100)}% <small>of ${d.count}</small>` : '—');
  const rows = [
    ['Average win', `${money(r.avgWin)} <small>${pct(r.avgWinPct)}</small>`, 'up'],
    ['Average loss', r.avgLoss == null ? '—' : `−${money(r.avgLoss)} <small>${pct(r.avgLossPct)}</small>`, r.avgLoss == null ? '' : 'down'],
    ['Profit factor', pf, '', 'Money won ÷ money lost on closed trades'],
    ['Expectancy', `${money(r.expectancy, { sign: true })} <small>per trade</small>`, tone(r.expectancy), 'Average result of a closed trade'],
    ['Average R', r.avgR == null ? '— <small>set stops</small>' : `${r.avgR >= 0 ? '+' : ''}${r.avgR.toFixed(2)}R <small>${r.rCount} with stops</small>`, tone(r.avgR), 'Result in multiples of the risk you set with your stop'],
    ['Average hold', r.avgHoldDays == null ? '—' : `${Math.round(r.avgHoldDays)} days`, ''],
    ['Best trade', r.best ? `${esc(r.best.ticker)} ${money(r.best.abs, { sign: true })}` : '—', r.best ? tone(r.best.abs) : ''],
    [r.worst && r.worst.abs > 0 ? 'Smallest win' : 'Worst trade', r.worst ? `${esc(r.worst.ticker)} ${money(r.worst.abs, { sign: true })}` : '—', r.worst ? tone(r.worst.abs) : ''],
    ['Current streak', streak, r.streak?.kind === 'win' ? 'up' : r.streak?.kind === 'loss' ? 'down' : ''],
    ['Long win rate', dirRate(r.long), ''],
    ['Short win rate', dirRate(r.short), ''],
    ['Open in profit', r.openCount ? `${r.openInProfit} of ${r.openCount}` : '—', ''],
  ];
  return `<div class="record">
      ${dial(rate, { label: 'SUCCESS' })}
      <div>
        <p class="record-line"><b>${r.wins}</b> win${r.wins === 1 ? '' : 's'} · <b>${r.losses}</b> loss${r.losses === 1 ? '' : 'es'}${r.flat ? ` · ${r.flat} flat` : ''} <span>of ${r.closed} closed trade${r.closed === 1 ? '' : 's'}</span></p>
        <div class="wl" aria-hidden="true"><i class="w" style="width:${winW}%"></i><i class="l" style="width:${lossW}%"></i></div>
        <p class="hint" style="margin:6px 0 0">Success rate = closed trades that made money.</p>
      </div>
    </div>
    <dl class="stat-list">${rows
      .map(([k, v, cls, hint]) => `<div${hint ? ` title="${esc(hint)}"` : ''}><dt>${k}</dt><dd class="num ${cls}">${v}</dd></div>`)
      .join('')}</dl>`;
}

function formHtml(draft, errors, saving) {
  const flows = draft.flows
    .map(
      (f, i) => `<div class="flow-row" data-index="${i}">
        <input id="flow-date-${i}" type="date" data-field="date" value="${esc(f.date)}" aria-label="Date" />
        <input id="flow-amount-${i}" type="number" step="any" inputmode="decimal" data-field="amount" value="${esc(f.amount)}" placeholder="+5000 or −2000" aria-label="Amount" />
        <input id="flow-note-${i}" type="text" data-field="note" value="${esc(f.note)}" placeholder="Note" aria-label="Note" />
        <button class="icon-btn" type="button" data-action="flow-remove" aria-label="Remove this entry"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>`,
    )
    .join('');
  return `<form class="capital-form" id="capital-form" novalidate>
    <div class="grid">
      <label class="field"><span>Starting capital (USD)</span><input id="acct-capital" type="number" min="0" step="any" inputmode="decimal" data-field="startingCapital" value="${esc(draft.startingCapital)}" placeholder="25000" /></label>
      <label class="field"><span>Funded on</span><input id="acct-start" type="date" data-field="startDate" value="${esc(draft.startDate)}" /></label>
    </div>
    <div class="flows">
      <span class="flows-title">Deposits and withdrawals <em>use a negative amount to withdraw</em></span>
      ${flows || '<p class="hint" style="margin:4px 0 0">None yet.</p>'}
      <button class="btn small ghost" type="button" data-action="flow-add">+ Add deposit or withdrawal</button>
    </div>
    ${errors?.length ? `<div class="form-errors"><ul style="margin:0;padding:0">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="form-actions"><button class="btn primary" type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save capital'}</button></div>
  </form>`;
}

export function draftFrom(a) {
  return {
    startingCapital: a?.hasCapital ? String(a.capital) : '',
    startDate: a?.startDate || '',
    flows: (a?.flows || []).map((f) => ({ id: f.id, date: f.date, amount: String(f.amount), note: f.note || '' })),
  };
}

export function renderAccount(el, state, ui) {
  const a = state.account;
  el.hidden = false;
  const switched = el.dataset.id !== 'account';
  el.dataset.id = 'account';
  el.setAttribute('aria-label', 'Account');
  if (!ui.accountDraft) ui.accountDraft = draftFrom(a);
  const exposure = a.exposure == null ? '' : ` <small>${Math.round(a.exposure * 100)}%</small>`;

  morph(el, `
    <div class="detail-head">
      <div>
        <p class="eyebrow" style="margin:0 0 4px">Account</p>
        <h2 class="num">${a.hasCapital ? money(a.equity) : money(a.realized + a.unrealized, { sign: true })}</h2>
        <div class="co">${
          a.hasCapital
            ? `<span class="${tone(a.totalReturn)}"><b>${pct(a.totalReturn)}</b> ${money(a.realized + a.unrealized, { sign: true })}</span> since ${shortDate(a.startDate || a.curve?.[0]?.[0])}`
            : 'Total P&amp;L. Add your capital below to see portfolio value and return.'
        }${a.sample ? ' <span class="pill">example capital</span>' : ''}</div>
      </div>
      <button class="icon-btn close" data-action="close" type="button" aria-label="Close account">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="detail-body">
      <div class="chart">${valueChart(a)}
        <div class="chart-legend"><span><i style="border-color:var(--ink-3);border-top-style:dashed"></i>${a.hasCapital ? 'capital put in' : 'break-even'}</span>${
          a.drawdown?.abs < 0 ? `<span><i style="border-color:var(--bad);border-top-width:6px;opacity:.3"></i>max drawdown</span>` : ''
        }<span>daily closes, today at latest price</span></div>
      </div>

      <div class="kv">
        <div><label>Capital put in</label><b>${a.hasCapital ? money(a.contributed, { compact: true }) : '—'}</b></div>
        <div><label>Invested</label><b>${money(a.invested, { compact: true })}${exposure}</b></div>
        <div><label>Available</label><b>${a.available == null ? '—' : money(a.available, { compact: true })}</b></div>
        <div><label>Realized</label><b class="${tone(a.realized)}">${money(a.realized, { sign: true, compact: true })}</b></div>
        <div><label>Open P&amp;L</label><b class="${tone(a.unrealized)}">${money(a.unrealized, { sign: true, compact: true })}</b></div>
        <div><label>Max drawdown</label><b class="${a.drawdown?.abs < 0 ? 'down' : ''}">${a.drawdown?.pct != null ? pct(a.drawdown.pct) : a.drawdown?.abs < 0 ? money(a.drawdown.abs, { compact: true }) : '—'}</b></div>
      </div>
      <p class="hint" style="margin:6px 2px 0">Available is an estimate: capital plus P&amp;L minus what's tied up in open positions (shorts counted at full value).</p>

      <div class="section-title"><h3>Success rate</h3><span>${a.record.closed} closed</span></div>
      ${recordHtml(a.record)}

      <div class="section-title"><h3>Your capital</h3><span>${a.netFlows ? `${money(a.netFlows, { sign: true, compact: true })} net deposits` : ''}</span></div>
      ${
        ui.canWrite
          ? formHtml(ui.accountDraft, ui.accountErrors, ui.accountSaving)
          : `<p class="hint">Capital ${a.hasCapital ? money(a.capital) : 'not set'}. You can view this tracker but not change it.</p>`
      }
    </div>`);
  if (switched) el.scrollTop = 0;
}
