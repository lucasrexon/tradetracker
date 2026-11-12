/** Minimal event emitter that runs in Node and the browser. */
export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return this;
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) fn(...args);
    return this;
  }
}
