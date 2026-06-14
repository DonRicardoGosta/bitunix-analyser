import type { Candle } from '../../../lib/candles'
import { atr as atrIndic, ema } from '../../../lib/indicators'
import type { KeyLevel } from './engine'
import type { Regime } from './signal'
import { PATTERNS } from './config'

// ---------------------------------------------------------------------------
// Entry-pattern detection.
//
// Pure, look-ahead-free recognition of market-movement patterns that act as
// position-opening signals: classic candlestick reversals plus a few simple
// price-action / structure patterns. Sizes are judged relative to ATR so the
// same thresholds work across coins and timeframes.
//
// Only patterns that *complete* within the last `recencyBars` candles are
// reported, so a detection is always actionable "right now".
// ---------------------------------------------------------------------------

export type PatternDirection = 'bullish' | 'bearish' | 'neutral'

export type PatternId =
  | 'bullish-engulfing'
  | 'bearish-engulfing'
  | 'hammer'
  | 'shooting-star'
  | 'morning-star'
  | 'evening-star'
  | 'bullish-harami'
  | 'bearish-harami'
  | 'doji'
  | 'range-breakout-up'
  | 'range-breakout-down'
  | 'double-bottom'
  | 'double-top'
  | 'support-bounce'
  | 'resistance-rejection'
  | 'bull-pullback'
  | 'bear-pullback'

export interface DetectedPattern {
  id: PatternId
  name: string // human label, e.g. "Bullish engulfing"
  short: string // compact label for chart markers, e.g. "Engulf"
  kind: 'candlestick' | 'price-action'
  direction: PatternDirection
  confidence: number // 0..1
  barIndex: number // index of the completing candle
  time: number // candle.time of the completing bar (for chart-marker alignment)
  anchor: number // price level to anchor a marker (bar low/high/close)
  description: string // one-line explanation
}

export interface DetectPatternsOptions {
  atr?: number
  levels?: KeyLevel[]
  regime?: Regime
}

// ---- Small helpers ---------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && Number.isFinite(arr[i] as number)) return arr[i] as number
  }
  return null
}

const body = (c: Candle) => Math.abs(c.close - c.open)
const range = (c: Candle) => c.high - c.low
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close)
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low
const isBull = (c: Candle) => c.close > c.open
const isBear = (c: Candle) => c.close < c.open

interface Pivot {
  index: number
  price: number
}

/** Confirmed swing pivots (half-width `k`) within the lookback window. */
function swingPivots(candles: Candle[], k: number, lookback: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = []
  const lows: Pivot[] = []
  const n = candles.length
  const start = Math.max(k, n - lookback)
  for (let i = start; i < n - k; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isHigh = false
      if (candles[j].low <= candles[i].low) isLow = false
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high })
    if (isLow) lows.push({ index: i, price: candles[i].low })
  }
  return { highs, lows }
}

function make(
  candles: Candle[],
  i: number,
  p: {
    id: PatternId
    name: string
    short: string
    kind: 'candlestick' | 'price-action'
    direction: PatternDirection
    confidence: number
    description: string
  },
): DetectedPattern {
  const c = candles[i]
  const anchor = p.direction === 'bullish' ? c.low : p.direction === 'bearish' ? c.high : c.close
  return {
    ...p,
    barIndex: i,
    time: c.time,
    anchor,
    confidence: clamp(p.confidence, 0, 0.98),
  }
}

// ---- Per-bar detection -----------------------------------------------------

