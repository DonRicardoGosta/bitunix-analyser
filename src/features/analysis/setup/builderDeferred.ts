import {
  changeLeverage,
  changeMarginMode,
  changePositionMode,
  placeOrder,
} from '../../../lib/bitunix/rest'
import type { MarginMode, PlaceOrderParams } from '../../../lib/bitunix/types'
import { useTickers } from '../../../store/tickers'
import { builderLimitCanRest } from './builderOrders'
import { ensureBuilderShedPolling, registerBuilderShedJobs } from './builderShed'
import { floorToPrecision, roundToPrecision } from './order'

const STORAGE_KEY = 'bitunix-builder-deferred-rungs'
const POLL_MS = 3_000

export type BuilderDeferredStatus = 'pending' | 'placing' | 'done' | 'failed'

export interface BuilderDeferredRung {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  rungPrice: number
  openQty: number
  shedQty: number
  usesTrick: boolean
  rungIndex: number
  tp: string
  sl: string
  leverage: number
  marginMode: MarginMode
  marginCoin: string
  basePrecision: number
  quotePrecision: number
  status: BuilderDeferredStatus
  createdAt: number
  orderId?: string
  error?: string
}

export type BuilderDeferredInput = Omit<BuilderDeferredRung, 'id' | 'status' | 'createdAt'>

function readJobs(): BuilderDeferredRung[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BuilderDeferredRung[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJobs(jobs: BuilderDeferredRung[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

export function getBuilderDeferredRungs(): BuilderDeferredRung[] {
  return readJobs()
}

export function getActiveBuilderDeferredRungs(): BuilderDeferredRung[] {
  return readJobs().filter((j) => j.status === 'pending' || j.status === 'placing')
}

export function registerBuilderDeferredRungs(inputs: BuilderDeferredInput[]): void {
  if (!inputs.length) return
  const now = Date.now()
  const existing = readJobs()
  const next: BuilderDeferredRung[] = [
    ...existing,
    ...inputs.map((input, i) => ({
      ...input,
      id: `deferred-${input.symbol}-${input.rungIndex}-${now}-${i}`,
      status: 'pending' as const,
      createdAt: now,
    })),
  ]
  writeJobs(next)
}

function updateJob(id: string, patch: Partial<BuilderDeferredRung>): void {
  writeJobs(readJobs().map((j) => (j.id === id ? { ...j, ...patch } : j)))
}

function pruneOldJobs(): void {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  writeJobs(
    readJobs().filter((j) => j.status === 'pending' || j.status === 'placing' || j.createdAt > cutoff),
  )
}

async function placeDeferredRung(job: BuilderDeferredRung, hedge: boolean): Promise<string | undefined> {
  const isLong = job.side === 'LONG'
  const clientId = `builder-def-${job.symbol}-${job.rungIndex}-${Date.now()}`
  const openParams: PlaceOrderParams = {
    symbol: job.symbol,
    side: isLong ? 'BUY' : 'SELL',
    orderType: 'LIMIT',
    effect: 'POST_ONLY',
    price: String(roundToPrecision(job.rungPrice, job.quotePrecision)),
    qty: String(floorToPrecision(job.openQty, job.basePrecision)),
    clientId,
    tpPrice: job.tp,
    tpStopType: 'LAST_PRICE',
    tpOrderType: 'MARKET',
    slPrice: job.sl,
    slStopType: 'LAST_PRICE',
    slOrderType: 'MARKET',
  }
  if (hedge) openParams.tradeSide = 'OPEN'
  const res = await placeOrder(openParams)
  return res?.orderId
}

/** Place momentum rungs once price has moved enough for the limit to rest passively. */
export async function processBuilderDeferredRungs(
  prices: Record<string, number>,
): Promise<{ placed: number; failed: number }> {
  pruneOldJobs()
  const jobs = getActiveBuilderDeferredRungs()
  let placed = 0
  let failed = 0

  if (!jobs.length) return { placed, failed }

  let hedge = true
  try {
    await changePositionMode('HEDGE')
  } catch {
    hedge = true
  }

  for (const job of jobs) {
    const market = prices[job.symbol]
    if (!market || market <= 0) continue
    if (!builderLimitCanRest(job.side, job.rungPrice, market)) continue

    updateJob(job.id, { status: 'placing', error: undefined })
    try {
      try {
        await changeMarginMode(job.symbol, job.marginMode, job.marginCoin)
      } catch {
        // ignore if positions/orders block the change
      }
      await changeLeverage(job.symbol, job.leverage, job.marginCoin)
      const orderId = await placeDeferredRung(job, hedge)
      updateJob(job.id, { status: 'done', orderId })
      placed++

      if (job.usesTrick && job.shedQty > 0 && orderId) {
        registerBuilderShedJobs([
          {
            orderId,
            clientId: `builder-def-${job.symbol}-${job.rungIndex}`,
            symbol: job.symbol,
            side: job.side,
            shedQty: floorToPrecision(job.shedQty, job.basePrecision),
            basePrecision: job.basePrecision,
            rungIndex: job.rungIndex,
          },
        ])
      }
    } catch (e) {
      failed++
      updateJob(job.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (placed > 0) ensureBuilderShedPolling()

  return { placed, failed }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

export function ensureBuilderDeferredPolling(onTick?: () => void): () => void {
  if (onTick) listeners.add(onTick)

  const tick = async () => {
    if (pollInFlight) return
    const active = getActiveBuilderDeferredRungs()
    if (active.length === 0) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }

    pollInFlight = true
    try {
      const prices: Record<string, number> = {}
      const map = useTickers.getState().map
      for (const job of active) {
        const last = map[job.symbol]?.last
        if (last && last > 0) prices[job.symbol] = last
      }
      await processBuilderDeferredRungs(prices)
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
