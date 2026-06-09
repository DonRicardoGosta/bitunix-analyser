import { useQuery } from '@tanstack/react-query'
import { getTradingPairs } from '../../lib/bitunix/rest'
import { parseSpec, type SymbolSpec } from './setup/order'

/** Fetches per-symbol trading specs (precision, min size, leverage range). */
export function useSymbolSpecs(symbol: string): {
  spec: SymbolSpec
  isLoading: boolean
  error: unknown
} {
  const query = useQuery({
    queryKey: ['tradingPair', symbol],
    queryFn: async () => {
      const list = await getTradingPairs(symbol)
      return list.find((p) => p.symbol === symbol) ?? list[0]
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })

  return {
    spec: parseSpec(query.data, symbol),
    isLoading: query.isLoading,
    error: query.error,
  }
}
