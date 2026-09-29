'use strict'

/**
 * Shared history helpers.
 *
 * Data model
 * ----------
 * history.series : { [capeId]: [[ts, current, total], ...] }
 *   Per-cape points are change-only: a point is written when that cape's value
 *   actually moved. Timestamps are unix seconds and sorted ascending.
 *
 * history.totals : [[ts, currentSum, totalSum, capesCovered], ...]
 *   One row per snapshot, i.e. an exact count of every tracked cape summed
 *   together. Written by update.js on every run.
 *
 * Why the sparse series is still summable
 * ---------------------------------------
 * A cape is absent from a given timestamp precisely because nothing changed, so
 * its last known value is still its value at that timestamp. Carrying the last
 * value forward is therefore an exact reconstruction, not an interpolation, and
 * it is what lets us report a real total instead of a sum over whichever capes
 * happened to move that hour.
 *
 * Edge case: a cape has no value before its first observation, so it cannot be
 * counted before then. `capesCovered` records how many capes each row actually
 * summed, which makes that undercount visible instead of silent.
 */

/** Normalise one cape's point list to sorted, numeric triples. */
function normalisePoints(pts) {
  if (!Array.isArray(pts)) return []
  return pts
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])))
    .map((p) => [Number(p[0]), Number(p[1]) || 0, Number(p[2]) || 0])
    .sort((a, b) => a[0] - b[0])
}

/**
 * Sum every tracked cape at every timestamp, carrying the last known value of
 * unchanged capes forward.
 *
 * @param {Record<string, number[][]>} series
 * @returns {number[][]} [ts, currentSum, totalSum, capesCovered] per timestamp
 */
function computeTotals(series) {
  const capes = []
  for (const [id, raw] of Object.entries(series || {})) {
    const pts = normalisePoints(raw)
    if (pts.length) capes.push({ id, pts })
  }
  if (!capes.length) return []

  const grid = new Set()
  for (const cape of capes) for (const p of cape.pts) grid.add(p[0])
  const timestamps = [...grid].sort((a, b) => a - b)

  // Walk each cape forward once across the shared grid.
  const cursors = capes.map((cape) => ({
    pts: cape.pts,
    i: 0,
    cur: 0,
    tot: 0,
    start: cape.pts[0][0],
  }))

  const out = []
  for (const ts of timestamps) {
    let sumCurrent = 0
    let sumTotal = 0
    let covered = 0
    for (const c of cursors) {
      if (c.start > ts) continue // cape not observed yet at this time
      while (c.i < c.pts.length && c.pts[c.i][0] <= ts) {
        c.cur = c.pts[c.i][1]
        c.tot = c.pts[c.i][2]
        c.i++
      }
      sumCurrent += c.cur
      sumTotal += c.tot
      covered++
    }
    out.push([ts, sumCurrent, sumTotal, covered])
  }
  return out
}

/** The most recent point across every cape, or null when history is empty. */
function latestTimestamp(series) {
  let latest = null
  for (const raw of Object.values(series || {})) {
    for (const p of normalisePoints(raw)) {
      if (latest === null || p[0] > latest) latest = p[0]
    }
  }
  return latest
}

module.exports = { computeTotals, latestTimestamp, normalisePoints }
