# Cape Watcher

Hourly snapshots of Minecraft cape popularity from [`crafter-api.qwerrie.ee/top/capes`](https://crafter-api.qwerrie.ee/top/capes), with a Chart.js dashboard on GitHub Pages.

**Dashboard:** https://qwertyquarty.github.io/cape-watcher/

## How it works

- A GitHub Actions workflow ([`.github/workflows/watch.yml`](.github/workflows/watch.yml)) runs on the hour.
- It fetches the current cape snapshot (a browser `User-Agent` is required to pass Cloudflare) into `capes.json`.
- [`scripts/update.js`](scripts/update.js) appends a per-cape data point `[unixTs, current_wearers, total_wearers]` to `history.json` **only when that cape's counts changed**. Identical hours are skipped; a liveness heartbeat commits at least once per day.
- `index.html` reads `history.json` client-side (same origin, no fetch call to the API) and renders a single line chart with **every cape** as its own line, plus a **TOTAL capes** aggregate line (sum of the selected metric across all capes). A toggle switches between current and total wearers.

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
  }
}
```