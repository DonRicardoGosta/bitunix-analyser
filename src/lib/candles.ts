import type { KlineRaw } from './bitunix/types'
import { toNum } from './format'

/** Normalized candle. `time` is a UNIX timestamp in seconds (lightweight-charts). */
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Convert a Bitunix REST kline row into a normalized candle. */
export function parseKline(k: KlineRaw): Candle {
  const tRaw = toNum(k.time)
  // Bitunix returns ms; normalize to seconds for the chart libs.
  const timeSec = tRaw > 1e12 ? Math.floor(tRaw / 1000) : tRaw
  return {
    time: timeSec,
    open: toNum(k.open),
    high: toNum(k.high),
    low: toNum(k.low),
    close: toNum(k.close),
    volume: toNum(k.baseVol),
  }
}

export function parseKlines(rows: KlineRaw[]): Candle[] {
  const out = rows.map(parseKline).filter((c) => Number.isFinite(c.time) && c.time > 0)
  out.sort((a, b) => a.time - b.time)
  // De-duplicate by time (keep last).
  const map = new Map<number, Candle>()
  for (const c of out) map.set(c.time, c)
  return [...map.values()].sort((a, b) => a.time - b.time)
}
