import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Credentials {
  apiKey: string
  secretKey: string
  marginCoin: string
}

interface CredentialsState extends Credentials {
  hasKeys: () => boolean
  setCredentials: (c: Partial<Credentials>) => void
  clear: () => void
}

export const useCredentials = create<CredentialsState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      secretKey: '',
      marginCoin: 'USDT',
      hasKeys: () => Boolean(get().apiKey && get().secretKey),
      setCredentials: (c) => set((s) => ({ ...s, ...c })),
      clear: () => set({ apiKey: '', secretKey: '', marginCoin: 'USDT' }),
    }),
    {
      name: 'bitunix-credentials',
      partialize: (s) => ({
        apiKey: s.apiKey,
        secretKey: s.secretKey,
        marginCoin: s.marginCoin,
      }),
    },
  ),
)

/** Non-React accessor for use inside the REST client. */
export function getCredentials(): Credentials {
  const s = useCredentials.getState()
  return { apiKey: s.apiKey, secretKey: s.secretKey, marginCoin: s.marginCoin }
}
