import type { Candle } from '../../../lib/candles'
import { atr as atrIndic, bollinger, ema, macd, rsi, vwap } from '../../../lib/indicators'
import { binLiquidity, imbalance, type ParsedBook } from '../orderbook'
import { volumeProfile } from '../volumeProfile'
import type {
  LongShortPoint,
  OpenInterestPoint,
  TakerVolumePoint,
} from '../../../lib/binance/types'

// ---- Public types ----

export type LevelSource =
  | 'Bid liquidity wall'
  | 'Ask liquidity wall'
  | 'Volume POC'
  | 'Value-area high'
  | 'Value-area low'
  | 'Swing high'
  | 'Swing low'
  | 'EMA50'
  | 'VWAP'
  | 'Bollinger upper'
  | 'Bollinger lower'

export interface KeyLevel {
  price: number
  side: 'support' | 'resistance'
  strength: number // 0..1
  sources: LevelSource[]
}

export interface FactorScore {
  label: string
  value: number // -1 (bearish) .. +1 (bullish)
  weight: number
  available: boolean
  detail: string
}

export interface TradePlan {
  side: 'LONG' | 'SHORT'
  valid: boolean
  entry: number
  entryLow: number
  entryHigh: number
  stop: number
  tp1: number
  tp2: number
  rr: number
  confidence: number // 0..100
  reasons: string[]
  note?: string
}

export interface SetupResult {
  price: number
  atr: number
  bias: number // -1..+1
  biasLabel: 'LONG' | 'SHORT' | 'NEUTRAL'
  biasConfidence: number // 0..100
  factors: FactorScore[]
  levels: KeyLevel[]
  long: TradePlan
  short: TradePlan
  hasLiquidity: boolean
  hasDerivatives: boolean
}

export interface DerivativesSnapshot {
  oi?: OpenInterestPoint[]
  longShort?: LongShortPoint[]
  taker?: TakerVolumePoint[]
  fundingRate?: number | null
}

export interface SetupInput {
  candles: Candle[]
  book: ParsedBook | null
  derivatives?: DerivativesSnapshot
}

// ---- Helpers ----

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && Number.isFinite(arr[i] as number)) return arr[i] as number
  }
  return null
}

// ---- Swing pivots ----

interface RawLevel {
  price: number
  strength: number
  source: LevelSource
}

function swingLevels(candles: Candle[], k = 3, lookback = 120): RawLevel[] {
  const out: RawLevel[] = []
  const start = Math.max(k, candles.length - lookback)
  for (let i = start; i < candles.length - k; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isHigh = false
      if (candles[j].low <= candles[i].low) isLow = false
    }
    // More recent pivots are slightly stronger.
    const recency = 0.35 + 0.25 * ((i - start) / Math.max(1, candles.length - k - start))
    if (isHigh) out.push({ price: candles[i].high, strength: recency, source: 'Swing high' })
    if (isLow) out.push({ price: candles[i].low, strength: recency, source: 'Swing low' })
  }
  return out
}

// ---- Liquidity walls from the order book ----

function liquidityWalls(book: ParsedBook): RawLevel[] {
  const out: RawLevel[] = []
  const windowPct = 3
  const { rows, maxNotional } = binLiquidity(book, windowPct, 120)
  if (maxNotional <= 0) return out
  // Pick local maxima that are meaningfully large.
  for (let i = 1; i < rows.length - 1; i++) {
    const r = rows[i]
    const bid = r.bidNotional
    const ask = r.askNotional
    if (bid > 0 && bid >= rows[i - 1].bidNotional && bid >= rows[i + 1].bidNotional && bid > maxNotional * 0.25) {
      out.push({ price: r.price, strength: clamp(bid / maxNotional, 0, 1), source: 'Bid liquidity wall' })
    }
    if (ask > 0 && ask >= rows[i - 1].askNotional && ask >= rows[i + 1].askNotional && ask > maxNotional * 0.25) {
      out.push({ price: r.price, strength: clamp(ask / maxNotional, 0, 1), source: 'Ask liquidity wall' })
    }
  }
  // Keep the strongest few per side to avoid clutter.
  const bids = out.filter((l) => l.source === 'Bid liquidity wall').sort((a, b) => b.strength - a.strength).slice(0, 6)
  const asks = out.filter((l) => l.source === 'Ask liquidity wall').sort((a, b) => b.strength - a.strength).slice(0, 6)
  return [...bids, ...asks]
}

// ---- Level aggregation ----