function detectAt(
  out: DetectedPattern[],
  candles: Candle[],
  i: number,
  atr: number,
  e9: (number | null)[],
  e50: (number | null)[],
  pivots: { highs: Pivot[]; lows: Pivot[] },
  levels: KeyLevel[] | undefined,
  regime: Regime | undefined,
): void {
  const c = candles[i]
  const prev = candles[i - 1]
  const rng = range(c)
  if (rng <= 0) return
  const prox = PATTERNS.levelProximityAtr * atr
  const trending = regime?.type === 'TREND'
  const ranging = regime?.type === 'RANGE'

  // --- Candlestick: engulfing -------------------------------------------------
  const curBody = body(c)
  const prevBody = body(prev)
  if (curBody >= PATTERNS.engulfMinBodyAtr * atr && prevBody > 0) {
    const ratio = curBody / prevBody
    if (isBull(c) && isBear(prev) && c.close >= prev.open && c.open <= prev.close) {
      const conf = 0.5 + 0.2 * clamp(ratio - 1, 0, 1) + 0.25 * clamp(curBody / (atr * 1.2), 0, 1) + (ranging ? 0.05 : 0)
      out.push(
        make(candles, i, {
          id: 'bullish-engulfing',
          name: 'Bullish engulfing',
          short: 'Engulf',
          kind: 'candlestick',
          direction: 'bullish',
          confidence: conf,
          description: "A green candle fully engulfs the prior red body — buyers took over.",
        }),
      )
    } else if (isBear(c) && isBull(prev) && c.close <= prev.open && c.open >= prev.close) {
      const conf = 0.5 + 0.2 * clamp(ratio - 1, 0, 1) + 0.25 * clamp(curBody / (atr * 1.2), 0, 1) + (ranging ? 0.05 : 0)
      out.push(
        make(candles, i, {
          id: 'bearish-engulfing',
          name: 'Bearish engulfing',
          short: 'Engulf',
          kind: 'candlestick',
          direction: 'bearish',
          confidence: conf,
          description: 'A red candle fully engulfs the prior green body — sellers took over.',
        }),
      )
    }
  }

  // --- Candlestick: hammer / shooting star -----------------------------------
  if (curBody > 0 && curBody <= PATTERNS.hammerBodyMaxFrac * rng) {
    const lw = lowerWick(c)
    const uw = upperWick(c)
    const priorDown = i >= 3 && c.close < candles[i - 3].close
    const priorUp = i >= 3 && c.close > candles[i - 3].close
    if (lw >= PATTERNS.hammerWickMult * curBody && uw <= curBody) {
      const conf = 0.45 + 0.25 * clamp(lw / (curBody * PATTERNS.hammerWickMult) - 1, 0, 1) + (priorDown ? 0.2 : 0)
      out.push(
        make(candles, i, {
          id: 'hammer',
          name: 'Hammer',
          short: 'Hammer',
          kind: 'candlestick',
          direction: 'bullish',
          confidence: conf,
          description: 'Long lower wick rejecting lower prices — buyers defended the low.',
        }),
      )
    } else if (uw >= PATTERNS.hammerWickMult * curBody && lw <= curBody) {
      const conf = 0.45 + 0.25 * clamp(uw / (curBody * PATTERNS.hammerWickMult) - 1, 0, 1) + (priorUp ? 0.2 : 0)
      out.push(
        make(candles, i, {
          id: 'shooting-star',
          name: 'Shooting star',
          short: 'Star',
          kind: 'candlestick',
          direction: 'bearish',
          confidence: conf,
          description: 'Long upper wick rejecting higher prices — sellers defended the high.',
        }),
      )
    }
  }

  // --- Candlestick: morning / evening star (3 bars) --------------------------
  if (i >= 2) {
    const c0 = candles[i - 2]
    const c1 = candles[i - 1]
    const c2 = c
    const b0 = body(c0)
    const b1 = body(c1)
    const mid0 = (c0.open + c0.close) / 2
    const starSmall = b1 <= 0.5 * b0 && b0 >= PATTERNS.engulfMinBodyAtr * atr
    if (starSmall && isBear(c0) && isBull(c2) && c2.close > mid0) {
      out.push(
        make(candles, i, {
          id: 'morning-star',
          name: 'Morning star',
          short: 'M.Star',
          kind: 'candlestick',
          direction: 'bullish',
          confidence: 0.6 + 0.2 * clamp(b0 / (atr * 1.5), 0, 1),
          description: 'Down candle, small-bodied pause, then a strong up candle — bullish reversal.',
        }),
      )
    } else if (starSmall && isBull(c0) && isBear(c2) && c2.close < mid0) {
      out.push(
        make(candles, i, {
          id: 'evening-star',
          name: 'Evening star',
          short: 'E.Star',
          kind: 'candlestick',
          direction: 'bearish',
          confidence: 0.6 + 0.2 * clamp(b0 / (atr * 1.5), 0, 1),
          description: 'Up candle, small-bodied pause, then a strong down candle — bearish reversal.',
        }),
      )
    }
  }

  // --- Candlestick: harami ----------------------------------------------------
  if (prevBody >= PATTERNS.engulfMinBodyAtr * atr && curBody > 0 && curBody <= 0.6 * prevBody) {
    const containedTop = Math.max(c.open, c.close) <= Math.max(prev.open, prev.close)
    const containedBot = Math.min(c.open, c.close) >= Math.min(prev.open, prev.close)
    if (containedTop && containedBot) {
      if (isBear(prev) && isBull(c)) {
        out.push(
          make(candles, i, {
            id: 'bullish-harami',
            name: 'Bullish harami',
            short: 'Harami',
            kind: 'candlestick',
            direction: 'bullish',
            confidence: 0.5 + (ranging ? 0.05 : 0),
            description: 'Small green body inside the prior large red body — selling momentum stalling.',
          }),
        )
      } else if (isBull(prev) && isBear(c)) {
        out.push(
          make(candles, i, {
            id: 'bearish-harami',
            name: 'Bearish harami',
            short: 'Harami',
            kind: 'candlestick',
            direction: 'bearish',
            confidence: 0.5 + (ranging ? 0.05 : 0),
            description: 'Small red body inside the prior large green body — buying momentum stalling.',
          }),
        )
      }
    }
  }

  // --- Candlestick: doji (indecision, neutral) -------------------------------
  if (curBody <= PATTERNS.dojiBodyMaxFrac * rng && rng >= 0.5 * atr) {
    out.push(
      make(candles, i, {
        id: 'doji',
        name: 'Doji',
        short: 'Doji',
        kind: 'candlestick',
        direction: 'neutral',
        confidence: 0.45,
        description: 'Open and close nearly equal — indecision, watch for a follow-through break.',
      }),
    )
  }

  // --- Price action: range breakout ------------------------------------------
  {
    const lb = PATTERNS.breakoutLookback
    const winStart = i - lb
    if (winStart >= 0) {
      let hi = -Infinity
      let lo = Infinity
      for (let j = winStart; j < i; j++) {
        if (candles[j].high > hi) hi = candles[j].high
        if (candles[j].low < lo) lo = candles[j].low
      }
      const buffer = PATTERNS.breakoutBufferAtr * atr
      if (hi > lo) {
        const avgVol = avgVolume(candles, winStart, i)
        const volBoost = avgVol > 0 ? clamp(c.volume / avgVol - 1, 0, 1) : 0
        if (c.close > hi + buffer) {
          out.push(
            make(candles, i, {
              id: 'range-breakout-up',
              name: 'Range breakout (up)',
              short: 'Breakout',
              kind: 'price-action',
              direction: 'bullish',
              confidence: 0.5 + 0.2 * clamp((c.close - hi) / atr, 0, 1) + 0.15 * volBoost + (trending ? 0.05 : 0),
              description: `Closed above the ${lb}-bar range high — breakout to the upside.`,
            }),
          )
        } else if (c.close < lo - buffer) {
          out.push(
            make(candles, i, {
              id: 'range-breakout-down',
              name: 'Range breakout (down)',
              short: 'Breakdown',
              kind: 'price-action',
              direction: 'bearish',
              confidence: 0.5 + 0.2 * clamp((lo - c.close) / atr, 0, 1) + 0.15 * volBoost + (trending ? 0.05 : 0),
              description: `Closed below the ${lb}-bar range low — breakdown to the downside.`,
            }),
          )
        }
      }
    }
  }

  // --- Price action: double bottom / top (neckline break) --------------------
  {
    const tol = PATTERNS.doubleTolAtr * atr
    const lows = pivots.lows.filter((p) => p.index <= i - PATTERNS.swingK)
    if (lows.length >= 2) {
      const l2 = lows[lows.length - 1]
      const l1 = lows[lows.length - 2]
      if (i - l2.index <= 40 && Math.abs(l1.price - l2.price) <= tol) {
        let neckline = -Infinity
        for (let j = l1.index; j < i; j++) if (candles[j].high > neckline) neckline = candles[j].high
        if (Number.isFinite(neckline) && c.close > neckline) {
          out.push(
            make(candles, i, {
              id: 'double-bottom',
              name: 'Double bottom',
              short: '2Bottom',
              kind: 'price-action',
              direction: 'bullish',
              confidence: 0.55 + 0.2 * clamp(1 - Math.abs(l1.price - l2.price) / tol, 0, 1),
              description: 'Two equal lows held and price broke the neckline — bullish reversal.',
            }),
          )
        }
      }
    }
    const highs = pivots.highs.filter((p) => p.index <= i - PATTERNS.swingK)
    if (highs.length >= 2) {
      const h2 = highs[highs.length - 1]
      const h1 = highs[highs.length - 2]
      if (i - h2.index <= 40 && Math.abs(h1.price - h2.price) <= tol) {
        let neckline = Infinity
        for (let j = h1.index; j < i; j++) if (candles[j].low < neckline) neckline = candles[j].low
        if (Number.isFinite(neckline) && c.close < neckline) {
          out.push(
            make(candles, i, {
              id: 'double-top',
              name: 'Double top',
              short: '2Top',
              kind: 'price-action',
              direction: 'bearish',
              confidence: 0.55 + 0.2 * clamp(1 - Math.abs(h1.price - h2.price) / tol, 0, 1),
              description: 'Two equal highs rejected and price broke the neckline — bearish reversal.',
            }),
          )
        }
      }
    }
  }

  // --- Price action: support bounce / resistance rejection (needs levels) ----
  if (levels && levels.length) {
    let bestSup: KeyLevel | null = null
    let bestRes: KeyLevel | null = null
    for (const l of levels) {
      if (l.side === 'support' && Math.abs(c.low - l.price) <= prox && c.close > l.price) {
        if (!bestSup || l.strength > bestSup.strength) bestSup = l
      }
      if (l.side === 'resistance' && Math.abs(c.high - l.price) <= prox && c.close < l.price) {
        if (!bestRes || l.strength > bestRes.strength) bestRes = l
      }
    }
    if (bestSup && lowerWick(c) >= 0.8 * curBody) {
      out.push(
        make(candles, i, {
          id: 'support-bounce',
          name: 'Support bounce',
          short: 'Support',
          kind: 'price-action',
          direction: 'bullish',
          confidence: 0.5 + 0.4 * clamp(bestSup.strength, 0, 1),
          description: `Tested support at ${bestSup.price.toPrecision(6)} and closed back above it.`,
        }),
      )
    }
    if (bestRes && upperWick(c) >= 0.8 * curBody) {
      out.push(
        make(candles, i, {
          id: 'resistance-rejection',
          name: 'Resistance rejection',
          short: 'Resist',
          kind: 'price-action',
          direction: 'bearish',
          confidence: 0.5 + 0.4 * clamp(bestRes.strength, 0, 1),
          description: `Tested resistance at ${bestRes.price.toPrecision(6)} and closed back below it.`,
        }),
      )
    }
  }

  // --- Price action: trend pullback continuation -----------------------------
  {
    const f = e9[i]
    const s = e50[i]
    if (f !== null && s !== null) {
      if (f > s && c.low <= f + prox && c.close > f && isBull(c)) {
        out.push(
          make(candles, i, {
            id: 'bull-pullback',
            name: 'Bullish pullback',
            short: 'Pullback',
            kind: 'price-action',
            direction: 'bullish',
            confidence: 0.5 + 0.2 * clamp((f - s) / s / 0.01, 0, 1) + (trending ? 0.1 : 0),
            description: 'Uptrend pulled back into the EMAs and bounced — trend-continuation entry.',
          }),
        )
      } else if (f < s && c.high >= f - prox && c.close < f && isBear(c)) {
        out.push(
          make(candles, i, {
            id: 'bear-pullback',
            name: 'Bearish pullback',
            short: 'Pullback',
            kind: 'price-action',
            direction: 'bearish',
            confidence: 0.5 + 0.2 * clamp((s - f) / s / 0.01, 0, 1) + (trending ? 0.1 : 0),
            description: 'Downtrend pulled back into the EMAs and rolled over — trend-continuation entry.',
          }),
        )
      }
    }
  }
}

