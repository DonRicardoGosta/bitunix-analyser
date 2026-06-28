import type { Candle } from '@shared/market/candle'
import { toNum } from '@shared/num'
import type { KlineRaw } from './types'

export function parseKline(k: KlineRaw): Candle {
  const tRaw = toNum(k.time)
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
  const parsed = rows.map(parseKline).filter((c) => Number.isFinite(c.time) && c.time > 0)
  const map = new Map<number, Candle>()
  for (const c of parsed) map.set(c.time, c)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

/** Append/replace a live candle into an ascending history (capped length). */
export function mergeCandle(arr: Candle[], c: Candle, cap = 600): void {
  const last = arr[arr.length - 1]
  if (!last || c.time > last.time) {
    arr.push(c)
    if (arr.length > cap) arr.splice(0, arr.length - cap)
  } else if (c.time === last.time) {
    arr[arr.length - 1] = c
  }
}
