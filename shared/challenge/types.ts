// Shared domain + API contract types for the Challenge engine.
//
// Imported by both the SPA (via the `@shared/*` path alias) and the Node
// backend (`server/`). Keep this file free of runtime/browser/node-specific
// imports so it can be consumed from either environment.

export type TradingMode = 'live' | 'paper'

/** 1 = conservative, 2 = normal, 3 = aggressive. */
export type RiskLevel = 1 | 2 | 3

export type RunStatus = 'running' | 'success' | 'failed' | 'stopped'

export type PositionSide = 'LONG' | 'SHORT'

export type EventLevel = 'info' | 'warn' | 'error'

export type EventCategory = 'entry' | 'exit' | 'risk' | 'signal' | 'api' | 'system'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CoinConfig {
  symbol: string
  /** Leverage applied to this coin's positions. */
  leverage: number
  /** Order size per entry, in base units (coins/contracts). */
  orderQty: number
  /** USDT margin reserved for this coin within the challenge. */
  marginAllocated: number
  /** Per-coin risk level; editable while running (affects new decisions only). */
  riskLevel: RiskLevel
  /** Optional strategy override; otherwise resolved by symbol. */
  strategyId?: string
}

export interface ChallengeConfigInput {
  name: string
  mode: TradingMode
  /** Equity the challenge starts from (USDT). */
  startBalance: number
  /** Cap on the total account balance the challenge may commit (percent). */
  maxAccountUsagePct: number
  /** Profit target as a percentage of the start balance. */
  profitTargetPct: number
  /** Loss (drawdown) percentage of the start balance that fails the challenge. */
  maxLossPct: number
  coins: CoinConfig[]
}

export interface ChallengeConfig extends ChallengeConfigInput {
  id: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface ChallengePosition {
  id: string
  challengeId: string
  symbol: string
  side: PositionSide
  qty: number
  entryPrice: number
  leverage: number
  /** Margin committed to this position (USDT). */
  margin: number
  markPrice: number
  unrealizedPnl: number
  /** Risk level captured at entry (snapshot; later changes do not apply). */
  riskLevel: RiskLevel
  strategyId: string
  openedAt: number
}

export interface ChallengeRuntime {
  realizedPnl: number
  unrealizedPnl: number
  equity: number
  usedMargin: number
  openPositions: number
}

export interface ChallengeRun {
  id: string
  config: ChallengeConfig
  status: RunStatus
  startedAt: number
  endedAt?: number
  startBalance: number
  realizedPnl: number
  unrealizedPnl: number
  equity: number
  peakEquity: number
  /** Final realized PnL once terminal; live realized PnL while running. */
  resultPnl: number
  /** Human-readable reason the run ended (target hit, max loss, manual stop). */
  closeReason?: string
}

export interface ChallengeEvent {
  id: string
  challengeId: string
  ts: number
  level: EventLevel
  category: EventCategory
  symbol?: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Live per-coin decision snapshot (recomputed each state push). Surfaces WHY the
 * engine is acting or holding for a coin, without waiting for an event.
 */
export interface CoinStatus {
  symbol: string
  riskLevel: RiskLevel
  strategyId: string
  interval: string
  /** Candles available vs the strategy warmup requirement. */
  candles: number
  warmup: number
  /** Latest decision action for this coin (preview, not logged). */
  action: DecisionAction
  reasons: string[]
  evaluatedAt: number
  /** Directional bias in -1..+1 and the entry gate it is compared against. */
  bias: number
  trendThreshold: number
  /** Confidence 0..100 and the minimum gate to open a position. */
  confidence: number
  minConfidence: number
  /** Indicator snapshot. */
  rsi: number
  trend: number
  efficiency: number
  atr: number
  /** Seconds remaining before a new entry is allowed (0 = ready). */
  cooldownRemainingSec: number
  hasPosition: boolean
  position?: {
    side: PositionSide
    /** Live PnL as a percentage of the committed margin. */
    pnlPctOfMargin: number
    takeProfitPct: number
    stopLossPct: number
  }
}

export type DecisionAction = 'open_long' | 'open_short' | 'close' | 'hold'

export interface ChallengeSummary {
  run: ChallengeRun
  runtime: ChallengeRuntime
  positions: ChallengePosition[]
  coinStatus: CoinStatus[]
}

// ---------------------------------------------------------------------------
// REST contract
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: 'INSUFFICIENT_CAPITAL' | 'BELOW_MIN_MARGIN' | 'NO_COINS' | 'INVALID_FIELD' | 'DUPLICATE_SYMBOL'
  message: string
  symbol?: string
}

export interface ValidateConfigResult {
  ok: boolean
  errors: ValidationError[]
  /** Sum of per-coin marginAllocated. */
  totalMarginRequired: number
  /** Available account balance (USDT) seen by the backend. */
  availableBalance: number
  /** maxAccountUsagePct applied to the available balance. */
  maxUsable: number
}

export interface AccountBalanceResponse {
  available: number
  equity: number
  marginCoin: string
}

export interface CredentialsPayload {
  apiKey: string
  secretKey: string
  marginCoin?: string
}

export interface MinMarginResult {
  symbol: string
  minQty: number
  minNotional: number
  /** Smallest viable margin for one order at the given leverage and price. */
  minMargin: number
  price: number
}

export interface CreateChallengeRequest {
  config: ChallengeConfigInput
}

export interface UpdateCoinRiskRequest {
  symbol: string
  riskLevel: RiskLevel
}

export interface ApiError {
  error: string
  details?: unknown
}

// ---------------------------------------------------------------------------
// WebSocket protocol (frontend <-> backend over /api WS)
// ---------------------------------------------------------------------------

export type ClientWsMessage =
  | { op: 'subscribe'; challengeId?: string } // omit challengeId to receive all
  | { op: 'unsubscribe'; challengeId?: string }
  | { op: 'ping' }

export type ServerWsMessage =
  | { type: 'hello'; ts: number }
  | { type: 'pong' }
  | { type: 'runs'; runs: ChallengeRun[] }
  | { type: 'state'; summary: ChallengeSummary }
  | { type: 'event'; event: ChallengeEvent }
