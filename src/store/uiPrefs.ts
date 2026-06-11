import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toDatetimeLocal } from '../lib/format'

const DAY = 86_400_000

export type StatsMode = 'preset' | 'custom'
export type OrderType = 'LIMIT' | 'MARKET'
export type MarginMode = 'CROSS' | 'ISOLATION'
export type TpMode = 'TP1' | 'TP2' | 'BOTH'

interface StatsRange {
  statsMode: StatsMode
  statsLookbackMs: number
  statsFrom: string
  statsTo: string
  statsToNow: boolean
}

interface TicketPrefs {
  ticketLeverage: number
  ticketMargin: string
  ticketOrderType: OrderType
  ticketMarginMode: MarginMode
  ticketTpMode: TpMode
  ticketSplit: number
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
      setStats: (p) => set((s) => ({ ...s, ...p })),

      // Order ticket defaults
      ticketLeverage: 20,
      ticketMargin: '1',
      ticketOrderType: 'MARKET',
      ticketMarginMode: 'CROSS',
      ticketTpMode: 'TP1',
      ticketSplit: 0.5,
      setTicket: (p) => set((s) => ({ ...s, ...p })),
    }),
    { name: 'bitunix-ui-prefs' },
  ),
)