function avgVolume(candles: Candle[], start: number, end: number): number {
  let sum = 0
  let n = 0
  for (let j = start; j < end; j++) {
    sum += candles[j].volume
    n++
  }
  return n > 0 ? sum / n : 0
}

// ---- Public entry point ----------------------------------------------------

export function detectPatterns(candles: Candle[], opts: DetectPatternsOptions = {}): DetectedPattern[] {
  const n = candles.length
  if (n < 5) return []
  const price = candles[n - 1].close
  const atr = opts.atr && opts.atr > 0 ? opts.atr : lastDefined(atrIndic(candles, 14)) ?? price * 0.01
  if (!(atr > 0)) return []

  const closes = candles.map((c) => c.close)
  const e9 = ema(closes, 9)
  const e50 = ema(closes, 50)
  const pivots = swingPivots(candles, PATTERNS.swingK, PATTERNS.swingLookback)

  const found: DetectedPattern[] = []
  const startBar = Math.max(4, n - PATTERNS.recencyBars)
  for (let i = startBar; i < n; i++) {
    detectAt(found, candles, i, atr, e9, e50, pivots, opts.levels, opts.regime)
  }

  // De-duplicate by pattern id: keep the most recent, then the most confident.
  const byId = new Map<PatternId, DetectedPattern>()
  for (const p of found) {
    const prev = byId.get(p.id)
    if (!prev || p.barIndex > prev.barIndex || (p.barIndex === prev.barIndex && p.confidence > prev.confidence)) {
      byId.set(p.id, p)
    }
  }

  return [...byId.values()]
    .filter((p) => p.confidence >= PATTERNS.minConfidence)
    .sort((a, b) => b.barIndex - a.barIndex || b.confidence - a.confidence)
    .slice(0, PATTERNS.maxSurface)
}
