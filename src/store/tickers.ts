import { create } from 'zustand'
import { toNum } from '../lib/format'

export interface LiveTicker {
  symbol: string
  last: number
  open: number
  high: number
  low: number
  baseVol: number
  quoteVol: number
  changePct: number
  bestBid: number
  bestAsk: number
  ts: number
}

interface TickersState {
  map: Record<string, LiveTicker>
  connected: boolean
  setConnected: (v: boolean) => void
  upsertMany: (list: LiveTicker[]) => void
}

export const useTickers = create<TickersState>((set) => ({
  map: {},
  connected: false,
  setConnected: (v) => set({ connected: v }),
  upsertMany: (list) =>
    set((state) => {
      const map = { ...state.map }
      for (const t of list) map[t.symbol] = t
      return { map }
    }),
}))

/** Normalize a raw Bitunix tickers-stream item into a LiveTicker. */
export function parseStreamTicker(item: Record<string, unknown>, ts: number): LiveTicker | null {
  const symbol = item.s as string
  if (!symbol) return null
  return {
    symbol,
    last: toNum(item.la),
    open: toNum(item.o),
    high: toNum(item.h),
    low: toNum(item.l),
    baseVol: toNum(item.b),
    quoteVol: toNum(item.q),
    changePct: toNum(item.r),
    bestBid: toNum(item.bd),
    bestAsk: toNum(item.ak),
    ts,
  }
}
