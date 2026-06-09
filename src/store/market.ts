import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { KlineInterval } from '../lib/bitunix/rest'

interface MarketState {
  symbol: string
  interval: KlineInterval
  priceType: 'LAST_PRICE' | 'MARK_PRICE'
  setSymbol: (s: string) => void
  setInterval: (i: KlineInterval) => void
  setPriceType: (t: 'LAST_PRICE' | 'MARK_PRICE') => void
}

export const useMarket = create<MarketState>()(
  persist(
    (set) => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      priceType: 'LAST_PRICE',
      setSymbol: (s) => set({ symbol: s.toUpperCase() }),
      setInterval: (i) => set({ interval: i }),
      setPriceType: (t) => set({ priceType: t }),
    }),
    { name: 'bitunix-market' },
  ),
)
