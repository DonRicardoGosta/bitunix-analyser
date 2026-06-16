import { getPendingPositions, placePositionTpsl } from '../../../lib/bitunix/rest'
import type { PendingPositionRaw } from '../../../lib/bitunix/types'
import { toNum } from '../../../lib/format'

// Applies the Position Builder's shared TP/SL to the position that appears once
// momentum trigger orders fire. Native trigger (stop-limit) orders carry no
// TP/SL of their own, so we attach a position-wide TP/SL as soon as a builder
// position exists for the symbol/side.

const STORAGE_KEY = 'bitunix-builder-tpsl-jobs'
const POLL_MS = 4_000

export type BuilderTpslStatus = 'pending' | 'applying' | 'done' | 'failed'

export interface BuilderTpslJob {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  tp: string
  sl: string
  status: BuilderTpslStatus
  createdAt: number
  error?: string
}

export type BuilderTpslInput = Omit<BuilderTpslJob, 'id' | 'status' | 'createdAt'>

function readJobs(): BuilderTpslJob[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BuilderTpslJob[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJobs(jobs: BuilderTpslJob[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

export function getBuilderTpslJobs(): BuilderTpslJob[] {
  return readJobs()
}

export function getActiveBuilderTpslJobs(symbol?: string): BuilderTpslJob[] {
  return readJobs().filter(
    (j) =>
      (j.status === 'pending' || j.status === 'applying') && (symbol === undefined || j.symbol === symbol),
  )
}

/** Replace any pending TP/SL job for this symbol+side (latest build wins). */
export function registerBuilderTpslJob(input: BuilderTpslInput): void {
  const now = Date.now()
  const keep = readJobs().filter(
    (j) =>
      !(j.symbol === input.symbol && j.side === input.side && (j.status === 'pending' || j.status === 'applying')),
  )
  writeJobs([
    ...keep,
    { ...input, id: `tpsl-${input.symbol}-${input.side}-${now}`, status: 'pending', createdAt: now },
  ])
}

function updateJob(id: string, patch: Partial<BuilderTpslJob>): void {
  writeJobs(readJobs().map((j) => (j.id === id ? { ...j, ...patch } : j)))
}

function pruneOldJobs(): void {
  const cutoff = Date.now() - 30 * 60 * 1000
  writeJobs(
    readJobs().filter(
      (j) =>
        j.status === 'pending' ||
        j.status === 'applying' ||
        (j.status === 'done' && j.createdAt > cutoff) ||
        (j.status === 'failed' && j.createdAt > cutoff),
    ),
  )
}

export function clearFinishedBuilderTpslJobs(symbol?: string): void {
  writeJobs(
    readJobs().filter((j) => {
      const finished = j.status === 'done' || j.status === 'failed'
      if (!finished) return true
      return symbol !== undefined && j.symbol !== symbol
    }),
  )
}

export function pruneFinishedBuilderTpslJobs(): void {
  pruneOldJobs()
}

function normalizePositionSide(side: PendingPositionRaw['side']): 'LONG' | 'SHORT' | null {
  if (side === 'LONG' || side === 'BUY') return 'LONG'
  if (side === 'SHORT' || side === 'SELL') return 'SHORT'
  return null
}

async function findPosition(symbol: string, side: 'LONG' | 'SHORT'): Promise<PendingPositionRaw | null> {
  const list = await getPendingPositions(symbol)
  const matches = list.filter((p) => normalizePositionSide(p.side) === side && toNum(p.qty) > 0)
  if (!matches.length) return null
  return matches.sort((a, b) => toNum(b.qty) - toNum(a.qty) || (b.mtime ?? 0) - (a.mtime ?? 0))[0]
}

/** Apply the shared position TP/SL once a builder position exists. */
export async function processBuilderTpslJobs(): Promise<{ applied: number; failed: number }> {
  pruneOldJobs()
  const jobs = getActiveBuilderTpslJobs()
  let applied = 0
  let failed = 0

  for (const job of jobs) {
    try {
      const position = await findPosition(job.symbol, job.side)
      if (!position) continue // no fill yet — keep waiting
      updateJob(job.id, { status: 'applying', error: undefined })
      await placePositionTpsl({
        symbol: job.symbol,
        positionId: position.positionId,
        tpPrice: job.tp,
        tpStopType: 'LAST_PRICE',
        slPrice: job.sl,
        slStopType: 'LAST_PRICE',
      })
      updateJob(job.id, { status: 'done' })
      applied++
    } catch (e) {
      failed++
      updateJob(job.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { applied, failed }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

export function ensureBuilderTpslPolling(onTick?: () => void): () => void {
  if (onTick) listeners.add(onTick)

  const tick = async () => {
    if (pollInFlight) return
    if (getActiveBuilderTpslJobs().length === 0) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }
    pollInFlight = true
    try {
      await processBuilderTpslJobs()
      notifyListeners()
    } finally {
      pollInFlight = false
    }
  }

  if (!pollTimer) {
    void tick()
    pollTimer = setInterval(tick, POLL_MS)
  }

  return () => {
    listeners.delete(onTick ?? (() => {}))
  }
}
