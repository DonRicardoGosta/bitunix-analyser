import type { Candle } from '../../../lib/candles'
import { bollinger, ema, vwap } from '../../../lib/indicators'
import { binLiquidity, imbalance, type ParsedBook } from '../orderbook'
import { volumeProfile } from '../volumeProfile'
import type {
  LongShortPoint,
  OpenInterestPoint,
  TakerVolumePoint,
} from '../../../lib/binance/types'
import {
  buildCtx,
  candleFactors,
  detectRegime,
  neutralBand,
  trendValue,
  type CandleCtx,
  type FactorScore,
  type Regime,
} from './signal'
import { backtestSignal, type BacktestStats } from './backtest'
import { backtestRangeReversal } from './rangeBacktest'
import { buildRangeStraddle, type RangeStraddlePlan } from './straddle'
import { buildPositionBuilder, suggestBuildSide, type PositionBuilderPlan } from './builder'
import { detectPatterns, type DetectedPattern } from './patterns'
import { computeReversalRiskBySide, type ReversalRiskBySide, type MarketContext } from './reversalRisk'
import { BACKTEST, HTF, MAX_TOTAL_WEIGHT, PLAN, WEIGHTS } from './config'

export type { FactorScore, Regime } from './signal'
export type { BacktestStats } from './backtest'
export type { RangeBacktestStats } from './rangeBacktest'
export type { RangeStraddlePlan, RangeStraddleLeg } from './straddle'
export type { PositionBuilderPlan, BuilderRung } from './builder'
export type { DetectedPattern, PatternId, PatternDirection } from './patterns'
export type {
  ReversalRisk,
  ReversalRiskBySide,
  ReversalDirection,
  ReversalComponent,
  ReversalLevel,
  MarketContext,
} from './reversalRisk'

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
  quality: number // 0..100 — combined setup quality (rr + alignment + confluence + regime)
  counterTrend: boolean // fights the higher-timeframe trend
  reasons: string[]
  note?: string
}

export interface SetupResult {
  price: number
  atr: number
  bias: number // -1..+1
  biasLabel: 'LONG' | 'SHORT' | 'NEUTRAL'
  biasConfidence: number // 0..100
  regime: Regime
  htfTrend: number | null // -1..+1 higher-timeframe trend, null when unavailable
  factors: FactorScore[]
  levels: KeyLevel[]
  long: TradePlan
  short: TradePlan
  /** Both-directions range straddle at strong levels (check `.valid` before use). */
  straddle: RangeStraddlePlan
  /** Laddered scale-in (Position Builder) for the suggested side at default rung count. */
  builder: PositionBuilderPlan
  backtest: BacktestStats | null
  /** Entry-signalling candlestick / price-action patterns completing near now. */
  patterns: DetectedPattern[]
  /** Reversal-fuel / squeeze-danger estimate per side (how much "ammo" exists to flip the market against a LONG / SHORT). */
  reversalRisk: ReversalRiskBySide
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
  /** Higher-timeframe candles for trend confirmation (optional). */
  htfCandles?: Candle[]
  /** Broader market context (e.g. BTC volatility) for the reversal-risk model. */
  marketContext?: MarketContext
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
  ctx: CandleCtx,
  book: ParsedBook | null,
  derivatives: DerivativesSnapshot | undefined,
  regime: Regime,
  htfValue: number | null,
): FactorScore[] {
  const candles = ctx.candles
  const i = candles.length - 1
  const price = ctx.closes[i]

  // Candle-derived factors (shared with the backtester / scanner).
  const factors: FactorScore[] = candleFactors(ctx, i, htfValue, regime)

  // Order-book imbalance — de-weighted and gated by spread quality, since the
  // snapshot is noisy and easily spoofed.
  if (book) {
    const imb = imbalance(book, 1)
    const quality = clamp(1 - book.spreadPct / 0.1, 0.3, 1)
    factors.push({
      label: 'Order-book imbalance',
      value: clamp(imb.skew, -1, 1),
      weight: WEIGHTS.orderBook * quality,
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
        weight: WEIGHTS.taker,
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
    factors.push({ label: 'Open interest', value, weight: WEIGHTS.openInterest, available: true, detail })
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
        weight: WEIGHTS.positioning,
        available: true,
        detail: detailParts.join(', '),
      })
    }
  }

  return factors
}

