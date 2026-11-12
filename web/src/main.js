import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './styles.css';
import { api, connect } from './api.js';
import { initTheme, currentTheme, toggleTheme, onThemeChange, SENTIMENT } from './theme.js';
import { World } from './scene/World.js';
import { renderPortfolio, renderStatus, renderLegend, NewsRiver, toast } from './ui/hud.js';
import { renderDetail } from './ui/detail.js';
import { renderAccount, draftFrom } from './ui/account.js';
import { openTradeDialog } from './ui/tradeForm.js';

initTheme();

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'),
  portfolio: $('portfolio'),
  detail: $('detail'),
  status: $('status'),
  river: $('river'),
  legend: $('legend'),
  toasts: $('toasts'),
  dialog: $('trade-dialog'),
  boot: $('boot'),
};

const ui = {
  state: null,
  selectedId: null,
  hoverId: null,
  connection: 'connecting',
  openPillars: new Set(['valuation']),
  expandedNews: new Set(),
  collapsed: window.matchMedia('(max-width: 900px)').matches,
  alerted: new Set(),
  canWrite: true,
  canAsk: typeof api.askClaude === 'function',
  reads: new Map(),
  confirmDelete: null,
  view: null, // 'account' while the account panel is open
  accountDraft: null,
  accountErrors: [],
  accountSaving: false,
};

let world = null;
try {
  world = new World(els.stage, {
    theme: currentTheme(),
    onSelect: (id) => select(id),
    onHover: (id) => {
      ui.hoverId = id;
      if (ui.state) renderPortfolio(els.portfolio, ui.state, ui);
    },
  });
} catch (err) {
  console.error(err);
  els.stage.innerHTML = '<div class="empty" style="padding-top:40vh">WebGL is unavailable, so the 3D view is off. The panels still work.</div>';
}
onThemeChange((name) => world?.setTheme(name));
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) window.__world = world;

const river = new NewsRiver(els.river, {
  onPick: (ticker, articleId) => {
    const trade = ui.state?.trades.find((t) => t.ticker === ticker && t.status === 'open') || ui.state?.trades.find((t) => t.ticker === ticker);
    if (!trade) return;
    ui.expandedNews.add(articleId);
    select(trade.id);
  },
});
renderLegend(els.legend);

function current() {
  return ui.state?.trades.find((t) => t.id === ui.selectedId) || null;
}

function select(id) {
  if (id && id === ui.selectedId && !els.detail.hidden && ui.view !== 'account') return;
  ui.selectedId = id || null;
  ui.view = null;
  ui.confirmDelete = null;
  world?.select(ui.selectedId);
  render();
}

const desktop = window.matchMedia('(min-width: 901px)');

function updateInsets() {
  if (!world) return;
  if (!desktop.matches) return world.setInsets({ left: 0, right: 0 });
  const left = els.portfolio.getBoundingClientRect().right;
  const right = els.detail.hidden ? 0 : window.innerWidth - els.detail.getBoundingClientRect().left;
  world.setInsets({ left, right });
}

function render() {
  if (!ui.state) return;
  renderPortfolio(els.portfolio, ui.state, ui);
  renderStatus(els.status, ui.state, ui.connection);
  if (ui.view === 'account' && ui.state.account) renderAccount(els.detail, ui.state, ui);
  else renderDetail(els.detail, current(), ui);
  river.render(ui.state);
  updateInsets();
}

function openAccount() {
  if (ui.view === 'account') return select(null);
  ui.selectedId = null;
  world?.select(null);
  ui.view = 'account';
  ui.accountDraft = draftFrom(ui.state?.account);
  ui.accountErrors = [];
  render();
}

window.addEventListener('resize', updateInsets);

function checkAlerts(state) {
  for (const t of state.trades) {
    if (t.status !== 'open') continue;
    for (const a of t.alerts || []) {
      if (a.level !== 'danger' && a.level !== 'warn') continue;
      const key = `${t.id}:${a.text}`;
      if (ui.alerted.has(key)) continue;
      ui.alerted.add(key);
      // Don't flood on first load; just remember what was already true.
      if (!state.__first) {
        toast(els.toasts, {
          title: `${t.ticker}: ${a.text}`,
          color: a.level === 'danger' ? 'var(--bad)' : 'var(--warn)',
          onClick: () => select(t.id),
        });
      }
    }
  }
}

