import { useQuery } from '@tanstack/react-query'
import {
  getAccount,
  getHistoryPositions,
  getHistoryTrades,
  getPendingPositions,
  getTpslPending,
} from '../../lib/bitunix/rest'
import { useCredentials } from '../../store/credentials'
import type { HistoryPositionRaw, HistoryTradeRaw } from '../../lib/bitunix/types'

const PAGE = 100
const MAX_PAGES = 30

async function fetchAllPositions(startTime: number, endTime: number): Promise<HistoryPositionRaw[]> {
  const all: HistoryPositionRaw[] = []
  let skip = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await getHistoryPositions({ startTime, endTime, skip, limit: PAGE })
    const list = page?.positionList ?? []
    all.push(...list)
    if (list.length < PAGE) break
    skip += PAGE
  }
  return all
}

async function fetchAllTrades(startTime: number, endTime: number): Promise<HistoryTradeRaw[]> {
  const all: HistoryTradeRaw[] = []
  let skip = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await getHistoryTrades({ startTime, endTime, skip, limit: PAGE })
    const list = page?.tradeList ?? []
    all.push(...list)
    if (list.length < PAGE) break
    skip += PAGE
  }
  return all
}

export function useAccount() {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const marginCoin = useCredentials((s) => s.marginCoin)
  return useQuery({
    queryKey: ['account', marginCoin],
    queryFn: async () => {
      const data = await getAccount(marginCoin)
      return Array.isArray(data) ? data[0] : data
    },
    enabled: hasKeys,
    refetchInterval: 15_000,
  })
}

export function usePendingPositions() {
  const hasKeys = useCredentials((s) => s.hasKeys())
  return useQuery({
    queryKey: ['pendingPositions'],
    queryFn: () => getPendingPositions(),
    enabled: hasKeys,
    refetchInterval: 10_000,
  })
}

export function usePositionTpsl() {
  const hasKeys = useCredentials((s) => s.hasKeys())
  return useQuery({
    queryKey: ['positionTpsl'],
    queryFn: () => getTpslPending(),
    enabled: hasKeys,
    refetchInterval: 10_000,
  })
}

/** A time window: either a rolling lookback, or an explicit from/to (to omitted = now). */
export interface RangeParams {
  lookbackMs?: number
  from?: number
  to?: number
}

function resolveRange(r: RangeParams): { start: number; end: number } {
  const end = r.to ?? Date.now()
  const start = r.from ?? end - (r.lookbackMs ?? 30 * 86_400_000)
  return { start, end }
}

export function useHistoryPositions(range: RangeParams) {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = range.to === undefined
  return useQuery({
    queryKey: ['historyPositions', range.lookbackMs ?? null, range.from ?? null, range.to ?? null],
    queryFn: () => {
      const { start, end } = resolveRange(range)
      return fetchAllPositions(start, end)
    },
    enabled: hasKeys,
    staleTime: 60_000,
    refetchInterval: live ? 60_000 : false,
  })
}

export function useHistoryTrades(range: RangeParams) {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = range.to === undefined
  return useQuery({
    queryKey: ['historyTrades', range.lookbackMs ?? null, range.from ?? null, range.to ?? null],
    queryFn: () => {
      const { start, end } = resolveRange(range)
      return fetchAllTrades(start, end)
    },
    enabled: hasKeys,
    staleTime: 60_000,
    refetchInterval: live ? 60_000 : false,
  })
}