function buildLevels(candles: Candle[], book: ParsedBook | null, price: number): KeyLevel[] {
  const raw: RawLevel[] = []

  // Volume profile.
  const vp = volumeProfile(candles, 60)
  if (vp) {
    raw.push({ price: vp.poc, strength: 0.9, source: 'Volume POC' })
    raw.push({ price: vp.vaHigh, strength: 0.6, source: 'Value-area high' })
    raw.push({ price: vp.vaLow, strength: 0.6, source: 'Value-area low' })
  }

  // Swings.
  raw.push(...swingLevels(candles))

  // Indicators.
  const closes = candles.map((c) => c.close)
  const ema50 = lastDefined(ema(closes, 50))
  if (ema50) raw.push({ price: ema50, strength: 0.4, source: 'EMA50' })
  const vw = lastDefined(vwap(candles))
  if (vw) raw.push({ price: vw, strength: 0.45, source: 'VWAP' })
  const bb = bollinger(closes, 20, 2)
  const bbU = lastDefined(bb.upper)
  const bbL = lastDefined(bb.lower)
  if (bbU) raw.push({ price: bbU, strength: 0.35, source: 'Bollinger upper' })
  if (bbL) raw.push({ price: bbL, strength: 0.35, source: 'Bollinger lower' })

  // Liquidity walls.
  if (book) raw.push(...liquidityWalls(book))

  // Merge nearby levels (within mergePct of each other).
  const mergePct = 0.0018
  raw.sort((a, b) => a.price - b.price)
  const merged: { price: number; strength: number; sources: LevelSource[]; wsum: number }[] = []
  for (const r of raw) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue
    const last = merged[merged.length - 1]
    if (last && Math.abs(r.price - last.price / last.wsum) / (last.price / last.wsum) < mergePct) {
      last.price += r.price * r.strength
      last.wsum += r.strength
      last.strength = Math.min(1, last.strength + r.strength)
      if (!last.sources.includes(r.source)) last.sources.push(r.source)
    } else {
      merged.push({ price: r.price * r.strength, strength: r.strength, sources: [r.source], wsum: r.strength })
    }
  }

  return merged
    .map((m) => {
      const p = m.price / m.wsum
      return {
        price: p,
        side: (p < price ? 'support' : 'resistance') as 'support' | 'resistance',
        strength: clamp(m.strength, 0, 1),
        sources: m.sources,
      }
    })
    .filter((l) => Number.isFinite(l.price) && l.price > 0)
    .sort((a, b) => a.price - b.price)
}

// ---- Factor scoring ----

