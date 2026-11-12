/** Minimal Server-Sent Events hub. */
export class SseHub {
  constructor() {
    this.clients = new Set();
    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(': keep-alive\n\n');
    }, 25_000);
    this.heartbeat.unref?.();
  }

  attach(req, res, initial = []) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    for (const [event, data] of initial) this.write(res, event, data);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  write(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) res.write(payload);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