let first = true;
connect({
  onState(state) {
    state.__first = first;
    ui.state = state;
    ui.canWrite = state.hosted?.canWrite ?? true;
    document.getElementById('add-trade').hidden = !ui.canWrite;
    world?.update(state);
    if (ui.selectedId && !current()) ui.selectedId = null;
    checkAlerts(state);
    render();
    if (first) {
      first = false;
      els.boot.classList.add('gone');
      setTimeout(() => els.boot.remove(), 700);
    }
  },
  onNews({ ticker, article }) {
    world?.dropNews(ticker, article);
    river.markFresh(article.id);
    const s = SENTIMENT[article.sentiment] || SENTIMENT.null;
    const trade = ui.state?.trades.find((t) => t.ticker === ticker && t.status === 'open');
    const adverse = trade && ((trade.direction === 'long' && article.sentiment === 'negative') || (trade.direction === 'short' && article.sentiment === 'positive'));
    toast(els.toasts, {
      title: `${ticker}: ${article.title}`,
      body: `${article.publisher} · ${s.label}${adverse ? ' · against your position' : ''}`,
      color: s.css,
      ttl: adverse ? 9000 : 5000,
      onClick: () => trade && select(trade.id),
    });
    if (ui.state) river.render(ui.state);
  },
  onConnection(c) {
    ui.connection = c;
    if (ui.state) renderStatus(els.status, ui.state, c);
  },
});

const afterSave = (saved, message) => {
  if (message) toast(els.toasts, { title: message, color: 'var(--good)', ttl: 3500 });
  // Select once the next state containing the trade has arrived.
  if (saved?.id) setTimeout(() => select(saved.id), 600);
};

$('add-trade').addEventListener('click', () => openTradeDialog(els.dialog, { mode: 'create', onSaved: afterSave }));
$('theme-toggle').addEventListener('click', toggleTheme);
$('legend-toggle').addEventListener('click', (e) => {
  els.legend.hidden = !els.legend.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!els.legend.hidden));
});
els.legend.addEventListener('click', () => {
  els.legend.hidden = true;
  $('legend-toggle').setAttribute('aria-expanded', 'false');
});

els.portfolio.addEventListener('click', (e) => {
  const row = e.target.closest('.trade-row');
  if (row) return select(row.dataset.id === ui.selectedId ? null : row.dataset.id);
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'import') openTradeDialog(els.dialog, { mode: 'import', onSaved: afterSave });
  if (action === 'account') openAccount();
  if (action === 'collapse') {
    ui.collapsed = !ui.collapsed;
    render();
  }
});
els.portfolio.addEventListener('mouseover', (e) => {
  const row = e.target.closest('.trade-row');
  const id = row?.dataset.id || null;
  if (id !== ui.hoverId) ui.hoverId = id;
});