function scoreFactors(
  candles: Candle[],
  book: ParsedBook | null,
  derivatives: DerivativesSnapshot | undefined,
  price: number,
): FactorScore[] {
  const closes = candles.map((c) => c.close)
  const factors: FactorScore[] = []

  // Trend: EMA9 vs EMA50 + price vs EMA50.
  const ema9 = lastDefined(ema(closes, 9))
  const ema50 = lastDefined(ema(closes, 50))
  if (ema9 && ema50) {
    const cross = clamp((ema9 - ema50) / ema50 / 0.01, -1, 1)
    const pos = clamp((price - ema50) / ema50 / 0.02, -1, 1)
    const value = clamp((cross + pos) / 2, -1, 1)
    factors.push({
      label: 'Trend (EMA)',
      value,
      weight: 0.22,
      available: true,
      detail: `EMA9 ${ema9 > ema50 ? '>' : '<'} EMA50, price ${price > ema50 ? 'above' : 'below'} EMA50`,
    })
  }

  // VWAP.
  const vw = lastDefined(vwap(candles))
  if (vw) {
    const value = clamp((price - vw) / vw / 0.01, -1, 1)
    factors.push({
      label: 'VWAP',
      value,
      weight: 0.1,
      available: true,
      detail: `Price ${price > vw ? 'above' : 'below'} VWAP`,
    })
  }

  // RSI.
  const r = lastDefined(rsi(closes, 14))
  if (r !== null) {
    const value = clamp((r - 50) / 50, -1, 1)
    factors.push({
      label: 'RSI (14)',
      value,
      weight: 0.13,
      available: true,
      detail: `RSI ${r.toFixed(0)}`,
    })
  }

  // MACD histogram.
  const m = macd(closes)
  const hist = lastDefined(m.hist)
  if (hist !== null) {
    const value = clamp(hist / (price * 0.0015), -1, 1)
    factors.push({
      label: 'MACD',
      value,
      weight: 0.1,
      available: true,
      detail: `Histogram ${hist >= 0 ? 'positive' : 'negative'}`,
    })
  }

  // Order-book imbalance.
  if (book) {
    const imb = imbalance(book, 1)
    factors.push({
      label: 'Order-book imbalance',
      value: clamp(imb.skew, -1, 1),
      weight: 0.15,
      available: true,
      detail: `${imb.skew >= 0 ? 'Bid' : 'Ask'}-heavy (${(imb.skew * 100).toFixed(0)}%)`,
    })
  }

  // Taker buy/sell flow.
  const taker = derivatives?.taker
  if (taker && taker.length) {
    const ratio = Number(taker[taker.length - 1].buySellRatio)
    if (Number.isFinite(ratio)) {
      const value = clamp((ratio - 1) / 0.5, -1, 1)
      factors.push({
        label: 'Taker flow',
        value,
        weight: 0.12,
        available: true,
        detail: `Buy/sell ${ratio.toFixed(2)}`,
      })
    }
  }

  // Open interest trend vs price.
  const oi = derivatives?.oi
  if (oi && oi.length > 2) {
    const oiFirst = Number(oi[0].sumOpenInterest)
    const oiLast = Number(oi[oi.length - 1].sumOpenInterest)
    const oiChange = oiFirst > 0 ? (oiLast - oiFirst) / oiFirst : 0
    const priceFirst = candles.length > 20 ? candles[candles.length - 20].close : candles[0]?.close ?? price
    const priceChange = priceFirst > 0 ? (price - priceFirst) / priceFirst : 0
    const oiUp = oiChange > 0.002
    const oiDown = oiChange < -0.002
    let value = 0
    let detail = 'OI flat'
    if (oiUp && priceChange > 0) {
      value = 0.6
      detail = 'OI rising into rally (trend confirmation)'
    } else if (oiUp && priceChange < 0) {
      value = -0.6
      detail = 'OI rising into drop (building shorts)'
    } else if (oiDown && priceChange > 0) {
      value = 0.2
      detail = 'OI falling on rally (short covering)'
    } else if (oiDown && priceChange < 0) {
      value = -0.2
      detail = 'OI falling on drop (long unwinding)'
    }
    factors.push({ label: 'Open interest', value, weight: 0.1, available: true, detail })
  }

  // Positioning: funding + crowd long/short (contrarian).
  const funding = derivatives?.fundingRate
  const ls = derivatives?.longShort
  if ((funding !== undefined && funding !== null) || (ls && ls.length)) {
    let acc = 0
    let n = 0
    const detailParts: string[] = []
    if (funding !== undefined && funding !== null) {
      acc += clamp(-funding / 0.0003, -1, 1)
      n++
      detailParts.push(`funding ${(funding * 100).toFixed(4)}%`)
    }
    if (ls && ls.length) {
      const ratio = Number(ls[ls.length - 1].longShortRatio)
      if (Number.isFinite(ratio)) {
        acc += clamp(-(ratio - 1) / 1, -1, 1)
        n++
        detailParts.push(`L/S ${ratio.toFixed(2)}`)
      }
    }
    if (n > 0) {
      factors.push({
        label: 'Positioning (contrarian)',
        value: clamp(acc / n, -1, 1),
        weight: 0.08,
        available: true,
        detail: detailParts.join(', '),
      })
    }
  }

  return factors
}

function aggregateBias(factors: FactorScore[]): { bias: number; confidence: number } {
  const avail = factors.filter((f) => f.available)
  const wsum = avail.reduce((a, f) => a + f.weight, 0)
  if (wsum === 0) return { bias: 0, confidence: 0 }
  const bias = avail.reduce((a, f) => a + f.weight * f.value, 0) / wsum
  // Agreement: share of weight pointing the same direction as the net bias.
  const dir = Math.sign(bias)
  const agreeW = avail.filter((f) => Math.sign(f.value) === dir && dir !== 0).reduce((a, f) => a + f.weight, 0)
  const agreement = dir === 0 ? 0 : agreeW / wsum
  const confidence = clamp(Math.abs(bias) * 70 + agreement * 30, 0, 97)
  return { bias, confidence }
}

// ---- Plan building ----

