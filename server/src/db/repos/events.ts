import type { ChallengeEvent, EventCategory, EventLevel } from '@shared/challenge/types'
import { getDb } from '../index'

interface EventRow {
  id: string
  challenge_id: string
  ts: number
  level: string
  category: string
  symbol: string | null
  message: string
  details: string | null
}

function rowToEvent(row: EventRow): ChallengeEvent {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    ts: row.ts,
    level: row.level as EventLevel,
    category: row.category as EventCategory,
    symbol: row.symbol ?? undefined,
    message: row.message,
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : undefined,
  }
}

export const eventsRepo = {
  insert(e: ChallengeEvent): void {
    getDb()
      .prepare(
        `INSERT INTO events (id, challenge_id, ts, level, category, symbol, message, details)
         VALUES (@id, @challenge_id, @ts, @level, @category, @symbol, @message, @details)`,
      )
      .run({
        id: e.id,
        challenge_id: e.challengeId,
        ts: e.ts,
        level: e.level,
        category: e.category,
        symbol: e.symbol ?? null,
        message: e.message,
        details: e.details ? JSON.stringify(e.details) : null,
      })
  },

  listByChallenge(challengeId: string, limit = 200): ChallengeEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM events WHERE challenge_id = ? ORDER BY ts DESC LIMIT ?')
      .all(challengeId, limit) as EventRow[]
    return rows.map(rowToEvent).reverse()
  },
}
