// Reversal-fuel / squeeze-danger model.
//
// Big players flip the market by hunting a key level, triggering the stops and
// liquidations of the crowded, over-leveraged side, then riding the cascade. The
// "fuel" for such a reversal is the crowded side's open interest — the pile of
// positions that can be bought up / liquidated.
//
// The danger is evaluated *against a position side*: a LONG fears a downside
// flush (longs get liquidated, price flips down); a SHORT fears an upside squeeze
// (shorts get run over, price flips up). So the score differs for LONG vs SHORT —
// e.g. when the crowd is 74% long, the risk of a downside reversal (bad for longs)
// is high while the upside-squeeze risk (bad for shorts) is low.
//
// Components (each 0..1):
//   - Crowd pressure ........... how lopsided positioning is *toward the side that
//                                fuels a reversal against this position*
//   - OI vs turnover ........... how big the position pile is for this coin
//   - OI build-up .............. positions stacking up (loaded spring in a range)
//   - Trigger proximity ........ how close price sits to the level that ignites it
//   - Book fragility ........... how little resting liquidity gates that level
//
// The score is normalized per-coin by recent turnover and lightly amplified by
// BTC's volatility regime. All thresholds live in config (`REVERSAL_RISK`).

import type { Candle } from '../../../lib/candles'
import type { ParsedBook } from '../orderbook'
import type { Regime } from './signal'
import type { KeyLevel } from './engine'
import type { OpenInterestPoint, LongShortPoint } from '../../../lib/binance/types'
import { REVERSAL_RISK as R } from './config'

export type ReversalDirection = 'flush-down' | 'squeeze-up'
export type CrowdedSide = 'long' | 'short' | 'balanced'
export type ReversalLevel = 'low' | 'elevated' | 'high' | 'extreme'

export interface MarketContext {
  /** BTC ATR as a % of price on the context timeframe (a volatility proxy). */
  btcAtrPct?: number
  /** BTC trend, normalized to roughly -1..+1. */
  btcTrend?: number
}

export interface ReversalComponent {
  label: string
  /** 0..1 contribution to the danger score. */
  value: number
  weight: number
  detail: string
}

export interface ReversalRisk {
  /** The position side this risk is evaluated *against*. */
  side: 'LONG' | 'SHORT'
  available: boolean
  score: number // 0..100
  level: ReversalLevel
  /** Which way the reversal would break (down for a LONG, up for a SHORT). */
  direction: ReversalDirection
  /** The market's actual crowded side (for display, independent of `side`). */
  crowdedSide: CrowdedSide
  /** Estimated notional (USD) of the side that fuels this reversal — the "fuel". */
  fuelNotional: number
  /** The same fuel expressed in base-asset units (the "x positions"). */
  fuelCoin: number
  oiNotional: number
  oiChangePct: number
  longAccount: number // 0..1
  shortAccount: number // 0..1
  longShortRatio: number
  funding: number | null
  triggerLevel: number | null
  triggerDistanceAtr: number | null
  /** Resting book notional to absorb to drag price to the trigger level. */
  triggerCostNotional: number | null
  btcMult: number
  components: ReversalComponent[]
  dataNote?: string
}

/** Reversal risk evaluated for both position sides. */
export interface ReversalRiskBySide {
  long: ReversalRisk
  short: ReversalRisk
}

export interface ReversalRiskInput {
  /** The position side to evaluate the reversal danger against. */
  side: 'LONG' | 'SHORT'
  price: number
  atr: number
  regime: Regime
  candles: Candle[]
  levels: KeyLevel[]
  book: ParsedBook | null
  oi?: OpenInterestPoint[]
  longShort?: LongShortPoint[]
  funding?: number | null
  marketContext?: MarketContext
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}

/** Sum of close*volume across the most recent bars — a per-coin turnover proxy. */
function recentTurnover(candles: Candle[], bars: number): number {
  let sum = 0
  const start = Math.max(0, candles.length - bars)
  for (let i = start; i < candles.length; i++) {
    const c = candles[i]
    if (Number.isFinite(c.close) && Number.isFinite(c.volume)) sum += c.close * c.volume
  }
  return sum
}

/** Resting book notional between two prices on one side of the book. */
function restingBetween(book: ParsedBook, lo: number, hi: number, bookSide: 'bid' | 'ask'): number {
  const levels = bookSide === 'bid' ? book.bids : book.asks
  let sum = 0
  for (const l of levels) {
    if (l.price >= lo && l.price <= hi) sum += l.price * l.qty
  }
  return sum
}

function levelFor(score: number): ReversalLevel {
  if (score >= R.extreme) return 'extreme'
  if (score >= R.high) return 'high'
  if (score >= R.elevated) return 'elevated'
  return 'low'
}

