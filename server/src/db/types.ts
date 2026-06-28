import type { PositionSide, RiskLevel } from '@shared/challenge/types'

/** Persisted position record (source of truth for challenge <-> position mapping
 *  in both Live and Paper modes; full virtual state for Paper). */
export interface StoredPosition {
  id: string
  challengeId: string
  symbol: string
  side: PositionSide
  qty: number
  entryPrice: number
  leverage: number
  margin: number
  riskLevel: RiskLevel
  strategyId: string
  /** Exchange position id (Live mode), used for targeted close. */
  exchangePositionId?: string
  status: 'open' | 'closed'
  closePrice?: number
  realizedPnl?: number
  fee: number
  /** Strategy params captured at entry (so later risk changes don't apply). */
  paramsSnapshot?: Record<string, unknown>
  openedAt: number
  closedAt?: number
}
