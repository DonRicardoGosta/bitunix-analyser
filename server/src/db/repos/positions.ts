import type { PositionSide, RiskLevel } from '@shared/challenge/types'
import type { StoredPosition } from '../types'
import { getDb } from '../index'

interface PositionRow {
  id: string
  challenge_id: string
  symbol: string
  side: string
  qty: number
  entry_price: number
  leverage: number
  margin: number
  risk_level: number
  strategy_id: string
  exchange_position_id: string | null
  status: string
  close_price: number | null
  realized_pnl: number | null
  fee: number
  params_snapshot: string | null
  opened_at: number
  closed_at: number | null
}

function rowToPosition(row: PositionRow): StoredPosition {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    symbol: row.symbol,
    side: row.side as PositionSide,
    qty: row.qty,
    entryPrice: row.entry_price,
    leverage: row.leverage,
    margin: row.margin,
    riskLevel: row.risk_level as RiskLevel,
    strategyId: row.strategy_id,
    exchangePositionId: row.exchange_position_id ?? undefined,
    status: row.status as 'open' | 'closed',
    closePrice: row.close_price ?? undefined,
    realizedPnl: row.realized_pnl ?? undefined,
    fee: row.fee,
    paramsSnapshot: row.params_snapshot
      ? (JSON.parse(row.params_snapshot) as Record<string, unknown>)
      : undefined,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  }
}

export const positionsRepo = {
  insert(p: StoredPosition): void {
    getDb()
      .prepare(
        `INSERT INTO positions
           (id, challenge_id, symbol, side, qty, entry_price, leverage, margin, risk_level,
            strategy_id, exchange_position_id, status, close_price, realized_pnl, fee,
            params_snapshot, opened_at, closed_at)
         VALUES (@id, @challenge_id, @symbol, @side, @qty, @entry_price, @leverage, @margin,
                 @risk_level, @strategy_id, @exchange_position_id, @status, @close_price,
                 @realized_pnl, @fee, @params_snapshot, @opened_at, @closed_at)`,
      )
      .run({
        id: p.id,
        challenge_id: p.challengeId,
        symbol: p.symbol,
        side: p.side,
        qty: p.qty,
        entry_price: p.entryPrice,
        leverage: p.leverage,
        margin: p.margin,
        risk_level: p.riskLevel,
        strategy_id: p.strategyId,
        exchange_position_id: p.exchangePositionId ?? null,
        status: p.status,
        close_price: p.closePrice ?? null,
        realized_pnl: p.realizedPnl ?? null,
        fee: p.fee,
        params_snapshot: p.paramsSnapshot ? JSON.stringify(p.paramsSnapshot) : null,
        opened_at: p.openedAt,
        closed_at: p.closedAt ?? null,
      })
  },

  close(
    id: string,
    fields: { closePrice: number; realizedPnl: number; fee?: number; closedAt?: number },
  ): void {
    getDb()
      .prepare(
        `UPDATE positions
           SET status = 'closed', close_price = @close_price, realized_pnl = @realized_pnl,
               fee = fee + @fee, closed_at = @closed_at
         WHERE id = @id`,
      )
      .run({
        id,
        close_price: fields.closePrice,
        realized_pnl: fields.realizedPnl,
        fee: fields.fee ?? 0,
        closed_at: fields.closedAt ?? Date.now(),
      })
  },

  setExchangeId(id: string, exchangePositionId: string): void {
    getDb()
      .prepare('UPDATE positions SET exchange_position_id = ? WHERE id = ?')
      .run(exchangePositionId, id)
  },

  get(id: string): StoredPosition | undefined {
    const row = getDb().prepare('SELECT * FROM positions WHERE id = ?').get(id) as
      | PositionRow
      | undefined
    return row ? rowToPosition(row) : undefined
  },

  listOpenByChallenge(challengeId: string): StoredPosition[] {
    const rows = getDb()
      .prepare("SELECT * FROM positions WHERE challenge_id = ? AND status = 'open' ORDER BY opened_at")
      .all(challengeId) as PositionRow[]
    return rows.map(rowToPosition)
  },

  listByChallenge(challengeId: string): StoredPosition[] {
    const rows = getDb()
      .prepare('SELECT * FROM positions WHERE challenge_id = ? ORDER BY opened_at')
      .all(challengeId) as PositionRow[]
    return rows.map(rowToPosition)
  },

  listAllOpen(): StoredPosition[] {
    const rows = getDb()
      .prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at")
      .all() as PositionRow[]
    return rows.map(rowToPosition)
  },
}