function emptyRisk(side: 'LONG' | 'SHORT', funding: number | null, dataNote?: string): ReversalRisk {
  return {
    side,
    available: false,
    score: 0,
    level: 'low',
    direction: side === 'LONG' ? 'flush-down' : 'squeeze-up',
    crowdedSide: 'balanced',
    fuelNotional: 0,
    fuelCoin: 0,
    oiNotional: 0,
    oiChangePct: 0,
    longAccount: 0,
    shortAccount: 0,
    longShortRatio: 1,
    funding,
    triggerLevel: null,
    triggerDistanceAtr: null,
    triggerCostNotional: null,
    btcMult: 1,
    components: [],
    dataNote,
  }
}

export function computeReversalRisk(input: ReversalRiskInput): ReversalRisk {
  const { side, price, atr, regime, candles, levels, book, oi, longShort, funding, marketContext } = input
  const fund = funding === undefined ? null : funding
  if (!Number.isFinite(price) || price <= 0) return emptyRisk(side, fund)

  // A LONG reverses downward (a flush); a SHORT reverses upward (a squeeze).
  const direction: ReversalDirection = side === 'LONG' ? 'flush-down' : 'squeeze-up'
  const missing: string[] = []

  // ---- Open-interest pile + build-up ----
  let oiNotional = 0
  let oiChangePct = 0
  let hasOi = false
  let hasOiSeries = false
  if (oi && oi.length) {
    const last = oi[oi.length - 1]
    const lastVal = num(last.sumOpenInterestValue)
    const lastBase = num(last.sumOpenInterest)
    oiNotional =
      Number.isFinite(lastVal) && lastVal > 0
        ? lastVal
        : Number.isFinite(lastBase)
          ? lastBase * price
          : 0
    hasOi = oiNotional > 0
    if (oi.length > 2) {
      const first = num(oi[0].sumOpenInterest)
      const lastB = num(oi[oi.length - 1].sumOpenInterest)
      if (first > 0 && Number.isFinite(lastB)) {
        oiChangePct = (lastB - first) / first
        hasOiSeries = true
      }
    }
  }
  if (!hasOi) missing.push('open interest')

  // ---- Crowd skew (market-wide; positive = long-crowded) ----
  let longAccount = 0
  let shortAccount = 0
  let longShortRatio = 1
  let hasLs = false
  if (longShort && longShort.length) {
    const last = longShort[longShort.length - 1]
    const la = num(last.longAccount)
    const sa = num(last.shortAccount)
    const ratio = num(last.longShortRatio)
    if (Number.isFinite(la) && Number.isFinite(sa) && la + sa > 0) {
      longAccount = la
      shortAccount = sa
      hasLs = true
    }
    if (Number.isFinite(ratio) && ratio > 0) longShortRatio = ratio
  }

  let skew = 0
  if (hasLs) {
    skew = longAccount - shortAccount
  } else if (longShortRatio !== 1) {
    skew = clamp(((longShortRatio - 1) / (longShortRatio + 1)) * 2, -1, 1)
  } else if (fund !== null) {
    skew = clamp(fund / R.fundingStrong, -1, 1)
  }
  if (!hasLs && longShortRatio === 1 && fund === null) missing.push('long/short ratio')

  const crowdedSide: CrowdedSide =
    skew > R.balancedSkew ? 'long' : skew < -R.balancedSkew ? 'short' : 'balanced'
  const hasCrowd = hasLs || longShortRatio !== 1 || fund !== null

  // Crowd pressure *toward the side that fuels a reversal against this position*:
  // a LONG is endangered by long crowding; a SHORT by short crowding.
  const sideSkew = side === 'LONG' ? skew : -skew
  let crowdingVal = clamp(sideSkew / R.crowdSkewFull, 0, 1)
  if (fund !== null) {
    const fundingFuels = side === 'LONG' ? fund > 0 : fund < 0
    if (fundingFuels && Math.abs(fund) >= R.fundingStrong) {
      crowdingVal = clamp(crowdingVal + R.fundingAgreeBoost, 0, 1)
    }
  }

  // ---- Fuel: the endangering side's share of the OI pile ----
  const sideShare = hasLs ? (side === 'LONG' ? longAccount : shortAccount) : 0.5
  const fuelNotional = oiNotional * sideShare
  const fuelCoin = price > 0 ? fuelNotional / price : 0

  // ---- OI heaviness vs recent turnover (shared by both sides) ----
  const turnover = recentTurnover(candles, R.turnoverBars)
  const hasHeavy = turnover > 0 && hasOi
  const heavyVal = hasHeavy ? clamp(oiNotional / turnover / R.oiToVolTarget, 0, 1) : 0

  // ---- OI build-up (rising OI; loaded harder in a range) ----
  let buildupVal = 0
  if (hasOiSeries && oiChangePct > 0) {
    buildupVal = clamp(oiChangePct / R.oiBuildupNorm, 0, 1)
    if (regime.type === 'RANGE') buildupVal = clamp(buildupVal * R.rangeBuildupBoost, 0, 1)
  }

  // ---- Trigger proximity (nearest level in the reversal direction) ----
  let triggerLevel: number | null = null
  let triggerDistanceAtr: number | null = null
  let proximityVal = 0
  let hasProximity = false
  if (levels.length && atr > 0) {
    const wantSide: 'support' | 'resistance' = direction === 'squeeze-up' ? 'resistance' : 'support'
    const candidates = levels.filter((l) => l.side === wantSide)
    let best: KeyLevel | null = null
    let bestDist = Infinity
    for (const l of candidates) {
      if (l.price <= 0) continue
      const d = Math.abs(l.price - price)
      if (d < bestDist) {
        bestDist = d
        best = l
      }
    }
    if (best) {
      triggerLevel = best.price
      triggerDistanceAtr = bestDist / atr
      proximityVal = clamp(1 - triggerDistanceAtr / R.triggerMaxAtr, 0, 1)
      hasProximity = true
    }
  }

  // ---- Book fragility: how little resting liquidity gates the trigger ----
  let triggerCostNotional: number | null = null
  let fragilityVal = 0
  let hasFragility = false
  if (book && triggerLevel !== null && turnover > 0) {
    const lo = Math.min(price, triggerLevel)
    const hi = Math.max(price, triggerLevel)
    // Pushing down eats bids; pushing up eats asks.
    const bookSide: 'bid' | 'ask' = direction === 'squeeze-up' ? 'ask' : 'bid'
    triggerCostNotional = restingBetween(book, lo, hi, bookSide)
    fragilityVal = clamp(1 - triggerCostNotional / (turnover * R.bookCostTarget), 0, 1)
    hasFragility = true
  }

  // ---- Combine available components (weights renormalized) ----
  const comps: ReversalComponent[] = []
  if (hasCrowd) {
    const lsTxt = hasLs
      ? `${(longAccount * 100).toFixed(0)}% long / ${(shortAccount * 100).toFixed(0)}% short`
      : `L/S ${longShortRatio.toFixed(2)}`
    const fuelSideTxt = side === 'LONG' ? 'longs' : 'shorts'
    comps.push({
      label: 'Crowd pressure',
      value: crowdingVal,
      weight: R.wCrowd,
      detail: `${fuelSideTxt} as fuel · ${lsTxt}`,
    })
  }
  if (hasHeavy) {
    comps.push({
      label: 'OI vs turnover',
      value: heavyVal,
      weight: R.wHeavy,
      detail: `OI ${(oiNotional / turnover).toFixed(2)}x recent turnover`,
    })
  }
  if (hasOiSeries) {
    comps.push({
      label: 'OI build-up',
      value: buildupVal,
      weight: R.wBuildup,
      detail: `OI ${oiChangePct >= 0 ? '+' : ''}${(oiChangePct * 100).toFixed(1)}%${regime.type === 'RANGE' ? ' in range' : ''}`,
    })
  }
  if (hasProximity) {
    comps.push({
      label: 'Trigger proximity',
      value: proximityVal,
      weight: R.wProximity,
      detail: `${triggerDistanceAtr!.toFixed(1)} ATR to ${direction === 'squeeze-up' ? 'resistance' : 'support'}`,
    })
  }
  if (hasFragility) {
    comps.push({
      label: 'Book fragility',
      value: fragilityVal,
      weight: R.wBookFragility,
      detail: `${((triggerCostNotional! / turnover) * 100).toFixed(1)}% of turnover gates it`,
    })
  }

  if (comps.length === 0) {
    return emptyRisk(side, fund, 'Derivatives & order-book data unavailable for this symbol.')
  }

  const wsum = comps.reduce((a, c) => a + c.weight, 0)
  const raw = wsum > 0 ? comps.reduce((a, c) => a + c.weight * c.value, 0) / wsum : 0

  // BTC volatility multiplier (light): elevated BTC vol amplifies the danger.
  let btcMult = 1
  const btcAtrPct = marketContext?.btcAtrPct
  if (btcAtrPct !== undefined && Number.isFinite(btcAtrPct) && R.btcVolBaselinePct > 0) {
    const dev = (btcAtrPct - R.btcVolBaselinePct) / R.btcVolBaselinePct
    btcMult = clamp(1 + R.btcVolK * dev, R.btcMultMin, R.btcMultMax)
  }

  const score = clamp(raw * btcMult, 0, 1) * 100

  return {
    side,
    available: true,
    score,
    level: levelFor(score),
    direction,
    crowdedSide,
    fuelNotional,
    fuelCoin,
    oiNotional,
    oiChangePct,
    longAccount,
    shortAccount,
    longShortRatio,
    funding: fund,
    triggerLevel,
    triggerDistanceAtr,
    triggerCostNotional,
    btcMult,
    components: comps,
    dataNote: missing.length ? `Limited data: ${missing.join(', ')} missing.` : undefined,
  }
}

/** Convenience: evaluate reversal risk for both position sides at once. */
export function computeReversalRiskBySide(input: Omit<ReversalRiskInput, 'side'>): ReversalRiskBySide {
  return {
    long: computeReversalRisk({ ...input, side: 'LONG' }),
    short: computeReversalRisk({ ...input, side: 'SHORT' }),
  }
}