function aggregateBias(
  factors: FactorScore[],
  regime: Regime,
  htfValue: number | null,
): { bias: number; confidence: number } {
  const avail = factors.filter((f) => f.available)
  const wsum = avail.reduce((a, f) => a + f.weight, 0)
  if (wsum === 0) return { bias: 0, confidence: 0 }
  const bias = avail.reduce((a, f) => a + f.weight * f.value, 0) / wsum
  // Agreement: share of weight pointing the same direction as the net bias.
  const dir = Math.sign(bias)
  const agreeW = avail.filter((f) => Math.sign(f.value) === dir && dir !== 0).reduce((a, f) => a + f.weight, 0)
  const agreement = dir === 0 ? 0 : agreeW / wsum

  // How much of the intended signal weight we actually have. Candle-only reads
  // (no order book / derivatives) are penalized but not killed.
  const coverage = clamp(wsum / MAX_TOTAL_WEIGHT, 0, 1)
  const coverageFactor = 0.6 + 0.4 * coverage
  // Choppy regimes get a lower ceiling than clean trends.
  const regimeFactor = 0.65 + 0.35 * regime.trendStrength
  // Fighting the higher-timeframe trend caps confidence.
  let htfFactor = 1
  if (htfValue !== null && dir !== 0 && Math.sign(htfValue) !== dir) {
    htfFactor = clamp(1 - Math.abs(htfValue) * HTF.conflictPenalty, 1 - HTF.conflictPenalty, 1)
  }

  const raw = Math.abs(bias) * 70 + agreement * 30
  const confidence = clamp(raw * regimeFactor * coverageFactor * htfFactor, 0, 97)
  return { bias, confidence }
}

// ---- Plan building ----

function buildPlan(
  side: 'LONG' | 'SHORT',
  price: number,
  levels: KeyLevel[],
  atr: number,
  bias: number,
  regime: Regime,
  htfValue: number | null,
  topReasons: string[],
): TradePlan {
  const isLong = side === 'LONG'
  // A plan that fights the higher-timeframe trend is flagged and never "valid".
  const counterTrend =
    htfValue !== null &&
    ((isLong && htfValue < -HTF.conflictThreshold) || (!isLong && htfValue > HTF.conflictThreshold))

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
  const maxDist = Math.max(PLAN.maxEntryDistPct, atrPct * PLAN.maxEntryDistAtrMult)

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

  if (!best) {
    // No structural level on that side: fall back to an ATR-based pullback entry.
    const entry = isLong ? price - atr * PLAN.fallbackEntryAtr : price + atr * PLAN.fallbackEntryAtr
    const stop = isLong ? entry - atr * PLAN.fallbackStopAtr : entry + atr * PLAN.fallbackStopAtr
    const risk = Math.abs(entry - stop)
    const tp1 = isLong ? entry + risk * PLAN.fallbackTp1R : entry - risk * PLAN.fallbackTp1R
    const tp2 = isLong ? entry + risk * PLAN.fallbackTp2R : entry - risk * PLAN.fallbackTp2R
    const alignment = isLong ? bias : -bias
    return {
      side,
      valid: false,
      entry,
      entryLow: Math.min(entry, isLong ? entry - atr * PLAN.entryBufferAtr : entry),
      entryHigh: Math.max(entry, isLong ? entry : entry + atr * PLAN.entryBufferAtr),
      stop,
      tp1,
      tp2,
      rr: risk > 0 ? Math.abs(tp1 - entry) / risk : 0,
      confidence: clamp(30 + alignment * 25, 5, 70),
      quality: clamp(20 + alignment * 20 + regime.trendStrength * 10 - (counterTrend ? 15 : 0), 0, 60),
      counterTrend,
      reasons: [...topReasons],
      note: counterTrend
        ? 'Against the higher-timeframe trend — counter-trend, no clean level nearby.'
        : 'No clean structural level nearby — ATR-based pullback entry.',
    }
  }

  const entry = best.price
  const entryDist = Math.abs(price - entry) / price
  const buffer = Math.max(atr * PLAN.entryBufferAtr, entry * PLAN.entryBufferPct)
  const entryLow = entry - buffer
  const entryHigh = entry + buffer

  // Stop beyond the entry level.
  const stopBuffer = Math.max(atr * PLAN.stopBufferAtr, entry * PLAN.stopBufferPct)
  const stop = isLong ? entry - stopBuffer : entry + stopBuffer
  const risk = Math.abs(entry - stop)

  // Prefer structural targets that are at least ~1R away so the reward is
  // meaningful; otherwise fall back to R-multiples.
  const minReward = risk * 1.0
  const farTargets = targets.filter((t) => Math.abs(t.price - entry) >= minReward)
  const nearObstacle = targets.find((t) => Math.abs(t.price - entry) < minReward)
  const tp1Level = farTargets[0]
  const tp2Level = farTargets[1]
  const tp1 = tp1Level?.price ?? (isLong ? entry + risk * PLAN.fallbackTp1R : entry - risk * PLAN.fallbackTp1R)
  const tp2 = tp2Level?.price ?? (isLong ? entry + risk * PLAN.fallbackTp2R : entry - risk * PLAN.fallbackTp2R)
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
  const farEntry = entryDist > maxDist
  const confidence = clamp(
    40 + alignment * 28 + best.strength * 18 + (clamp(rr, 0, 3) / 3) * 12 - (counterTrend ? 20 : 0),
    5,
    96,
  )
  const quality = clamp(
    35 +
      alignment * 22 +
      best.strength * 15 +
      (clamp(rr, 0, 3) / 3) * 15 +
      regime.trendStrength * 13 -
      (counterTrend ? 22 : 0) -
      (farEntry ? 10 : 0),
    0,
    100,
  )

  const valid = rr >= PLAN.targetRR && !farEntry && !counterTrend

  return {
    side,
    valid,
    entry,
    entryLow,
    entryHigh,
    stop,
    tp1,
    tp2,
    rr,
    confidence,
    quality,
    counterTrend,
    reasons,
    note: counterTrend
      ? 'Against the higher-timeframe trend — high risk, treat as counter-trend.'
      : rr < PLAN.targetRR
        ? `Risk/reward ${rr.toFixed(2)} below target ${PLAN.targetRR} — weak setup here.`
        : farEntry
          ? 'Entry sits far from price — wait for a pullback into the zone.'
          : undefined,
  }
}

