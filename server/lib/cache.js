import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny persistent key/value store. Every entry remembers when it was fetched so
 * callers can decide freshness with their own TTL. Writes are debounced so a
 * burst of updates turns into one write to disk.
 */
export class Cache {
  constructor(file, { saveDelayMs = 1500 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.entries = new Map();
    this.timer = null;
    if (file && fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(raw)) this.entries.set(k, v);
      } catch (err) {
        console.warn(`[cache] ignoring unreadable cache file ${file}: ${err.message}`);
      }
    }
  }

  get(key) {
    return this.entries.get(key)?.value;
  }

  fetchedAt(key) {
    return this.entries.get(key)?.fetchedAt ?? 0;
  }

  has(key) {
    return this.entries.has(key);
  }

  isFresh(key, ttlMs, now = Date.now()) {
    const e = this.entries.get(key);
    return !!e && now - e.fetchedAt < ttlMs;
  }

  set(key, value, fetchedAt = Date.now()) {
    this.entries.set(key, { value, fetchedAt });
    this.scheduleSave();
  }

  delete(key) {
    this.entries.delete(key);
    this.scheduleSave();
  }

  scheduleSave() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.saveDelayMs);
    this.timer.unref?.();
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)));
    fs.renameSync(tmp, this.file);
  }
}
