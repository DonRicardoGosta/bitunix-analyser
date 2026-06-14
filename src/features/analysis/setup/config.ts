// Central, tunable configuration for the setup/signal engine.
// Everything that used to be a magic number lives here so the logic can be
// calibrated in one place.

/** Factor weights for the directional bias (candle + market data). */
export const WEIGHTS = {
  trend: 0.2, // EMA9 vs EMA50 (scaled by trend strength)
  htfTrend: 0.18, // higher-timeframe trend confirmation
  structure: 0.1, // market structure (HH/HL vs LH/LL)
  rsi: 0.1, // momentum / mean-reversion (regime dependent)
  macd: 0.1, // ATR-normalized histogram
  vwap: 0.08, // price vs anchored VWAP
  orderBook: 0.08, // resting liquidity imbalance (gated by spread)
  taker: 0.08, // aggressor buy/sell flow
  openInterest: 0.08, // OI trend vs price
  positioning: 0.06, // contrarian funding + crowd long/short
} as const

/** Sum of every known factor weight — the denominator for the coverage score. */
export const MAX_TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)

/** Candle-derived factor weights only (used by the backtester / scanner). */
export const CANDLE_WEIGHT =
  WEIGHTS.trend + WEIGHTS.htfTrend + WEIGHTS.structure + WEIGHTS.rsi + WEIGHTS.macd + WEIGHTS.vwap

/** Directional bias thresholds. The neutral band widens in choppy regimes. */
export const BIAS = {
  bandTrend: 0.12, // |bias| above this => directional in a clean trend
  bandChop: 0.24, // ...and a wider band when the tape is choppy
} as const

/** Regime detection cutoffs (efficiency ratio + choppiness index). */
export const REGIME = {
  erLookback: 30,
  chopPeriod: 14,
  erTrendMin: 0.45, // ER above => trending
  erRangeMax: 0.25, // ER below => ranging
  chopTrendMax: 38.2, // chop below => trending
  chopRangeMin: 61.8, // chop above => ranging
} as const

/** Higher-timeframe alignment thresholds. */
export const HTF = {
  conflictThreshold: 0.3, // |htf trend| beyond this counts as a real conflict
  conflictPenalty: 0.4, // confidence multiplier weight when bias fights HTF
} as const

/** Trade-plan construction. */
export const PLAN = {
  targetRR: 1.5, // min reward:risk for a plan to be "valid"
  fallbackTp1R: 1.8,
  fallbackTp2R: 3,
  entryBufferAtr: 0.25,
  entryBufferPct: 0.001,
  stopBufferAtr: 1.0,
  stopBufferPct: 0.004,
  fallbackEntryAtr: 1.2,
  fallbackStopAtr: 1.3,
  maxEntryDistPct: 0.03, // entry may sit at most this far from price...
  maxEntryDistAtrMult: 3.5, // ...or this many ATR%, whichever is larger
} as const

/**
 * Range-straddle (both-directions) construction & gating.
 *
 * Opens a LONG and SHORT at once between a strong support and a strong
 * resistance, each leg targeting the opposite level. Only meant for strong,
 * range-bound levels — these thresholds keep it out of trending tape.
 */
export const STRADDLE = {
  minLevelStrength: 0.6, // both bounding levels must be at least this strong
  minLegRR: 1.0, // each leg's reward:risk must clear this
  minRangePct: 0.012, // support→resistance gap as a fraction of price
  maxTrendStrength: 0.55, // block when the regime trends harder than this
  // Historical range-reversal gate (see rangeBacktest.ts).
  minSamples: 8, // min simulated straddles before stats can pass the gate
  minExpectancyR: 0, // mean combined R per straddle must beat this
  minBounceRate: 0.5, // share of touched levels that reversed to the far side
} as const

/**
 * Entry-quality evaluation for the single-direction order ticket. Judges
 * whether *now* is a good point to enter, relative to the plan's entry zone,
 * the directional bias, the higher-timeframe trend, and the backtest edge.
 * Distances are measured in risk units (R = |entry - stop|).
 */
