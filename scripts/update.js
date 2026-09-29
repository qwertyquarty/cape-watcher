const fs = require('fs')
const path = require('path')

const { computeTotals, latestTimestamp } = require('./lib')

const ROOT = path.resolve(__dirname, '..')
const CAPES_PATH = path.join(ROOT, 'capes.json')
const HISTORY_PATH = path.join(ROOT, 'history.json')

const DAY_MS = 24 * 60 * 60 * 1000

// Minimum seconds between rows in `totals`. Caps growth at ~2 rows/hour instead
// of one per run, and keeps the row meaningful rather than duplicating a value.
const TOTALS_MIN_INTERVAL_S = 30 * 60

function loadCapes() {
  if (!fs.existsSync(CAPES_PATH)) throw new Error('capes.json missing')
  const capes = JSON.parse(fs.readFileSync(CAPES_PATH, 'utf8'))
  if (!Array.isArray(capes)) throw new Error('capes.json is not an array')
  return capes.map((c) => ({
    id: Number(c.id),
    // Keep the real name, including null. Substituting `#44` here would bake a
    // placeholder into history.names and the chart would be stuck on it even
    // after the cape gets a real name upstream.
    name: c.name === null || c.name === undefined || c.name === '' ? null : String(c.name),
    current: Number(c.current_wearers),
    total: Number(c.total_wearers),
  }))
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { updated: 0, names: {}, series: {}, totals: [] }
  }
  const raw = fs.readFileSync(HISTORY_PATH, 'utf8').trim()
  if (!raw) return { updated: 0, names: {}, series: {}, totals: [] }
  const parsed = JSON.parse(raw)
  return {
    updated: parsed.updated || 0,
    names: parsed.names || {},
    series: parsed.series || {},
    totals: Array.isArray(parsed.totals) ? parsed.totals : [],
  }
}

function lastPoint(series) {
  return series && series.length ? series[series.length - 1] : null
}

function main() {
  const capes = loadCapes()
  const history = loadHistory()
  const now = Math.floor(Date.now() / 1000)

  // Per-cape points stay change-only: 44 capes x 24 runs/day would otherwise
  // bloat history.json by ~1k rows a day for no extra information.
  let appended = 0
  for (const cape of capes) {
    const id = String(cape.id)
    if (cape.name !== null) history.names[id] = cape.name
    const series = history.series[id] || (history.series[id] = [])
    const last = lastPoint(series)
    if (!last || last[1] !== cape.current || last[2] !== cape.total) {
      series.push([now, cape.current, cape.total])
      appended++
    }
  }

  // Authoritative total: recomputed from the full series every run, so it
  // self-heals historical rows and never depends on which capes moved. This
  // also backfills `totals` for all prior timestamps on the first run.
  const computed = computeTotals(history.series)
  const prevTotals = history.totals || []
  const prevLatest = prevTotals.length ? Number(prevTotals[prevTotals.length - 1][0]) : null
  const merged = prevLatest !== null && computed.length && computed[computed.length - 1][0] === prevLatest
    ? prevTotals.concat(computed.filter((row) => Number(row[0]) > prevLatest))
    : computed

  // Anchor row: guarantee one row per snapshot even in an hour where nothing at
  // all changed, so the total is hourly rather than "hourly if someone moved".
  // capes.json is a full snapshot, so summing it is exact rather than carried
  // forward. Without this a quiet hour would leave a hole in the chart.
  const newest = merged.length ? Number(merged[merged.length - 1][0]) : null
  if (capes.length && (newest === null || now - newest >= TOTALS_MIN_INTERVAL_S)) {
    merged.push([
      now,
      capes.reduce((sum, c) => sum + c.current, 0),
      capes.reduce((sum, c) => sum + c.total, 0),
      capes.length,
    ])
  }

  // Compare content, not the clock: a self-heal that lands on the same rows must
  // not report a change, or every run would rewrite an identical file.
  const totalsChanged = JSON.stringify(merged) !== JSON.stringify(prevTotals)
  history.totals = merged
  const lastTotal = merged.length ? merged[merged.length - 1] : null

  // Liveness heartbeat: if nothing changed at all, still bump `updated` daily
  // so we produce a commit (proves the watcher is alive) without duplicating points.
  const changedAny = appended > 0 || totalsChanged || history.updated === 0
  const stale = now - history.updated > DAY_MS
  const heartbeat = !changedAny && stale

  if (changedAny || heartbeat) {
    history.updated = now
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n')
  }

  console.log(
    `capes: ${capes.length} | appended points: ${appended} | ` +
      `totals rows: ${merged.length} | covered capes: ${lastTotal ? lastTotal[3] : 0} | ` +
      `total wearers: ${lastTotal ? lastTotal[2] : 0} | ` +
      `updated: ${new Date(history.updated * 1000).toISOString()} | ` +
      `changed: ${changedAny || heartbeat} | heartbeat: ${heartbeat}`
  )

  // Exit code 0 regardless; the workflow decides commit based on `git diff`.
}

try {
  main()
} catch (err) {
  console.error('update.js failed:', err.message)
  process.exit(1)
}
