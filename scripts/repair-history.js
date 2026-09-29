#!/usr/bin/env node
'use strict'

/**
 * One-time repair for history rows poisoned by the Cloudflare stale-edge bug.
 *
 * Two separate things went wrong
 * ------------------------------
 * 1. STALE READS. Crafter's `/top/capes` route used to answer with
 *    `Cache-Control: public, max-age=3540, stale-while-revalidate=31536000`,
 *    which let the edge hold a copy for about an hour and then serve it stale
 *    for up to a year. The watcher fetched hourly, so consecutive snapshots
 *    were not ordered in time: an hour could receive a copy captured *before*
 *    the previous hour. Those stale reads were recorded as real points and drew
 *    ~875 phantom drops across 30 of the 44 capes.
 *
 * 2. OVERSTATED COUNTERS. The incremental `total_wearers` bookkeeping drifted
 *    upward (a cape could be counted twice). The authoritative recount in
 *    `refresh-cape-wearer-counts` corrected the database downward, but the
 *    watcher had already recorded the inflated figures, so a handful of capes
 *    ended up with a final point *higher* than the true current total.
 *
 * Why the fix is what it is
 * -------------------------
 * For each cape independently:
 *   - interior points are raised to the running maximum, erasing the stale-read
 *     dips while preserving every real high-water mark;
 *   - the final point is then pinned to the authoritative value in
 *     capes.json, so a series cannot end on a figure the database has since
 *     disproved.
 *
 * Pinning the last point matters for correctness, not cosmetics. The watcher's
 * monotonic guard in update.js refuses any snapshot whose total is below the
 * previous point. If a series ends on a phantom high-water mark, that cape is
 * frozen at an inflated number forever and the guard fires a stale-edge warning
 * every single run. Pinning to truth lets the series grow normally again.
 *
 * `current_wearers` is deliberately NOT clamped or pinned. Players genuinely
 * unwear capes, so those decreases are real and must be kept.
 *
 * `totals` is recomputed from the repaired series with the same `computeTotals`
 * the normal update path uses, so the aggregate stays consistent with the
 * per-cape data. Anchor rows that no cape series can explain are clamped to a
 * running max for the same reason the series are.
 *
 * The script is idempotent: re-running it on already-repaired history is a
 * no-op.
 */

const fs = require('fs')
const path = require('path')

const { computeTotals } = require('./lib')

const ROOT = path.resolve(__dirname, '..')
const HISTORY_PATH = path.join(ROOT, 'history.json')
const CAPES_PATH = path.join(ROOT, 'capes.json')

function loadAuthoritative() {
  if (!fs.existsSync(CAPES_PATH)) return new Map()
  const capes = JSON.parse(fs.readFileSync(CAPES_PATH, 'utf8'))
  const map = new Map()
  for (const c of Array.isArray(capes) ? capes : []) {
    if (c && c.id !== undefined) map.set(String(c.id), Number(c.total_wearers))
  }
  return map
}

function main() {
  if (!fs.existsSync(HISTORY_PATH)) throw new Error('history.json missing')
  const raw = fs.readFileSync(HISTORY_PATH, 'utf8').trim()
  if (!raw) throw new Error('history.json is empty')
  const history = JSON.parse(raw)

  const authoritative = loadAuthoritative()
  if (!authoritative.size) {
    console.error('WARNING: capes.json missing or empty; cannot pin final points to truth.')
  }

  const before = JSON.stringify(history)
  const raised = []
  const pinned = []
  let pointsRepaired = 0

  for (const [id, pts] of Object.entries(history.series || {})) {
    if (!Array.isArray(pts) || !pts.length) continue
    let runMax = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (!Array.isArray(p)) continue
      const total = Number(p[2]) || 0
      if (total > runMax) {
        runMax = total // genuine new high, or the first point
        continue
      }
      if (total < runMax) {
        raised.push(
          `  cape ${id} @ ${new Date(p[0] * 1000).toISOString()}: total ${total} -> ${runMax} (stale edge read)`
        )
        p[2] = runMax
        pointsRepaired++
      }
    }

    // Pin the final point to the authoritative total so the series does not end
    // on a figure the database's recount has disproved. This is a real step down
    // and is reported, not hidden.
    const truth = authoritative.get(id)
    const last = pts[pts.length - 1]
    if (truth !== undefined && Number.isFinite(truth) && Number(last[2]) !== truth) {
      pinned.push(
        `  cape ${id} ${history.names && history.names[id] ? '(' + history.names[id] + ')' : ''}: ` +
          `final point ${last[2]} -> ${truth} (pinned to authoritative recount)`
      )
      last[2] = truth
      pointsRepaired++
    }
  }

  // Recompute the aggregate from the repaired series using the normal code
  // path, so totals[] can never disagree with series{}.
  //
  // The merge keeps rows in `totals` that no cape series can explain: those are
  // the "anchor" rows update.js writes by summing capes.json directly when no
  // individual cape moved. They were summed from a possibly-stale snapshot, so
  // they are clamped to a running max for the same reason the series are.
  // totals[1] (the current-wearer sum) is left alone: unwearing is real.
  const prevTotals = history.totals || []
  const computed = computeTotals(history.series)
  const prevLatest = prevTotals.length ? Number(prevTotals[prevTotals.length - 1][0]) : null
  const merged =
    prevLatest !== null && computed.length && computed[computed.length - 1][0] === prevLatest
      ? prevTotals.concat(computed.filter((row) => Number(row[0]) > prevLatest))
      : computed

  let runMax = 0
  for (const row of merged) {
    const total = Number(row[2]) || 0
    if (total > runMax) {
      runMax = total
      continue
    }
    if (total < runMax) {
      raised.push(
        `  aggregate @ ${new Date(Number(row[0]) * 1000).toISOString()}: total ${total} -> ${runMax} (stale anchor row)`
      )
      row[2] = runMax
      pointsRepaired++
    }
  }
  history.totals = merged

  if (JSON.stringify(history) === before) {
    console.log('history already monotonic; nothing to repair')
    return
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n')
  console.log(`repaired ${pointsRepaired} point(s)`)
  if (raised.length) console.log(raised.join('\n'))
  if (pinned.length) {
    console.log(`pinned ${pinned.length} final point(s) to the authoritative recount:`)
    console.log(pinned.join('\n'))
  }
  console.log(`totals rows: ${history.totals.length}`)
}

try {
  main()
} catch (err) {
  console.error('repair-history.js failed:', err.message)
  process.exit(1)
}
