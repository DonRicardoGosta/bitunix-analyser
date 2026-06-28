import type { PositionSide, RiskLevel } from '@shared/challenge/types'
import type { Candle } from '@shared/market/candle'
import type { KlineInterval } from '@shared/market/intervals'
import type { StoredPosition } from '../db/types'

// Per-coin strategy framework (items 7 + 9). Each strategy is a pure decision
// function over candles + the current position, parameterised by a risk level.

/** Tunables resolved per risk level and snapshotted at entry. */
export interface RiskParams {
  /** Confidence (0..100) required to open a new position. */
  minConfidence: number
  /** Bias magnitude (0..1) required to act on a direction. */
  trendThreshold: number
  /** Take-profit threshold, as a percentage of the position margin. */
  takeProfitPct: number
  /** Stop-loss threshold, as a percentage of the position margin. */
  stopLossPct: number
  /** Minimum seconds between entries for the same coin. */
  cooldownSec: number
}

export interface StrategyContext {
  symbol: string
  interval: KlineInterval
  /** Closed candles ascending; the last element is the most recent closed bar. */
  candles: Candle[]
  /** Latest known price (forming-candle close). */
  price: number
  riskLevel: RiskLevel
  params: RiskParams
  /** The challenge's current open position for this coin, if any. */
  position?: StoredPosition
  now: number
}

export type DecisionAction = 'open_long' | 'open_short' | 'close' | 'hold'

export interface Decision {
  action: DecisionAction
  side?: PositionSide
  reasons: string[]
  confidence?: number
  bias?: number
  meta?: Record<string, unknown>
}

export interface Strategy {
  id: string
  /** Symbols this strategy is the default for; empty/omitted = generic. */
  symbols?: string[]
  /** Preferred kline interval. */
  interval: KlineInterval
  /** Candles required before the strategy will act. */
  warmup: number
  /** Resolve tunables for a risk level (snapshotted into the position at entry). */
  resolveParams(riskLevel: RiskLevel): RiskParams
  /** Evaluate on a freshly closed candle (or forming tick). */
  evaluate(ctx: StrategyContext): Decision
}
