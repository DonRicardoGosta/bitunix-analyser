import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toDatetimeLocal } from '../lib/format'
import type { KlineInterval } from '../lib/bitunix/rest'

const DAY = 86_400_000

export type StatsMode = 'preset' | 'custom'
export type OrderType = 'LIMIT' | 'MARKET'
export type MarginMode = 'CROSS' | 'ISOLATION'
export type TpMode = 'TP1' | 'TP2' | 'BOTH'
/**
 * 'single' = one-sided LONG/SHORT, 'both' = range straddle (both directions),
 * 'builder' = laddered scale-in (Position Builder).
 */
export type TradeMode = 'single' | 'both' | 'builder'
/** 'margin' = size by USDT collateral, 'qty' = size by base asset quantity. */
export type TicketSizingMode = 'margin' | 'qty'

interface StatsRange {
  statsMode: StatsMode
  statsLookbackMs: number
  statsFrom: string
  statsTo: string
  statsToNow: boolean
  /** Timeframe used to review open positions for reversals. */
  statsReviewInterval: KlineInterval
}

interface TicketPrefs {
  ticketLeverage: number
  ticketMargin: string
  ticketSizingMode: TicketSizingMode
  ticketQty: string
  ticketOrderType: OrderType
  ticketMarginMode: MarginMode
  ticketTpMode: TpMode
  ticketSplit: number
  /** Single one-sided trade vs. both-directions range straddle. */
  ticketTradeMode: TradeMode
  /** Fraction (0..1) of margin allocated to the LONG leg of a straddle. */
  ticketStraddleSplit: number
  /** Position Builder: max usable margin (USDT) split across the ladder. */
  ticketBuilderBudget: string
  /** Position Builder: number of ladder rungs. */
  ticketBuilderRungs: number
}

interface UiPrefsState extends StatsRange, TicketPrefs {
  setStats: (p: Partial<StatsRange>) => void
  setTicket: (p: Partial<TicketPrefs>) => void
}

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      // Statistics time range
      statsMode: 'preset',
      statsLookbackMs: 30 * DAY,
      statsFrom: toDatetimeLocal(Date.now() - 7 * DAY),
      statsTo: toDatetimeLocal(Date.now()),
      statsToNow: true,
      statsReviewInterval: '1h',
      setStats: (p) => set((s) => ({ ...s, ...p })),

      // Order ticket defaults
      ticketLeverage: 20,
      ticketMargin: '1',
      ticketSizingMode: 'margin',
      ticketQty: '',
      ticketOrderType: 'MARKET',
      ticketMarginMode: 'CROSS',
      ticketTpMode: 'TP1',
      ticketSplit: 0.5,
      ticketTradeMode: 'single',
      ticketStraddleSplit: 0.5,
      ticketBuilderBudget: '5',
      ticketBuilderRungs: 5,
      setTicket: (p) => set((s) => ({ ...s, ...p })),
    }),
    { name: 'bitunix-ui-prefs' },
  ),
)
