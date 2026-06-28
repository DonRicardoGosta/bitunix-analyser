import type { Candle } from '../market/candle'

// Technical indicators shared by the SPA and the Challenge backend.
// All array-returning functions are aligned with the input (null during warmup).

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Kaufman efficiency ratio over the last `lookback` closes (0..1). Pass `end`
 * to evaluate the window ending at a specific index (used by the backtester).
 */
export function efficiencyRatio(values: number[], lookback = 30, end = values.length - 1): number {
  if (end < 1) return 0
  const start = Math.max(0, end - lookback)
  const net = Math.abs(values[end] - values[start])
  let path = 0
  for (let i = start + 1; i <= end; i++) path += Math.abs(values[i] - values[i - 1])
  return path > 0 ? net / path : 0
}

/** Choppiness index over `period` (~0 trending, ~100 ranging). */
export function choppinessIndex(candles: Candle[], period = 14, end = candles.length - 1): number {
  if (end < period) return 50
  let trSum = 0
  let hh = -Infinity
  let ll = Infinity
  for (let i = end - period + 1; i <= end; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    if (h > hh) hh = h
    if (l < ll) ll = l
  }
  const range = hh - ll
  if (range <= 0 || trSum <= 0) return 100
  return clampNum((100 * Math.log10(trSum / range)) / Math.log10(period), 0, 100)
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1]
    if (ch >= 0) gain += ch
    else loss -= ch
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1]
    const g = ch >= 0 ? ch : 0
    const l = ch < 0 ? -ch : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export interface MacdResult {
  macd: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
}

export function macd(values: number[], fast = 12, slow = 26, signalP = 9): MacdResult {
  const emaFast = ema(values, fast)
  const emaSlow = ema(values, slow)
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  )
  const defined = macdLine.filter((v): v is number => v !== null)
  const signalDefined = ema(defined, signalP)
  const signal: (number | null)[] = new Array(values.length).fill(null)
  let j = 0
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== null) {
      signal[i] = signalDefined[j] ?? null
      j++
    }
  }
  const hist: (number | null)[] = values.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? (macdLine[i] as number) - (signal[i] as number) : null,
  )
  return { macd: macdLine, signal, hist }
}

export interface BollingerResult {
  mid: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const mid = sma(values, period)
  const upper: (number | null)[] = new Array(values.length).fill(null)
  const lower: (number | null)[] = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]
    if (m === null) continue
    let variance = 0
    for (let k = i - period + 1; k <= i; k++) variance += (values[k] - m) ** 2
    const sd = Math.sqrt(variance / period)
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { mid, upper, lower }
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const n = candles.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n === 0) return out
  const tr: number[] = new Array(n).fill(0)
  tr[0] = candles[0].high - candles[0].low
  for (let i = 1; i < n; i++) {
    const h = candles[i].high
    const l = candles[i].low
    const pc = candles[i - 1].close
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  if (n <= period) return out
  let prev = 0
  for (let i = 1; i <= period; i++) prev += tr[i]
  prev /= period
  out[period] = prev
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

/** Anchored VWAP from the start of the provided window. */
export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null)
  let pv = 0
  let vol = 0
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const typical = (c.high + c.low + c.close) / 3
    pv += typical * c.volume
    vol += c.volume
    out[i] = vol > 0 ? pv / vol : null
  }
  return out
}

export interface StochRsiResult {
  k: (number | null)[]
  d: (number | null)[]
}

export function stochRsi(
  values: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): StochRsiResult {
  const r = rsi(values, rsiPeriod)
  const raw: (number | null)[] = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (i < rsiPeriod + stochPeriod) continue
    let min = Infinity
    let max = -Infinity
    let ok = true
    for (let k = i - stochPeriod + 1; k <= i; k++) {
      const v = r[k]
      if (v === null) {
        ok = false
        break
      }
      if (v < min) min = v
      if (v > max) max = v
    }
    if (!ok) continue
    raw[i] = max === min ? 0 : (((r[i] as number) - min) / (max - min)) * 100
  }
  const k = smoothNullable(raw, kSmooth)
  const d = smoothNullable(k, dSmooth)
  return { k, d }
}

function smoothNullable(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  const buf: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) {
      buf.length = 0
      continue
    }
    buf.push(v)
    if (buf.length > period) buf.shift()
    if (buf.length === period) out[i] = buf.reduce((a, b) => a + b, 0) / period
  }
  return out
}
