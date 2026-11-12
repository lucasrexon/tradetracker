/** In-memory key/value store with fetch timestamps (same API as Cache). */
export class MemoryCache {
  constructor() {
    this.entries = new Map();
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
  }

  delete(key) {
    this.entries.delete(key);
  }

  flush() {}
}
