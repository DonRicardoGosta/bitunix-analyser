import { create } from 'zustand'
import type { LiquidationEvent } from '../lib/binance/types'

export interface DepthSnapshot {
  time: number
  /** [price, cumulative-from-mid] not stored; we store raw aggregated levels. */
  bids: [number, number][]
  asks: [number, number][]
  mid: number
}

export interface TradePrint {
  time: number
  price: number
  qty: number
  /** true = aggressive buy (taker buy). */
  buy: boolean
}

export interface CvdPoint {
  time: number
  cvd: number
}

const MAX_LIQUIDATIONS = 3000
const MAX_DEPTH_SNAPSHOTS = 240
const MAX_TRADES = 200
const MAX_CVD = 1200

interface AnalysisLiveState {
  symbol: string
  liquidations: LiquidationEvent[]
  depthHistory: DepthSnapshot[]
  trades: TradePrint[]
  cvd: number
  cvdHistory: CvdPoint[]
  buyVol: number
  sellVol: number
  /** Reset all accumulated data when switching symbol. */
  ensureSymbol: (symbol: string) => void
  addLiquidation: (e: LiquidationEvent) => void
  addDepthSnapshot: (s: DepthSnapshot) => void
  addTrade: (t: TradePrint) => void
}

export const useAnalysisLive = create<AnalysisLiveState>((set, get) => ({
  symbol: '',
  liquidations: [],
  depthHistory: [],
  trades: [],
  cvd: 0,
  cvdHistory: [],
  buyVol: 0,
  sellVol: 0,
  ensureSymbol: (symbol) => {
    if (get().symbol === symbol) return
    set({
      symbol,
      liquidations: [],
      depthHistory: [],
      trades: [],
      cvd: 0,
      cvdHistory: [],
      buyVol: 0,
      sellVol: 0,
    })
  },
  addLiquidation: (e) =>
    set((state) => {
      const liquidations = [...state.liquidations, e]
      if (liquidations.length > MAX_LIQUIDATIONS) liquidations.splice(0, liquidations.length - MAX_LIQUIDATIONS)
      return { liquidations }
    }),
  addDepthSnapshot: (s) =>
    set((state) => {
      const depthHistory = [...state.depthHistory, s]
      if (depthHistory.length > MAX_DEPTH_SNAPSHOTS)
        depthHistory.splice(0, depthHistory.length - MAX_DEPTH_SNAPSHOTS)
      return { depthHistory }
    }),
  addTrade: (t) =>
    set((state) => {
      const trades = [t, ...state.trades]
      if (trades.length > MAX_TRADES) trades.length = MAX_TRADES
      const cvd = state.cvd + (t.buy ? t.qty : -t.qty)
      const cvdHistory = [...state.cvdHistory, { time: t.time, cvd }]
      if (cvdHistory.length > MAX_CVD) cvdHistory.splice(0, cvdHistory.length - MAX_CVD)
      return {
        trades,
        cvd,
        cvdHistory,
        buyVol: state.buyVol + (t.buy ? t.qty : 0),
        sellVol: state.sellVol + (t.buy ? 0 : t.qty),
      }
    }),
}))
