import {
  getHistoryOrders,
  getPendingOrders,
  getPendingPositions,
  placeOrder,
} from '../../../lib/bitunix/rest'
import type { PendingPositionRaw, PlaceOrderParams } from '../../../lib/bitunix/types'
import { toNum } from '../../../lib/format'
import { floorToPrecision } from './order'

const STORAGE_KEY = 'bitunix-builder-shed-jobs'
const POLL_MS = 4_000

export type BuilderShedJobStatus = 'pending' | 'shedding' | 'done' | 'failed'

export interface BuilderShedJob {
  id: string
  orderId: string
  clientId?: string
  symbol: string
  /** Position side being built (LONG or SHORT). */
  side: 'LONG' | 'SHORT'
  shedQty: number
  basePrecision: number
  rungIndex: number
  status: BuilderShedJobStatus
  createdAt: number
  error?: string
}

export type BuilderShedJobInput = Omit<BuilderShedJob, 'id' | 'status' | 'createdAt'>

function readJobs(): BuilderShedJob[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BuilderShedJob[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJobs(jobs: BuilderShedJob[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

export function getBuilderShedJobs(): BuilderShedJob[] {
  return readJobs()
}

export function getActiveBuilderShedJobs(symbol?: string): BuilderShedJob[] {
  return readJobs().filter(
    (j) =>
      (j.status === 'pending' || j.status === 'shedding') && (symbol === undefined || j.symbol === symbol),
  )
}

export function clearBuilderShedForSymbol(symbol: string): void {
  writeJobs(readJobs().filter((j) => j.symbol !== symbol || j.status === 'done'))
}

/** Drop finished (done/failed) shed jobs, optionally only for one symbol. */
export function clearFinishedBuilderShedJobs(symbol?: string): void {
  writeJobs(
    readJobs().filter((j) => {
      const finished = j.status === 'done' || j.status === 'failed'
      if (!finished) return true
      return symbol !== undefined && j.symbol !== symbol
    }),
  )
}

export function registerBuilderShedJobs(inputs: BuilderShedJobInput[]): void {
  if (!inputs.length) return
  const now = Date.now()
  const existing = readJobs()
  const next: BuilderShedJob[] = [
    ...existing,
    ...inputs.map((input, i) => ({
      ...input,
      id: `${input.orderId}-${now}-${i}`,
      status: 'pending' as const,
      createdAt: now,
    })),
  ]
  writeJobs(next)
}

function updateJob(id: string, patch: Partial<BuilderShedJob>): void {
  writeJobs(readJobs().map((j) => (j.id === id ? { ...j, ...patch } : j)))
}

function pruneOldJobs(): void {
  // Active jobs persist; finished ones are kept only briefly so stale notices
  // (e.g. "auto-shed failed on N rungs") don't linger across builds/sessions.
  const doneCutoff = Date.now() - 30 * 60 * 1000
  const failedCutoff = Date.now() - 30 * 60 * 1000
  writeJobs(
    readJobs().filter(
      (j) =>
        j.status === 'pending' ||
        j.status === 'shedding' ||
        (j.status === 'done' && j.createdAt > doneCutoff) ||
        (j.status === 'failed' && j.createdAt > failedCutoff),
    ),
  )
}

/** Force-prune finished jobs immediately (used on app load to clear stale state). */
export function pruneFinishedBuilderShedJobs(): void {
  pruneOldJobs()
}

function normalizePositionSide(side: PendingPositionRaw['side']): 'LONG' | 'SHORT' | null {
  if (side === 'LONG' || side === 'BUY') return 'LONG'
  if (side === 'SHORT' || side === 'SELL') return 'SHORT'
  return null
}

/** Hedge-mode close side: sell to close a long, buy to close a short. */
function closeOrderSide(buildSide: 'LONG' | 'SHORT'): PlaceOrderParams['side'] {
  return buildSide === 'LONG' ? 'SELL' : 'BUY'
}

async function orderIsFilled(job: BuilderShedJob): Promise<boolean> {
  const byId = await getHistoryOrders({ symbol: job.symbol, orderId: job.orderId, limit: 1 })
  const hist = byId.orderList?.[0]
  if (hist?.status === 'FILLED') return true
  if (hist && toNum(hist.tradeQty) >= toNum(hist.qty) && toNum(hist.qty) > 0) return true

  const pending = await getPendingOrders({ symbol: job.symbol, orderId: job.orderId, limit: 1 })
  const open = pending.orderList?.[0]
  if (!open) {
    // No longer pending — treat as filled if history shows any trade qty.
    return hist ? toNum(hist.tradeQty) > 0 : false
  }
  if (open.status === 'FILLED') return true
  return toNum(open.tradeQty) >= toNum(open.qty) && toNum(open.qty) > 0
}

async function findPosition(symbol: string, side: 'LONG' | 'SHORT'): Promise<PendingPositionRaw | null> {
  const list = await getPendingPositions(symbol)
  const matches = list.filter((p) => normalizePositionSide(p.side) === side && toNum(p.qty) > 0)
  if (!matches.length) return null
  // Prefer the largest open size (merged position) or most recently modified.
  return matches.sort((a, b) => toNum(b.qty) - toNum(a.qty) || (b.mtime ?? 0) - (a.mtime ?? 0))[0]
}

async function shedJob(job: BuilderShedJob): Promise<void> {
  updateJob(job.id, { status: 'shedding', error: undefined })
  const position = await findPosition(job.symbol, job.side)
  if (!position) {
    throw new Error(`No open ${job.side} position found for ${job.symbol} after fill`)
  }
  const posQty = toNum(position.qty)
  const shedQty = floorToPrecision(Math.min(job.shedQty, posQty), job.basePrecision)
  if (shedQty <= 0) {
    updateJob(job.id, { status: 'done' })
    return
  }

  const params: PlaceOrderParams = {
    symbol: job.symbol,
    side: closeOrderSide(job.side),
    tradeSide: 'CLOSE',
    positionId: position.positionId,
    orderType: 'MARKET',
    qty: String(shedQty),
  }
  await placeOrder(params)
  updateJob(job.id, { status: 'done' })
}

/** Poll tracked jobs and shed excess once each open limit fills. */
export async function processBuilderShedJobs(): Promise<{ shed: number; failed: number }> {
  pruneOldJobs()
  const jobs = getActiveBuilderShedJobs()
  let shed = 0
  let failed = 0

  for (const job of jobs) {
    try {
      const filled = await orderIsFilled(job)
      if (!filled) continue
      await shedJob(job)
      shed++
    } catch (e) {
      failed++
      updateJob(job.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { shed, failed }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

/** Start polling while active shed jobs exist; stops automatically when idle. */
export function ensureBuilderShedPolling(onTick?: () => void): () => void {
  if (onTick) listeners.add(onTick)

  const tick = async () => {
    if (pollInFlight || getActiveBuilderShedJobs().length === 0) {
      if (getActiveBuilderShedJobs().length === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }
    pollInFlight = true
    try {
      await processBuilderShedJobs()
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
