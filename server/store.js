import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateTrade } from './analysis/validate.js';

export { validateTrade };

/** Trades persisted as a JSON array. Seeded from the sample file on first run. */
export class TradeStore {
  constructor(file, sampleFile) {
    this.file = file;
    if (!fs.existsSync(file)) {
      const seed = sampleFile && fs.existsSync(sampleFile) ? JSON.parse(fs.readFileSync(sampleFile, 'utf8')) : [];
      this.trades = seed.map((t) => ({ ...t, id: t.id || crypto.randomUUID(), sample: true }));
      this.save();
    } else {
      this.trades = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }

  list() {
    return this.trades.slice();
  }

  get(id) {
    return this.trades.find((t) => t.id === id) || null;
  }

  create(input) {
    const { trade, errors } = validateTrade({ ...input, id: undefined });
    if (errors.length) return { errors };
    this.trades.push(trade);
    this.save();
    return { trade };
  }

  update(id, patch) {
    const i = this.trades.findIndex((t) => t.id === id);
    if (i < 0) return { notFound: true };
    const { trade, errors } = validateTrade({ ...patch, id }, this.trades[i]);
    if (errors.length) return { errors };
    trade.sample = false;
    this.trades[i] = trade;
    this.save();
    return { trade };
  }

  remove(id) {
    const before = this.trades.length;
    this.trades = this.trades.filter((t) => t.id !== id);
    if (this.trades.length !== before) this.save();
    return before !== this.trades.length;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.trades, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
