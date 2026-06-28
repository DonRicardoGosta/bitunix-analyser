import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  ChallengeEvent,
  EventCategory,
  EventLevel,
} from '@shared/challenge/types'
import { eventsRepo } from '../db/repos/events'
import { logger } from '../logger'

// Event log service (item 8): persists every event to SQLite and broadcasts it
// on an in-process bus. The WS hub subscribes to `event` and forwards to
// connected frontends.

class EventBus extends EventEmitter {}

export const eventBus = new EventBus()
eventBus.setMaxListeners(0)

export interface EmitInput {
  level?: EventLevel
  category: EventCategory
  symbol?: string
  message: string
  details?: Record<string, unknown>
}

export function emitEvent(challengeId: string, input: EmitInput): ChallengeEvent {
  const event: ChallengeEvent = {
    id: randomUUID(),
    challengeId,
    ts: Date.now(),
    level: input.level ?? 'info',
    category: input.category,
    symbol: input.symbol,
    message: input.message,
    details: input.details,
  }
  try {
    eventsRepo.insert(event)
  } catch (err) {
    logger.error(`failed to persist event: ${String(err)}`)
  }
  eventBus.emit('event', event)
  return event
}

/** A category-aware logger bound to a single challenge. */
export interface ChallengeLogger {
  entry: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  exit: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  signal: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  risk: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  api: (symbol: string | undefined, message: string, details?: Record<string, unknown>) => void
  system: (message: string, details?: Record<string, unknown>) => void
  warn: (
    category: EventCategory,
    symbol: string | undefined,
    message: string,
    details?: Record<string, unknown>,
  ) => void
  error: (
    category: EventCategory,
    symbol: string | undefined,
    message: string,
    details?: Record<string, unknown>,
  ) => void
}

export function makeChallengeLogger(challengeId: string): ChallengeLogger {
  const at = (category: EventCategory, level: EventLevel) =>
    (symbol: string | undefined, message: string, details?: Record<string, unknown>) =>
      emitEvent(challengeId, { category, level, symbol, message, details })
  return {
    entry: at('entry', 'info'),
    exit: at('exit', 'info'),
    signal: at('signal', 'info'),
    risk: at('risk', 'info'),
    api: at('api', 'info'),
    system: (message, details) => emitEvent(challengeId, { category: 'system', message, details }),
    warn: (category, symbol, message, details) =>
      emitEvent(challengeId, { category, level: 'warn', symbol, message, details }),
    error: (category, symbol, message, details) =>
      emitEvent(challengeId, { category, level: 'error', symbol, message, details }),
  }
}