export const ENTRY_QUALITY = {
  chaseMildR: 0.5, // beyond the entry zone by this many R => mild chasing
  chaseFarR: 1.0, // ...by this many R => far chasing (poor entry)
  weakQuality: 50, // plan quality below this is a soft (caution) concern
  poorQuality: 30, // plan quality below this is a hard (poor) concern
  minBacktestSamples: 8, // min samples before a negative expectancy counts
} as const

/**
 * Entry-pattern detection (candlestick + price-action). Surfaces market-movement
 * patterns that complete on/near the latest bar so they can act as entry signals.
 * Sizes (bodies/wicks/gaps) are judged relative to ATR so the same thresholds
 * work across coins and timeframes.
 */
export const PATTERNS = {
  recencyBars: 2, // only surface patterns completing within the last N bars
  minConfidence: 0.45, // hide weak detections
  maxSurface: 4, // cap how many patterns to report
  dojiBodyMaxFrac: 0.1, // body <= 10% of the candle range => doji
  hammerWickMult: 2, // rejection wick must be >= this * body
  hammerBodyMaxFrac: 0.35, // ...and the body <= this fraction of the range
  engulfMinBodyAtr: 0.3, // engulfing body must be at least this many ATR to matter
  levelProximityAtr: 0.5, // a bar "tests" a level when within this many ATR
  breakoutLookback: 20, // consolidation window for range breakouts
  breakoutBufferAtr: 0.25, // close must clear the range edge by this many ATR
  doubleTolAtr: 0.6, // two tops/bottoms within this many ATR count as equal
  swingK: 2, // pivot half-width for self-contained swing detection
  swingLookback: 80, // bars scanned for swing pivots
} as const

/**
 * Reversal-fuel / squeeze-danger model. Estimates how big the "pool" of crowded,
 * leveraged positions is — the open interest that big players can hunt and
 * liquidate to flip the market — and turns it into a 0..100 danger score. The
 * score is normalized per-coin by recent turnover (so it is comparable across
 * coins regardless of raw price) and lightly modulated by BTC's volatility.
 */
export const REVERSAL_RISK = {
  turnoverBars: 96, // recent bars summed as the per-coin turnover normalizer (close * volume)
  oiToVolTarget: 1.0, // OI notional == this * turnover => fully "heavy"
  oiBuildupNorm: 0.05, // +5% OI across the OI window => full build-up score
  rangeBuildupBoost: 1.3, // build-up matters more in a RANGE regime (loaded spring)
  triggerMaxAtr: 3, // a trigger level beyond this many ATR adds no proximity danger
  bookWindowPct: 3, // order-book window used for the trigger-cost / fragility calc
  bookCostTarget: 0.05, // resting cost to break the level >= this * turnover => robust (not fragile)
  // Component weights (sum ~1). Missing components are dropped and the rest renormalized.
  wCrowd: 0.3,
  wHeavy: 0.2,
  wBuildup: 0.15,
  wProximity: 0.2,
  wBookFragility: 0.15,
  // Score -> danger level thresholds.
  elevated: 30,
  high: 55,
  extreme: 78,
  balancedSkew: 0.06, // |long%-short%| within this => no clear squeeze direction
  crowdSkewFull: 0.5, // account skew that maps to a full crowding score
  fundingAgreeBoost: 0.15, // extra crowding when funding confirms the crowded side
  fundingStrong: 0.0003, // |funding| beyond this counts as a strong tilt
  // BTC market-context multiplier (light): elevated BTC volatility amplifies alt danger.
  btcVolBaselinePct: 1.2, // typical BTC ATR% per bar baseline
  btcVolK: 0.5, // sensitivity of the multiplier to BTC vol deviation
  btcMultMin: 0.85,
  btcMultMax: 1.4,
} as const

/** MACD histogram is normalized by ATR * this constant. */
export const MACD_ATR_K = 0.6

/** In-browser historical validation parameters. */
export const BACKTEST = {
  lookbackBars: 500, // most recent bars to evaluate
  warmup: 60, // skip the indicator warm-up region
  maxHoldBars: 48, // force-close a simulated trade after this many bars
  cooldownBars: 3, // bars to wait after a trade before re-arming
  minSamples: 8, // min trades before stats influence confidence
} as const
