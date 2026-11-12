/**
 * Warm, Claude-inspired palette: ivory paper, terracotta clay, kraft sand and
 * sage. Shared by the CSS (via custom properties) and the 3D scene.
 */
export const PALETTES = {
  light: {
    pool: { deep: '#D6C2A2', shallow: '#EADCC5', sheen: '#FFFFFF', shadow: '#5E4A33', sky: '#FBF3E6', accent: '#C8603E' },
    hemiSky: '#FFF1E0',
    hemiGround: '#BFA582',
    key: '#FFE4C8',
    rim: '#FFBE96',
    exposure: 0.95,
    bubble: '#F2D9C6',
  },
  dark: {
    pool: { deep: '#191714', shallow: '#2C2823', sheen: '#FFD9BC', shadow: '#000000', sky: '#4A3D33', accent: '#E07A55' },
    hemiSky: '#6B5A4C',
    hemiGround: '#1C1915',
    key: '#FFD7B5',
    rim: '#E7825A',
    exposure: 1.05,
    bubble: '#B9694A',
  },
};

// 0 = fundamentals fight the position, 100 = they strongly support it.
const RAMP = [
  [0, [0.6, 0.17, 0.11]],
  [30, [0.83, 0.38, 0.22]],
  [50, [0.89, 0.64, 0.35]],
  [70, [0.55, 0.67, 0.42]],
  [100, [0.22, 0.5, 0.34]],
];
const UNKNOWN = [0.7, 0.67, 0.62];

export function scoreRGB(score) {
  if (score == null || !Number.isFinite(score)) return UNKNOWN;
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < RAMP.length; i++) {
    if (s <= RAMP[i][0]) {
      const [x0, c0] = RAMP[i - 1];
      const [x1, c1] = RAMP[i];
      const k = (s - x0) / (x1 - x0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return RAMP.at(-1)[1];
}

export const scoreCss = (score) => {
  const [r, g, b] = scoreRGB(score);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
};

export const SENTIMENT = {
  positive: { css: '#6F9A74', rgb: [0.44, 0.6, 0.45], label: 'Positive' },
  negative: { css: '#C65A3E', rgb: [0.78, 0.35, 0.24], label: 'Negative' },
  neutral: { css: '#C9AE8A', rgb: [0.79, 0.68, 0.54], label: 'Neutral' },
  null: { css: '#B5ADA2', rgb: [0.71, 0.68, 0.64], label: 'Unrated' },
};

export const orient = (score, direction) => (score == null ? null : direction === 'short' ? 100 - score : score);

const KEY = 'tt-theme';
const listeners = new Set();
const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function currentTheme() {
  const pref = document.documentElement.dataset.theme;
  if (pref === 'light' || pref === 'dark') return pref;
  return media.matches ? 'dark' : 'light';
}

export function initTheme() {
  const pref = stored();
  if (pref === 'light' || pref === 'dark') document.documentElement.dataset.theme = pref;
  media.addEventListener('change', () => listeners.forEach((fn) => fn(currentTheme())));
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => fn(next));
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