els.detail.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (ui.view === 'account') return accountAction(btn);
  const trade = current();
  if (!trade) return;
  switch (btn.dataset.action) {
    case 'close':
      select(null);
      break;
    case 'ask': {
      const id = trade.id;
      const read = { state: 'loading', text: '' };
      ui.reads.set(id, read);
      renderDetail(els.detail, trade, ui);
      const rerender = () => current()?.id === id && renderDetail(els.detail, current(), ui);
      try {
        const res = await api.askClaude(trade, {
          onText: ({ text }) => {
            read.text = text;
            rerender();
          },
        });
        read.text = res.text;
        read.truncated = res.truncated;
        read.state = 'done';
      } catch (err) {
        read.state = 'error';
        read.error = err.code === 'not_granted' ? 'Claude was not allowed for this page.' : err.code === 'rate_limited' ? 'Too many requests. Try again in a minute.' : err.message || 'Claude could not answer.';
        if (err.code === 'not_granted') ui.canAsk = false;
      }
      rerender();
      break;
    }
    case 'pillar': {
      const key = btn.dataset.key;
      ui.openPillars.has(key) ? ui.openPillars.delete(key) : ui.openPillars.add(key);
      renderDetail(els.detail, trade, ui);
      break;
    }
    case 'why':
      ui.expandedNews.add(btn.dataset.id);
      renderDetail(els.detail, trade, ui);
      break;
    case 'edit':
      openTradeDialog(els.dialog, { mode: 'edit', trade, onSaved: afterSave });
      break;
    case 'close-trade':
      openTradeDialog(els.dialog, { mode: 'close', trade, onSaved: afterSave });
      break;
    case 'refresh': {
      const res = await api.refresh(trade.ticker).catch((err) => ({ message: err.message }));
      toast(els.toasts, { title: `Refreshing ${trade.ticker}`, body: res?.message || 'Queued within your API rate limit.', ttl: 3500 });
      break;
    }
    case 'delete':
      ui.confirmDelete = trade.id;
      renderDetail(els.detail, trade, ui);
      break;
    case 'delete-cancel':
      ui.confirmDelete = null;
      renderDetail(els.detail, trade, ui);
      break;
    case 'delete-confirm':
      ui.confirmDelete = null;
      try {
        await api.deleteTrade(trade.id);
        select(null);
        toast(els.toasts, { title: `${trade.ticker} trade deleted`, ttl: 3000 });
      } catch (err) {
        toast(els.toasts, { title: err.message, color: 'var(--bad)' });
      }
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.key === 'Escape') {
    if (!els.legend.hidden) els.legend.hidden = true;
    else select(null);
  }
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey) openTradeDialog(els.dialog, { mode: 'create', onSaved: afterSave });
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') && ui.state?.trades.length) {
    const list = ui.state.trades;
    const i = list.findIndex((t) => t.id === ui.selectedId);
    const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1;
    const next = list[(i + step + list.length) % list.length];
    if (i >= 0 || step > 0) {
      e.preventDefault();
      select(next.id);
    }
  }
});

// Refresh relative times in the river.
setInterval(() => ui.state && river.render(ui.state), 30_000);

// ---------- Account panel ----------

function accountAction(btn) {
  const draft = ui.accountDraft;
  switch (btn.dataset.action) {
    case 'close':
      select(null);
      break;
    case 'flow-add':
      draft.flows.push({ date: new Date().toISOString().slice(0, 10), amount: '', note: '' });
      render();
      document.getElementById(`flow-amount-${draft.flows.length - 1}`)?.focus();
      break;
    case 'flow-remove': {
      const row = btn.closest('.flow-row');
      if (row) draft.flows.splice(Number(row.dataset.index), 1);
      render();
      break;
    }
  }
}

els.detail.addEventListener('input', (e) => {
  if (ui.view !== 'account' || !ui.accountDraft) return;
  const field = e.target.dataset.field;
  if (!field) return;
  const row = e.target.closest('.flow-row');
  if (row) ui.accountDraft.flows[Number(row.dataset.index)][field] = e.target.value;
  else ui.accountDraft[field] = e.target.value;
});

els.detail.addEventListener('submit', async (e) => {
  if (e.target.id !== 'capital-form') return;
  e.preventDefault();
  ui.accountErrors = [];
  ui.accountSaving = true;
  render();
  try {
    const saved = await api.saveAccount(ui.accountDraft);
    ui.accountDraft = {
      startingCapital: saved.startingCapital ? String(saved.startingCapital) : '',
      startDate: saved.startDate || '',
      flows: saved.flows.map((f) => ({ id: f.id, date: f.date, amount: String(f.amount), note: f.note })),
    };
    toast(els.toasts, { title: 'Capital saved', body: 'Portfolio value and return now use it.', color: 'var(--good)', ttl: 3500 });
  } catch (err) {
    ui.accountErrors = err.errors?.length ? err.errors : [err.message];
  } finally {
    ui.accountSaving = false;
    render();
  }
});
