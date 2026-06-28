import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CoinConfig, TradingMode } from '@shared/challenge/types'

// Draft configuration for the Challenge builder (item 3: multi-coin). This is
// the client-side form state; on "start" it is POSTed to the backend which owns
// the running challenge. Persisted locally so an in-progress draft survives a
// reload.

export interface ChallengeDraft {
  name: string
  mode: TradingMode
  /** Virtual start balance (Paper) / reference equity used for targets. */
  startBalance: number
  /** Cap on the share of available account balance the challenge may commit. */
  maxAccountUsagePct: number
  profitTargetPct: number
  maxLossPct: number
  coins: CoinConfig[]
}

interface ChallengeDraftState extends ChallengeDraft {
  setField: <K extends keyof ChallengeDraft>(key: K, value: ChallengeDraft[K]) => void
  addCoin: (coin?: Partial<CoinConfig>) => void
  updateCoin: (index: number, patch: Partial<CoinConfig>) => void
  removeCoin: (index: number) => void
  reset: () => void
}

export function defaultCoin(symbol = 'BTCUSDT'): CoinConfig {
  return { symbol, leverage: 5, orderQty: 0.001, marginAllocated: 20, riskLevel: 2 }
}

const INITIAL: ChallengeDraft = {
  name: 'My Challenge',
  mode: 'paper',
  startBalance: 100,
  maxAccountUsagePct: 50,
  profitTargetPct: 100,
  maxLossPct: 20,
  coins: [defaultCoin()],
}

export const useChallengeDraft = create<ChallengeDraftState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setField: (key, value) => set(() => ({ [key]: value }) as Partial<ChallengeDraftState>),
      addCoin: (coin) =>
        set((s) => ({ coins: [...s.coins, { ...defaultCoin(), ...coin }] })),
      updateCoin: (index, patch) =>
        set((s) => ({
          coins: s.coins.map((c, i) => (i === index ? { ...c, ...patch } : c)),
        })),
      removeCoin: (index) => set((s) => ({ coins: s.coins.filter((_, i) => i !== index) })),
      reset: () => set(() => ({ ...INITIAL, coins: [defaultCoin()] })),
    }),
    { name: 'bitunix-challenge-draft' },
  ),
)
