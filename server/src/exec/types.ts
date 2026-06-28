import type { PositionSide, RiskLevel, TradingMode } from '@shared/challenge/types'
import type { StoredPosition } from '../db/types'

// Common execution-engine interface (item 10). Live and Paper implementations
// are interchangeable so the runner/strategy/risk logic is identical for both;
// only order execution differs.

export interface OpenRequest {
  symbol: string
  side: PositionSide
  /** Order size in base units. */
  qty: number
  leverage: number
  /** Reference (mark) price at decision time. */
  price: number
  riskLevel: RiskLevel
  strategyId: string
  paramsSnapshot?: Record<string, unknown>
}

export interface OpenResult {
  ok: boolean
  position?: StoredPosition
  error?: string
}

export interface CloseResult {
  ok: boolean
  realizedPnl?: number
  closePrice?: number
  error?: string
}

/** Lightweight hook for low-level execution logging into the event log. */
export interface ExecContext {
  emitApi: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  emitError: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
}

export interface ExecutionEngine {
  readonly mode: TradingMode
  readonly challengeId: string
  /** Open a position; persists a StoredPosition on success. */
  openPosition(req: OpenRequest): Promise<OpenResult>
  /** Close a tracked position at/near `price`. */
  closePosition(position: StoredPosition, price: number, reason: string): Promise<CloseResult>
  /** Best-effort available balance (USDT) for capital checks. */
  getAvailableBalance(): Promise<number>
}

/** Realized PnL for a position given a close price (fees handled separately). */
export function grossPnl(side: PositionSide, qty: number, entryPrice: number, closePrice: number): number {
  const dir = side === 'LONG' ? 1 : -1
  return (closePrice - entryPrice) * qty * dir
}
