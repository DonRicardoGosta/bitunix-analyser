import {
  changeLeverage,
  changeMarginMode,
  changePositionMode,
  placeOrder,
} from '../../../lib/bitunix/rest'
import type { MarginMode, PlaceOrderParams } from '../../../lib/bitunix/types'
import { fetchLivePrice } from './builderMarket'
import { ensureBuilderShedPolling, registerBuilderShedJobs } from './builderShed'
import { floorToPrecision } from './order'

const STORAGE_KEY = 'bitunix-builder-trigger-jobs'
const POLL_MS = 2_000

export type BuilderTriggerStatus = 'pending' | 'firing' | 'done' | 'failed'

export interface BuilderTriggerJob {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  /** Price level that arms the entry (buy when price rises to this for LONG, etc.). */
  triggerPrice: number
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
  status: BuilderTriggerStatus
  createdAt: number
  orderId?: string
  error?: string
}

export type BuilderTriggerInput = Omit<BuilderTriggerJob, 'id' | 'status' | 'createdAt'>

function readJobs(): BuilderTriggerJob[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BuilderTriggerJob[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJobs(jobs: BuilderTriggerJob[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

export function getBuilderTriggerJobs(): BuilderTriggerJob[] {
  return readJobs()
}

export function getActiveBuilderTriggerJobs(symbol?: string): BuilderTriggerJob[] {
  return readJobs().filter(
    (j) =>
      (j.status === 'pending' || j.status === 'firing') && (symbol === undefined || j.symbol === symbol),
  )
}

/** True when the trigger condition is satisfied at the current market price. */
export function builderTriggerHit(side: 'LONG' | 'SHORT', triggerPrice: number, marketPrice: number): boolean {
  if (!Number.isFinite(triggerPrice) || !Number.isFinite(marketPrice) || marketPrice <= 0) return false
  return side === 'LONG' ? marketPrice >= triggerPrice : marketPrice <= triggerPrice
}

/** Replace pending trigger jobs for this symbol (avoids stacking duplicate queues). */
export function registerBuilderTriggerJobs(symbol: string, inputs: BuilderTriggerInput[]): void {
  if (!inputs.length) return
  const now = Date.now()
  const keep = readJobs().filter(
    (j) => j.symbol !== symbol || (j.status !== 'pending' && j.status !== 'firing'),
  )
  writeJobs([
    ...keep,
    ...inputs.map((input, i) => ({
      ...input,
      id: `trigger-${input.symbol}-${input.rungIndex}-${now}-${i}`,
      status: 'pending' as const,
      createdAt: now,
    })),
  ])
}

function updateJob(id: string, patch: Partial<BuilderTriggerJob>): void {
  writeJobs(readJobs().map((j) => (j.id === id ? { ...j, ...patch } : j)))
}

function pruneOldJobs(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  writeJobs(
    readJobs().filter(
      (j) =>
        j.status === 'pending' ||
        j.status === 'firing' ||
        (j.status === 'done' && j.createdAt > cutoff) ||
        (j.status === 'failed' && j.createdAt > cutoff),
    ),
  )
}

async function fireTriggerJob(job: BuilderTriggerJob, hedge: boolean): Promise<string | undefined> {
  const isLong = job.side === 'LONG'
  const clientId = `builder-trg-${job.symbol}-${job.rungIndex}-${Date.now()}`
  const params: PlaceOrderParams = {
    symbol: job.symbol,
    side: isLong ? 'BUY' : 'SELL',
    orderType: 'MARKET',
    qty: String(floorToPrecision(job.openQty, job.basePrecision)),
    clientId,
    tpPrice: job.tp,
    tpStopType: 'LAST_PRICE',
    tpOrderType: 'MARKET',
    slPrice: job.sl,
    slStopType: 'LAST_PRICE',
    slOrderType: 'MARKET',
  }
  if (hedge) params.tradeSide = 'OPEN'
  const res = await placeOrder(params)
  return res?.orderId
}

async function resolvePrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  await Promise.all(
    symbols.map(async (sym) => {
      const last = await fetchLivePrice(sym)
      if (last > 0) prices[sym] = last
    }),
  )
  return prices
}

/** Fire momentum trigger jobs when price reaches each rung level. */
export async function processBuilderTriggerJobs(
  prices?: Record<string, number>,
): Promise<{ fired: number; failed: number; orderIds: string[] }> {
  pruneOldJobs()
  const jobs = getActiveBuilderTriggerJobs()
  let fired = 0
  let failed = 0
  const orderIds: string[] = []
  if (!jobs.length) return { fired, failed, orderIds }

  const symbols = [...new Set(jobs.map((j) => j.symbol))]
  const marketPrices = { ...(prices ?? {}), ...(await resolvePrices(symbols)) }

  let hedge = true
  try {
    await changePositionMode('HEDGE')
  } catch {
    hedge = true
  }

  for (const job of jobs) {
    const market = marketPrices[job.symbol]
    if (!market || market <= 0) continue
    if (!builderTriggerHit(job.side, job.triggerPrice, market)) continue

    updateJob(job.id, { status: 'firing', error: undefined })
    try {
      try {
        await changeMarginMode(job.symbol, job.marginMode, job.marginCoin)
      } catch {
        // ignore
      }
      await changeLeverage(job.symbol, job.leverage, job.marginCoin)
      const orderId = await fireTriggerJob(job, hedge)
      if (!orderId) throw new Error('Exchange returned no order id')
      updateJob(job.id, { status: 'done', orderId })
      fired++
      orderIds.push(orderId)

      if (job.usesTrick && job.shedQty > 0) {
        registerBuilderShedJobs([
          {
            orderId,
            clientId: `builder-trg-${job.symbol}-${job.rungIndex}`,
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

  if (fired > 0) ensureBuilderShedPolling()
  return { fired, failed, orderIds }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

export function ensureBuilderTriggerPolling(onTick?: () => void): () => void {
  if (onTick) listeners.add(onTick)

  const tick = async () => {
    if (pollInFlight) return
    const active = getActiveBuilderTriggerJobs()
    if (active.length === 0) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }

    pollInFlight = true
    try {
      await processBuilderTriggerJobs()
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
