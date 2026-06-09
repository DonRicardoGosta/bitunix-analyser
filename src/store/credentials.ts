import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Credentials {
  apiKey: string
  secretKey: string
  marginCoin: string
}

interface CredentialsState extends Credentials {
  /** Safety gate: real orders can only be placed when this is explicitly on. */
  liveTradingEnabled: boolean
  hasKeys: () => boolean
  setCredentials: (c: Partial<Credentials>) => void
  setLiveTradingEnabled: (v: boolean) => void
  clear: () => void
}

export const useCredentials = create<CredentialsState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      secretKey: '',
      marginCoin: 'USDT',
      liveTradingEnabled: false,
      hasKeys: () => Boolean(get().apiKey && get().secretKey),
      setCredentials: (c) => set((s) => ({ ...s, ...c })),
      setLiveTradingEnabled: (v) => set({ liveTradingEnabled: v }),
      clear: () => set({ apiKey: '', secretKey: '', marginCoin: 'USDT', liveTradingEnabled: false }),
    }),
    {
      name: 'bitunix-credentials',
      partialize: (s) => ({
        apiKey: s.apiKey,
        secretKey: s.secretKey,
        marginCoin: s.marginCoin,
        liveTradingEnabled: s.liveTradingEnabled,
      }),
    },
  ),
)

/** Non-React accessor for use inside the REST client. */
export function getCredentials(): Credentials {
  const s = useCredentials.getState()
  return { apiKey: s.apiKey, secretKey: s.secretKey, marginCoin: s.marginCoin }
}
