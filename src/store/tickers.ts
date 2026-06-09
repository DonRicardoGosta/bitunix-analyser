import { create } from 'zustand'
import { toNum } from '../lib/format'
import type { TickerRaw } from '../lib/bitunix/types'

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

/** Normalize a Bitunix REST ticker row into a LiveTicker. */
export function parseRestTicker(t: TickerRaw, ts: number): LiveTicker | null {
  if (!t.symbol) return null
  const last = toNum(t.lastPrice)
  const open = toNum(t.open)
  const changePct = open > 0 ? ((last - open) / open) * 100 : 0
  return {
    symbol: t.symbol,
    last,
    open,
    high: toNum(t.high),
    low: toNum(t.low),
    baseVol: toNum(t.baseVol),
    quoteVol: toNum(t.quoteVol),
    changePct,
    bestBid: last,
    bestAsk: last,
    ts,
  }
}
