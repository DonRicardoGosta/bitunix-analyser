import { useQuery } from '@tanstack/react-query'
import {
  getGlobalLongShort,
  getKlineCloses,
  getOpenInterestHist,
  getTakerVolume,
  getTopTraderLongShort,
} from '../../lib/binance/rest'
import type { BinancePeriod } from '../../lib/binance/types'

export function useOpenInterest(symbol: string, period: BinancePeriod) {
  return useQuery({
    queryKey: ['oi', symbol, period],
    queryFn: () => getOpenInterestHist(symbol, period, 200),
    refetchInterval: 60_000,
    retry: 0,
  })
}

export function useLongShort(symbol: string, period: BinancePeriod) {
  return useQuery({
    queryKey: ['longshort', symbol, period],
    queryFn: async () => {
      const [global, top] = await Promise.all([
        getGlobalLongShort(symbol, period, 200),
        getTopTraderLongShort(symbol, period, 200),
      ])
      return { global, top }
    },
    refetchInterval: 60_000,
    retry: 0,
  })
}

export function useTakerFlow(symbol: string, period: BinancePeriod) {
  return useQuery({
    queryKey: ['taker', symbol, period],
    queryFn: () => getTakerVolume(symbol, period, 200),
    refetchInterval: 60_000,
    retry: 0,
  })
}

export function usePriceSeries(symbol: string, period: BinancePeriod) {
  return useQuery({
    queryKey: ['binancePrice', symbol, period],
    queryFn: () => getKlineCloses(symbol, period, 200),
    refetchInterval: 60_000,
    retry: 0,
  })
}
