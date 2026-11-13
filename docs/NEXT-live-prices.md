# Next step: 10-minute prices on the hosted site

The user wants open positions priced every 10 minutes on the hosted site
(https://claude.ai/artifact/6SzcG2CkbNcBhBTQM9cYKV). Their Massive plan is
free and has no intraday or same-day data, so prices will come from a
market-data **claude.ai connector** the user connects (Alpha Vantage,
Financial Datasets or Webull were suggested). Work on branch
`claude/live-trade-tracker-b4n5bp`.

## Plan

1. **Learn the connector's quote tool.** In the session where the connector
   is enabled, find its quote / snapshot tool and call it once for `NVDA`.
   Record the exact upstream tool name, its input schema and the real result
   shape. Don't build against a guessed shape.
2. **Fetch quotes from the page.** In `web/src/hosted/api.js`
   (`startHosted`), after `claude.use("mcp")`, register one
   `mcp.watchTool(server, tool, input, handler, { refetchInterval: 600_000 })`
   per open ticker. Use a batch tool instead if the connector has one.
   Map each `data` event's `result.payload` to `{ price, date, at }` and call
   `engine.accept({ key: 'live:' + T, name: 'live', ticker: T }, quote)`.
   - The engine already prefers a live quote over the last daily bar when it
     is newer (`server/engine.js` → `recompute`).
   - `evaluateTrade` clears "awaiting price" once a live quote dated on or
     after the entry exists.
   - Re-register watches when the set of open tickers changes, and
     unsubscribe the old ones.
3. **Errors.** Follow the failure doctrine in the `mcp` type definitions:
   - `needs_reauth` and `server_not_connected` mean show "reconnect / add the
     connector" copy and drop live quotes back to daily bars.
   - `approval_required` means show a button that makes one `callTool`.
   - Transient errors keep the last quote and show it as stale.
4. **UI.** Show "price updated N min ago" (from `result.cache.storedAt`,
   else receipt time) in the status chip and the trade panel. The cell label
   and row already show the % vs entry.
5. **Publish.** Run `npm run build:hosted`, then republish
   `web/dist-hosted/page.html` with the changed `assets/*` files (old hashed
   files mapped to `null`).
   - Declare `capabilities` as the **full set**: the existing `db` rules
     (`trades`, `settings`, `requests`, `market`, `news`, `filings`, `macro`,
     `meta`), `user: {}`, `sample: {}`.
   - Add `mcp: { servers: [{ server: "<connector display name>", tools: ["<quote tool>"] }] }`.
6. **Test.** Before publishing, test locally with the mock harness approach
   (fake `window.claude.use("mcp")` returning a `watchTool` that emits the
   recorded payload shape). After publishing, tell the user the first visit
   asks permission for the connector.

## Current data in the site

One real trade (NVDA long 11 @ 164.06, bought 2026-11-12), with capital
$2,660 starting 2026-11-12. Market docs were synced on 2026-11-12. The
headline % is open P&L divided by the cost of open positions ("vs entry").
