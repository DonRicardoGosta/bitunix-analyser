import type { ChallengeConfig, ChallengeRun, RunStatus } from '@shared/challenge/types'
import { getDb } from '../index'

interface ChallengeRow {
  id: string
  name: string
  mode: string
  status: string
  config: string
  start_balance: number
  realized_pnl: number
  peak_equity: number
  close_reason: string | null
  created_at: number
  started_at: number
  ended_at: number | null
}

function rowToRun(row: ChallengeRow): ChallengeRun {
  const config = JSON.parse(row.config) as ChallengeConfig
  const realizedPnl = row.realized_pnl
  return {
    id: row.id,
    config,
    status: row.status as RunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    startBalance: row.start_balance,
    realizedPnl,
    // Runtime fields (overridden by the live manager for running challenges).
    unrealizedPnl: 0,
    equity: row.start_balance + realizedPnl,
    peakEquity: row.peak_equity,
    resultPnl: realizedPnl,
    closeReason: row.close_reason ?? undefined,
  }
}

export const challengesRepo = {
  insert(run: ChallengeRun): void {
    getDb()
      .prepare(
        `INSERT INTO challenges
           (id, name, mode, status, config, start_balance, realized_pnl, peak_equity,
            close_reason, created_at, started_at, ended_at)
         VALUES (@id, @name, @mode, @status, @config, @start_balance, @realized_pnl, @peak_equity,
                 @close_reason, @created_at, @started_at, @ended_at)`,
      )
      .run({
        id: run.id,
        name: run.config.name,
        mode: run.config.mode,
        status: run.status,
        config: JSON.stringify(run.config),
        start_balance: run.startBalance,
        realized_pnl: run.realizedPnl,
        peak_equity: run.peakEquity,
        close_reason: run.closeReason ?? null,
        created_at: run.config.createdAt,
        started_at: run.startedAt,
        ended_at: run.endedAt ?? null,
      })
  },

  update(
    id: string,
    fields: Partial<{
      status: RunStatus
      realizedPnl: number
      peakEquity: number
      closeReason: string | null
      endedAt: number | null
      config: ChallengeConfig
    }>,
  ): void {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (fields.status !== undefined) {
      sets.push('status = @status')
      params.status = fields.status
    }
    if (fields.realizedPnl !== undefined) {
      sets.push('realized_pnl = @realized_pnl')
      params.realized_pnl = fields.realizedPnl
    }
    if (fields.peakEquity !== undefined) {
      sets.push('peak_equity = @peak_equity')
      params.peak_equity = fields.peakEquity
    }
    if (fields.closeReason !== undefined) {
      sets.push('close_reason = @close_reason')
      params.close_reason = fields.closeReason
    }
    if (fields.endedAt !== undefined) {
      sets.push('ended_at = @ended_at')
      params.ended_at = fields.endedAt
    }
    if (fields.config !== undefined) {
      sets.push('config = @config')
      params.config = JSON.stringify(fields.config)
    }
    if (sets.length === 0) return
    getDb()
      .prepare(`UPDATE challenges SET ${sets.join(', ')} WHERE id = @id`)
      .run(params)
  },

  get(id: string): ChallengeRun | undefined {
    const row = getDb().prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
      | ChallengeRow
      | undefined
    return row ? rowToRun(row) : undefined
  },

  list(): ChallengeRun[] {
    const rows = getDb()
      .prepare('SELECT * FROM challenges ORDER BY created_at DESC')
      .all() as ChallengeRow[]
    return rows.map(rowToRun)
  },

  listByStatus(status: RunStatus): ChallengeRun[] {
    const rows = getDb()
      .prepare('SELECT * FROM challenges WHERE status = ? ORDER BY created_at DESC')
      .all(status) as ChallengeRow[]
    return rows.map(rowToRun)
  },
}