// ---- Entry point ----

/** Confluence support/resistance levels from candles, volume profile, indicators, and order book. */
export function computeKeyLevels(candles: Candle[], book: ParsedBook | null, price?: number): KeyLevel[] {
  const ref = price ?? (candles.length ? candles[candles.length - 1].close : 0)
  return buildLevels(candles, book, ref)
}

/** Higher-timeframe trend (-1..+1) from a separate candle series, or null. */
function htfTrend(htfCandles: Candle[] | undefined): number | null {
  if (!htfCandles || htfCandles.length < 50) return null
  const closes = htfCandles.map((c) => c.close)
  const fast = lastDefined(ema(closes, 9))
  const slow = lastDefined(ema(closes, 50))
  const price = closes[closes.length - 1]
  return trendValue(fast, slow, price)
}

export function buildSetup(input: SetupInput): SetupResult | null {
  const { candles, book, derivatives, htfCandles } = input
  if (!candles || candles.length < 30) return null
  const price = candles[candles.length - 1].close
  const ctx = buildCtx(candles)
  const atr = lastDefined(ctx.atr) ?? price * 0.01

  const regime = detectRegime(candles)
  const htfValue = htfTrend(htfCandles)

  const factors = scoreFactors(ctx, book, derivatives, regime, htfValue)
  const { bias, confidence } = aggregateBias(factors, regime, htfValue)
  const band = neutralBand(regime)
  const biasLabel: SetupResult['biasLabel'] = bias > band ? 'LONG' : bias < -band ? 'SHORT' : 'NEUTRAL'

  const levels = buildLevels(candles, book, price)

  // Entry-signalling patterns (candlestick + price action) completing near now.
  const patterns = detectPatterns(candles, { atr, levels, regime })

  // Reversal-fuel / squeeze danger per side: how big the crowded position pile is
  // and how close / fragile the level that would ignite a reversal against a
  // LONG (downside flush) or a SHORT (upside squeeze).
  const reversalRisk = computeReversalRiskBySide({
    price,
    atr,
    regime,
    candles,
    levels,
    book,
    oi: derivatives?.oi,
    longShort: derivatives?.longShort,
    funding: derivatives?.fundingRate,
    marketContext: input.marketContext,
  })

  // Top contributing reasons (by absolute contribution), for plan annotations.
  const sortedFactors = [...factors].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
  const bullReasons = sortedFactors.filter((f) => f.value > 0.1).slice(0, 3).map((f) => `${f.label}: ${f.detail}`)
  const bearReasons = sortedFactors.filter((f) => f.value < -0.1).slice(0, 3).map((f) => `${f.label}: ${f.detail}`)

  const long = buildPlan('LONG', price, levels, atr, bias, regime, htfValue, bullReasons)
  const short = buildPlan('SHORT', price, levels, atr, bias, regime, htfValue, bearReasons)

  // Both-directions range straddle, validated by a range-reversal backtest.
  const rangeBacktest = backtestRangeReversal(candles)
  const straddle = buildRangeStraddle({ price, levels, atr, regime, backtest: rangeBacktest })

  // Position Builder (laddered scale-in) for the suggested side at default rungs.
  const builder = buildPositionBuilder({
    side: suggestBuildSide(htfValue, bias),
    price,
    levels,
    atr,
    regime,
    htfValue,
    bias,
  })

  // Historical validation of the candle-derived signal.
  const backtest = backtestSignal(candles)

  // Nudge confidence by the measured expectancy when we have enough samples.
  let biasConfidence = confidence
  if (backtest && backtest.samples >= BACKTEST.minSamples) {
    const factor = clamp(1 + clamp(backtest.expectancy, -0.5, 0.5) * 0.4, 0.7, 1.2)
    biasConfidence = clamp(confidence * factor, 0, 97)
  }

  return {
    price,
    atr,
    bias,
    biasLabel,
    biasConfidence,
    regime,
    htfTrend: htfValue,
    factors,
    levels,
    long,
    short,
    straddle,
    builder,
    backtest,
    patterns,
    reversalRisk,
    hasLiquidity: Boolean(book),
    hasDerivatives: Boolean(derivatives && (derivatives.oi?.length || derivatives.taker?.length || derivatives.longShort?.length)),
  }
}
