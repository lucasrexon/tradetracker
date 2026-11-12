/**
 * Priority queue + sliding-window limiter. Massive's free plan allows five
 * requests per minute, so every outbound call goes through here. Lower
 * priority numbers run first; jobs sharing a key are collapsed into one.
 */
export class RateLimiter {
  constructor({ perMinute = 5, windowMs = 61_000, now = () => Date.now() } = {}) {
    this.perMinute = perMinute;
    this.windowMs = windowMs;
    this.now = now;
    this.sent = [];
    this.queue = [];
    this.byKey = new Map();
    this.cooldownUntil = 0;
    this.inFlight = 0;
    this.timer = null;
    this.seq = 0;
  }

  schedule(fn, { priority = 5, key } = {}) {
    if (key && this.byKey.has(key)) {
      const job = this.byKey.get(key);
      if (priority < job.priority) {
        job.priority = priority;
        this.sort();
      }
      return job.promise;
    }
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job = { fn, priority, key, seq: this.seq++, resolve, reject, promise };
    this.queue.push(job);
    if (key) this.byKey.set(key, job);
    this.sort();
    this.pumpSoon();
    return promise;
  }

  /** Defer dispatch so jobs scheduled together are ordered by priority first. */
  pumpSoon() {
    if (this.pumpQueued) return;
    this.pumpQueued = true;
    queueMicrotask(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }

  /** Stop sending for `ms` (used after the API reports a rate-limit hit). */
  pause(ms) {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
    this.pump();
  }

  has(key) {
    return this.byKey.has(key);
  }

  sort() {
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  }

  waitMs() {
    const now = this.now();
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    let wait = Math.max(0, this.cooldownUntil - now);
    if (this.sent.length >= this.perMinute) {
      wait = Math.max(wait, this.sent[0] + this.windowMs - now);
    }
    return wait;
  }

  pump() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length) {
      const wait = this.waitMs();
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait + 5);
        return;
      }
      const job = this.queue.shift();
      if (job.key) this.byKey.delete(job.key);
      this.sent.push(this.now());
      this.inFlight++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.inFlight--;
        });
    }
  }

  stats() {
    return {
      perMinute: this.perMinute,
      queued: this.queue.length,
      inFlight: this.inFlight,
      usedThisWindow: this.sent.filter((t) => this.now() - t < this.windowMs).length,
      nextSlotInMs: this.queue.length ? this.waitMs() : 0,
      coolingDown: this.cooldownUntil > this.now(),
    };
  }
}
