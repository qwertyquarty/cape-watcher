# Cape Watcher

Hourly snapshots of Minecraft cape popularity from [`crafter-api.qwerrie.ee/top/capes`](https://crafter-api.qwerrie.ee/top/capes), with a Chart.js dashboard on GitHub Pages.

**Dashboard:** https://qwertyquarty.github.io/cape-watcher/

## How it works

- A GitHub Actions workflow ([`.github/workflows/watch.yml`](.github/workflows/watch.yml)) runs roughly hourly. It has no `schedule:` trigger — it is dispatched externally, with a few minutes of jitter between runs.
- It fetches the current cape snapshot (a browser `User-Agent` is required to pass Cloudflare) into `capes.json`.
- [`scripts/update.js`](scripts/update.js) appends a per-cape data point `[unixTs, current_wearers, total_wearers]` to `history.json` **only when that cape's counts changed**. Identical hours are skipped; a liveness heartbeat commits at least once per day. `history.json` stores **raw counts only** — no percentages are ever written.
- `index.html` reads `history.json` client-side (same origin, no fetch call to the API) and charts each cape's **share of all cape wearers, in percent**, plus a white **TOTAL** line for the capes currently on screen. Shares are computed in the browser on a single union grid of every timestamp: a cape with no entry at a timestamp did not change, so its last value carries forward (the same rule the writer uses for `totals`), and that value is divided by the sum across **all** capes at that timestamp. A percentage is what makes the chart readable — raw counts drift upward whenever Crafter gains players, so a cape nobody left still "grows" in a week purely from population growth. Legend rows, the tooltip, the y-axis and the header (`TOP SHARE · <cape>`) are all percentages; the metric toggle switches between share of *current* wearers and share of *total* wearers. At most 24 lines are drawn at once (the `TOTAL` line accounts for the cap in its label).

## Files

- `capes.json` — latest snapshot (overwritten every run)
- `history.json` — accumulating time series per cape
- `index.html` — Chart.js dashboard
- `.github/workflows/watch.yml` — hourly fetch/update/deploy

## Data format

```json
{
  "updated": 1790254858,
  "names": { "8": "Pan", "42": "Twisted" },
  "series": {
    "8": [[1790254800, 41773, 56501], [1790258400, 41780, 56510]],
    "42": [[1790254800, 123, 456]]
  },
  "totals": [[1790254858, 61833, 74611, 44]]
}
```

- `series[capeId]` — change-only: `[unixTs, current_wearers, total_wearers]` points, present only for hours in which that cape's counts moved.
- `totals` — dense `[unixTs, currentSum, totalSum, capeCount]` rows, one per snapshot, written with the same carry-forward rule the dashboard applies. The dashboard computes its own denominators from `series` rather than reading this, but the two agree exactly.