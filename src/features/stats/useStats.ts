import { useQuery } from '@tanstack/react-query'
import {
  getAccount,
  getHistoryPositions,
  getHistoryTrades,
  getPendingPositions,
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

export function useHistoryPositions(days: number) {
  const hasKeys = useCredentials((s) => s.hasKeys())
  return useQuery({
    queryKey: ['historyPositions', days],
    queryFn: () => {
      const end = Date.now()
      const start = end - days * 86_400_000
      return fetchAllPositions(start, end)
    },
    enabled: hasKeys,
    staleTime: 60_000,
  })
}

export function useHistoryTrades(days: number) {
  const hasKeys = useCredentials((s) => s.hasKeys())
  return useQuery({
    queryKey: ['historyTrades', days],
    queryFn: () => {
      const end = Date.now()
      const start = end - days * 86_400_000
      return fetchAllTrades(start, end)
    },
    enabled: hasKeys,
    staleTime: 60_000,
  })
}
