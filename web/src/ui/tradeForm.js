import { esc } from '../format.js';
import { api } from '../api.js';
import { parseTradesCsv } from '../csv.js';

const today = () => new Date().toISOString().slice(0, 10);
const val = (v) => (v == null ? '' : esc(v));

/**
 * Add / edit / close a trade, or import many from CSV.
 * mode: 'create' | 'edit' | 'close' | 'import'
 */
export function openTradeDialog(dialog, { mode = 'create', trade = null, onSaved }) {
  const t = trade || {};
  const isImport = mode === 'import';
  const title = { create: 'Add a trade', edit: `Edit ${t.ticker}`, close: `Close ${t.ticker}`, import: 'Import trades' }[mode];
  const lead = {
    create: 'Log an open or past position. Fundamentals and news start tracking right away.',
    edit: 'Changes re-run the five fundamental checks.',
    close: 'Record your exit. The trade moves to past trades with a post-mortem.',
    import: 'Paste a CSV or choose a file. One trade per row.',
  }[mode];
  const exitDefault = mode === 'close' ? { exitDate: today(), exitPrice: t.price?.last ? t.price.last.toFixed(2) : '' } : {};
  const exitDate = t.exitDate ?? exitDefault.exitDate ?? '';
  const exitPrice = t.exitPrice ?? exitDefault.exitPrice ?? '';

  dialog.innerHTML = `
    <form method="dialog" novalidate>
      <h2>${esc(title)}</h2>
      <p class="lead">${esc(lead)}</p>
      ${
        mode === 'create' || isImport
          ? `<div class="tabs" role="tablist">
              <button type="button" role="tab" data-tab="create" aria-selected="${!isImport}">Single trade</button>
              <button type="button" role="tab" data-tab="import" aria-selected="${isImport}">Import CSV</button>
            </div>`
          : ''
      }
      ${
        isImport
          ? `<div class="field full">
              <span>CSV</span>
              <textarea name="csv" rows="7" placeholder="ticker,direction,quantity,entry_date,entry_price,stop,target,exit_date,exit_price,notes&#10;AAPL,long,10,2026-03-02,241.10,220,290,,,Services growth"></textarea>
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
              <label class="btn small"><input type="file" accept=".csv,text/csv" name="file" hidden />Choose file</label>
              <span class="hint">Headers: <code>ticker</code>, <code>direction</code> (long/short), <code>quantity</code>, <code>entry_date</code>, <code>entry_price</code>, optional <code>stop</code>, <code>target</code>, <code>exit_date</code>, <code>exit_price</code>, <code>notes</code>.</span>
            </div>`
          : `<div class="grid">
              <label class="field"><span>Ticker</span><input name="ticker" value="${val(t.ticker)}" placeholder="AAPL" autocomplete="off" autocapitalize="characters" required ${mode === 'close' ? 'readonly' : ''} /></label>
              <div class="field"><span>Direction</span>
                <div class="segmented" role="radiogroup" aria-label="Direction">
                  <label><input type="radio" name="direction" value="long" ${t.direction !== 'short' ? 'checked' : ''} ${mode === 'close' ? 'disabled' : ''}/>Long</label>
                  <label><input type="radio" name="direction" value="short" ${t.direction === 'short' ? 'checked' : ''} ${mode === 'close' ? 'disabled' : ''}/>Short</label>
                </div>
              </div>
              <label class="field"><span>Quantity</span><input name="quantity" type="number" min="0" step="any" inputmode="decimal" value="${val(t.quantity)}" required /></label>
              <label class="field"><span>Entry price</span><input name="entryPrice" type="number" min="0" step="any" inputmode="decimal" value="${val(t.entryPrice)}" required /></label>
              <label class="field"><span>Entry date</span><input name="entryDate" type="date" max="${today()}" value="${val(t.entryDate || today())}" required /></label>
              <span></span>
              <label class="field"><span>Stop loss <em>optional</em></span><input name="stopLoss" type="number" min="0" step="any" inputmode="decimal" value="${val(t.stopLoss)}" /></label>
              <label class="field"><span>Target <em>optional</em></span><input name="takeProfit" type="number" min="0" step="any" inputmode="decimal" value="${val(t.takeProfit)}" /></label>
              <label class="field full"><span>Thesis <em>optional</em></span><textarea name="thesis" rows="2" placeholder="Why are you in this trade? What would prove you wrong?">${val(t.thesis)}</textarea></label>
              <details class="closed-fields" ${exitDate ? 'open' : ''}>
                <summary>This trade is closed</summary>
                <div class="grid">
                  <label class="field"><span>Exit date</span><input name="exitDate" type="date" max="${today()}" value="${val(exitDate)}" /></label>
                  <label class="field"><span>Exit price</span><input name="exitPrice" type="number" min="0" step="any" inputmode="decimal" value="${val(exitPrice)}" /></label>
                </div>
              </details>
            </div>`
      }
      <div class="form-errors" hidden></div>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
        <button type="submit" class="btn primary">${{ create: 'Add trade', edit: 'Save changes', close: 'Close trade', import: 'Import' }[mode]}</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form');
  const errors = dialog.querySelector('.form-errors');
  const showErrors = (list) => {
    errors.hidden = !list.length;
    errors.innerHTML = list.length ? `<ul style="margin:0;padding:0">${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  };

  dialog.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if ((b.dataset.tab === 'import') !== isImport) openTradeDialog(dialog, { mode: b.dataset.tab, onSaved });
    }),
  );
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  const file = form.querySelector('input[type="file"]');
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) form.elements.csv.value = await f.text();
  });
  const details = form.querySelector('details.closed-fields');
  details?.addEventListener('toggle', () => {
    if (!details.open) {
      form.elements.exitDate.value = '';
      form.elements.exitPrice.value = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErrors([]);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      if (isImport) {
        const rows = parseTradesCsv(form.elements.csv.value || '');
        if (!rows.length) throw Object.assign(new Error(''), { errors: ['Add a header row and at least one trade.'] });
        const res = await api.importTrades(rows);
        const failed = res.failed?.map((f) => `Row ${f.row}: ${f.errors.join(' ')}`) || [];
        if (failed.length) {
          showErrors([`Imported ${res.created}. Skipped:`, ...failed]);
          onSaved?.(null);
          return;
        }
        onSaved?.(null, `Imported ${res.created} trade${res.created === 1 ? '' : 's'}`);
      } else {
        const data = Object.fromEntries(new FormData(form).entries());
        if (mode === 'close') data.direction = t.direction;
        if (!data.exitDate) {
          data.exitDate = null;
          data.exitPrice = null;
        }
        const saved = mode === 'create' ? await api.createTrade(data) : await api.updateTrade(t.id, data);
        onSaved?.(saved, mode === 'create' ? `Tracking ${saved.ticker}` : mode === 'close' ? `${saved.ticker} closed` : 'Saved');
      }
      dialog.close();
    } catch (err) {
      showErrors(err.errors?.length ? err.errors : [err.message || 'Something went wrong.']);
    } finally {
      submit.disabled = false;
    }
  });

  if (!dialog.open) dialog.showModal();
  (form.querySelector('input:not([readonly]):not([type="radio"]), textarea') || form).focus();
}
