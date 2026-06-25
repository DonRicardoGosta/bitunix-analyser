import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChallengeConfig } from '../features/challenge/compute'

interface ChallengeState extends ChallengeConfig {
  setChallenge: (p: Partial<ChallengeConfig>) => void
  reset: (startBalance: number) => void
}

export const useChallenge = create<ChallengeState>()(
  persist(
    (set) => ({
      startBalance: 100,
      profitTargetPct: 100,
      maxDrawdownPct: 20,
      startTime: Date.now(),
      marginPerTradePct: 1,
      takeProfitPct: 100,
      setChallenge: (p) => set((s) => ({ ...s, ...p })),
      // Start a fresh run from the current balance, dropping older trades.
      reset: (startBalance) => set(() => ({ startBalance, startTime: Date.now() })),
    }),
    { name: 'bitunix-challenge' },
  ),
)