function buildPlan(
  side: 'LONG' | 'SHORT',
  price: number,
  levels: KeyLevel[],
  atr: number,
  bias: number,
  topReasons: string[],
): TradePlan {
  const isLong = side === 'LONG'
  // Entry candidates: supports below price for LONG, resistances above for SHORT.
  const entrySide = isLong ? 'support' : 'resistance'
  const targetSide = isLong ? 'resistance' : 'support'

  const entryCandidates = levels
    .filter((l) => l.side === entrySide)
    .filter((l) => (isLong ? l.price < price : l.price > price))
  const targets = levels
    .filter((l) => l.side === targetSide)
    .filter((l) => (isLong ? l.price > price : l.price < price))
    .sort((a, b) => (isLong ? a.price - b.price : b.price - a.price))

  const atrPct = price > 0 ? atr / price : 0.01
  const maxDist = Math.max(0.03, atrPct * 3.5) // how far the entry may sit from price

  // Pick the entry level: prefer strong + nearby.
  let best: KeyLevel | null = null
  let bestScore = -Infinity
  for (const l of entryCandidates) {
    const dist = Math.abs(price - l.price) / price
    const score = l.strength - dist * 12
    if (score > bestScore) {
      bestScore = score
      best = l
    }
  }

  const reasons: string[] = []
  let note: string | undefined

  if (!best) {
    // No structural level on that side: fall back to an ATR-based pullback entry.
    const entry = isLong ? price - atr * 1.2 : price + atr * 1.2
    const stop = isLong ? entry - atr * 1.3 : entry + atr * 1.3
    const risk = Math.abs(entry - stop)
    const tp1 = isLong ? entry + risk * 1.8 : entry - risk * 1.8
    const tp2 = isLong ? entry + risk * 3 : entry - risk * 3
    note = 'No clean structural level nearby — ATR-based pullback entry.'
    return {
      side,
      valid: false,
      entry,
      entryLow: Math.min(entry, isLong ? entry - atr * 0.25 : entry),
      entryHigh: Math.max(entry, isLong ? entry : entry + atr * 0.25),
      stop,
      tp1,
      tp2,
      rr: risk > 0 ? Math.abs(tp1 - entry) / risk : 0,
      confidence: clamp(30 + (isLong ? bias : -bias) * 25, 5, 70),
      reasons: [...topReasons],
      note,
    }
  }

  const entry = best.price
  const entryDist = Math.abs(price - entry) / price
  const buffer = Math.max(atr * 0.25, entry * 0.001)
  const entryLow = entry - buffer
  const entryHigh = entry + buffer

  // Stop beyond the entry level.
  const stopBuffer = Math.max(atr * 1.0, entry * 0.004)
  const stop = isLong ? entry - stopBuffer : entry + stopBuffer
  const risk = Math.abs(entry - stop)

  // Prefer structural targets that are at least ~1R away so the reward is
  // meaningful; otherwise fall back to R-multiples.
  const minReward = risk * 1.0
  const farTargets = targets.filter((t) => Math.abs(t.price - entry) >= minReward)
  const nearObstacle = targets.find((t) => Math.abs(t.price - entry) < minReward)
  const tp1Level = farTargets[0]
  const tp2Level = farTargets[1]
  const tp1 = tp1Level?.price ?? (isLong ? entry + risk * 1.8 : entry - risk * 1.8)
  const tp2 = tp2Level?.price ?? (isLong ? entry + risk * 3 : entry - risk * 3)
  const rr = risk > 0 ? Math.abs(tp1 - entry) / risk : 0

  reasons.push(`Entry at ${best.sources.join(' + ')}`)
  if (tp1Level) reasons.push(`TP1 at ${tp1Level.sources.join(' + ')}`)
  if (nearObstacle) {
    reasons.push(
      `Watch near ${isLong ? 'resistance' : 'support'} at ${nearObstacle.price.toPrecision(6)} (${nearObstacle.sources[0]})`,
    )
  }
  reasons.push(...topReasons)

  const alignment = isLong ? bias : -bias
  const confidence = clamp(
    40 + alignment * 28 + best.strength * 18 + (clamp(rr, 0, 3) / 3) * 12,
    5,
    96,
  )

  return {
    side,
    valid: rr >= 1,
    entry,
    entryLow,
    entryHigh,
    stop,
    tp1,
    tp2,
    rr,
    confidence,
    reasons,
    note:
      rr < 1
        ? 'Risk/reward below 1 — weak setup at current levels.'
        : entryDist > maxDist
          ? 'Entry sits far from price — wait for a pullback into the zone.'
          : undefined,
  }
}

// ---- Entry point ----

export function buildSetup(input: SetupInput): SetupResult | null {
  const { candles, book, derivatives } = input
  if (!candles || candles.length < 30) return null
  const price = candles[candles.length - 1].close
  const atr = lastDefined(atrIndic(candles, 14)) ?? price * 0.01

  const factors = scoreFactors(candles, book, derivatives, price)
  const { bias, confidence } = aggregateBias(factors)
  const biasLabel: SetupResult['biasLabel'] = bias > 0.12 ? 'LONG' : bias < -0.12 ? 'SHORT' : 'NEUTRAL'

  const levels = buildLevels(candles, book, price)

  // Top contributing reasons (by absolute contribution), for plan annotations.
  const sortedFactors = [...factors].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
  const bullReasons = sortedFactors.filter((f) => f.value > 0.1).slice(0, 3).map((f) => `${f.label}: ${f.detail}`)
  const bearReasons = sortedFactors.filter((f) => f.value < -0.1).slice(0, 3).map((f) => `${f.label}: ${f.detail}`)

  const long = buildPlan('LONG', price, levels, atr, bias, bullReasons)
  const short = buildPlan('SHORT', price, levels, atr, bias, bearReasons)

  return {
    price,
    atr,
    bias,
    biasLabel,
    biasConfidence: confidence,
    factors,
    levels,
    long,
    short,
    hasLiquidity: Boolean(book),
    hasDerivatives: Boolean(derivatives && (derivatives.oi?.length || derivatives.taker?.length || derivatives.longShort?.length)),
  }
}
