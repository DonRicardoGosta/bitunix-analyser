import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDepth } from '../../lib/binance/rest'
import { compressForHistory, parseDepth, type ParsedBook } from './orderbook'
import { useAnalysisLive } from '../../store/analysisLive'

export function useOrderBook(symbol: string): {
  book: ParsedBook | null
  isLoading: boolean
  error: unknown
  updatedAt: number
} {
  const addDepthSnapshot = useAnalysisLive((s) => s.addDepthSnapshot)

  const query = useQuery({
    queryKey: ['binanceDepth', symbol],
    queryFn: async () => parseDepth(await getDepth(symbol, 1000)),
    refetchInterval: 2500,
    staleTime: 2000,
    retry: 0,
  })

  useEffect(() => {
    if (!query.data) return
    const c = compressForHistory(query.data, 150)
    addDepthSnapshot({ time: Date.now(), bids: c.bids, asks: c.asks, mid: c.mid })
  }, [query.data, addDepthSnapshot])

  return {
    book: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    updatedAt: query.dataUpdatedAt,
  }
}
