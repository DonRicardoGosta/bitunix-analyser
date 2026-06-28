import type { FastifyInstance } from 'fastify'
import type {
  ChallengeRun,
  ChallengeSummary,
  MinMarginResult,
} from '@shared/challenge/types'
import { computeMinMargin } from '../challenge/capital'
import { ChallengeManagerError, challengeManager } from '../challenge/manager'
import { challengesRepo } from '../db/repos/challenges'
import { eventsRepo } from '../db/repos/events'
import { positionsRepo } from '../db/repos/positions'
import { allStrategies } from '../strategy'
import {
  challengeConfigInputSchema,
  credentialsSchema,
  minMarginQuerySchema,
  riskUpdateSchema,
} from './schemas'

// Build a summary for a non-running (terminal) challenge from persisted state.
function summaryFromDb(run: ChallengeRun): ChallengeSummary {
  const all = positionsRepo.listByChallenge(run.id)
  const realized = all
    .filter((p) => p.status === 'closed')
    .reduce((s, p) => s + (p.realizedPnl ?? 0), 0)
  const positions = all
    .filter((p) => p.status === 'open')
    .map((p) => ({
      id: p.id,
      challengeId: run.id,
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      entryPrice: p.entryPrice,
      leverage: p.leverage,
      margin: p.margin,
      markPrice: p.entryPrice,
      unrealizedPnl: 0,
      riskLevel: p.riskLevel,
      strategyId: p.strategyId,
      openedAt: p.openedAt,
    }))
  const equity = run.startBalance + realized
  return {
    run: { ...run, realizedPnl: realized, unrealizedPnl: 0, equity, resultPnl: realized },
    runtime: {
      realizedPnl: realized,
      unrealizedPnl: 0,
      equity,
      usedMargin: positions.reduce((s, p) => s + p.margin, 0),
      openPositions: positions.length,
    },
    positions,
  }
}

function getSummary(id: string): ChallengeSummary | undefined {
  const live = challengeManager.getSummary(id)
  if (live) return live
  const run = challengesRepo.get(id)
  return run ? summaryFromDb(run) : undefined
}

export function registerRoutes(app: FastifyInstance): void {
  // ---- Credentials ----

  app.get('/api/credentials/status', async () => ({
    hasCredentials: challengeManager.hasCredentials(),
  }))

  app.post('/api/credentials', async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid credentials', details: parsed.error.issues })
    }
    challengeManager.setCredentials(parsed.data)
    return { ok: true }
  })

  // ---- Account ----

  app.get('/api/account', async (_req, reply) => {
    if (!challengeManager.hasCredentials()) {
      return reply.code(400).send({ error: 'No Bitunix credentials set' })
    }
    try {
      return await challengeManager.getAccountBalance()
    } catch (err) {
      return reply.code(502).send({ error: `Account fetch failed: ${String(err)}` })
    }
  })

  // ---- Strategies (for the coin builder UI) ----

  app.get('/api/strategies', async () =>
    allStrategies().map((s) => ({
      id: s.id,
      symbols: s.symbols ?? [],
      interval: s.interval,
    })),
  )

  // ---- Validation helpers ----

  app.post('/api/challenges/validate', async (req, reply) => {
    const parsed = challengeConfigInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid config', details: parsed.error.issues })
    }
    try {
      return await challengeManager.validate(parsed.data)
    } catch (err) {
      return reply.code(502).send({ error: `Validation failed: ${String(err)}` })
    }
  })

  app.get('/api/min-margin', async (req, reply) => {
    const parsed = minMarginQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'symbol and leverage are required' })
    }
    try {
      const result: MinMarginResult = await computeMinMargin(parsed.data.symbol, parsed.data.leverage)
      return result
    } catch (err) {
      return reply.code(502).send({ error: `Min-margin failed: ${String(err)}` })
    }
  })

  // ---- Challenges ----

  // Live snapshots for currently running challenges (dashboard).
  app.get('/api/challenges', async () => challengeManager.getSummaries())

  // Full history (all runs, newest first).
  app.get('/api/history', async () => challengesRepo.list())

  app.post('/api/challenges', async (req, reply) => {
    const parsed = challengeConfigInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid config', details: parsed.error.issues })
    }
    try {
      const run = await challengeManager.create(parsed.data)
      return reply.code(201).send(run)
    } catch (err) {
      if (err instanceof ChallengeManagerError) {
        return reply.code(400).send({ error: err.message, details: err.errors })
      }
      return reply.code(502).send({ error: `Create failed: ${String(err)}` })
    }
  })

  app.get<{ Params: { id: string } }>('/api/challenges/:id', async (req, reply) => {
    const summary = getSummary(req.params.id)
    if (!summary) return reply.code(404).send({ error: 'Challenge not found' })
    return summary
  })

  app.post<{ Params: { id: string } }>('/api/challenges/:id/stop', async (req, reply) => {
    const stopped = await challengeManager.stop(req.params.id)
    if (!stopped) return reply.code(404).send({ error: 'Challenge not running' })
    return { ok: true }
  })

  app.patch<{ Params: { id: string } }>('/api/challenges/:id/risk', async (req, reply) => {
    const parsed = riskUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid risk update', details: parsed.error.issues })
    }
    const ok = challengeManager.setRiskLevel(req.params.id, parsed.data.symbol, parsed.data.riskLevel)
    if (!ok) return reply.code(404).send({ error: 'Challenge not running or coin not found' })
    return { ok: true }
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/challenges/:id/events',
    async (req) => {
      const limit = req.query.limit ? Number(req.query.limit) : 200
      return eventsRepo.listByChallenge(req.params.id, Number.isFinite(limit) ? limit : 200)
    },
  )

  app.get<{ Params: { id: string } }>('/api/challenges/:id/positions', async (req) =>
    positionsRepo.listByChallenge(req.params.id),
  )
}
