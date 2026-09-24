const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CAPES_PATH = path.join(ROOT, 'capes.json')
const HISTORY_PATH = path.join(ROOT, 'history.json')

const DAY_MS = 24 * 60 * 60 * 1000

function loadCapes() {
  if (!fs.existsSync(CAPES_PATH)) throw new Error('capes.json missing')
  const capes = JSON.parse(fs.readFileSync(CAPES_PATH, 'utf8'))
  if (!Array.isArray(capes)) throw new Error('capes.json is not an array')
  return capes.map((c) => ({
    id: Number(c.id),
    name: c.name || `#${c.id}`,
    current: Number(c.current_wearers),
    total: Number(c.total_wearers),
  }))
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { updated: 0, names: {}, series: {} }
  }
  const raw = fs.readFileSync(HISTORY_PATH, 'utf8').trim()
  if (!raw) return { updated: 0, names: {}, series: {} }
  const parsed = JSON.parse(raw)
  return {
    updated: parsed.updated || 0,
    names: parsed.names || {},
    series: parsed.series || {},
  }
}

function lastPoint(series) {
  return series && series.length ? series[series.length - 1] : null
}

function main() {
  const capes = loadCapes()
  const history = loadHistory()
  const now = Math.floor(Date.now() / 1000)

  let appended = 0
  for (const cape of capes) {
    const id = String(cape.id)
    history.names[id] = cape.name
    const series = history.series[id] || (history.series[id] = [])
    const last = lastPoint(series)
    if (!last || last[1] !== cape.current || last[2] !== cape.total) {
      series.push([now, cape.current, cape.total])
      appended++
    }
  }

  // Liveness heartbeat: if nothing changed at all, still bump `updated` daily
  // so we produce a commit (proves the watcher is alive) without duplicating points.
  const changedAny = appended > 0 || history.updated === 0
  const stale = now - history.updated > DAY_MS
  const heartbeat = !changedAny && stale

  if (changedAny || heartbeat) {
    history.updated = now
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n')
  }

  console.log(
    `capes: ${capes.length} | appended points: ${appended} | ` +
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
