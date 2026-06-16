import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Credentials {
  apiKey: string
  secretKey: string
  marginCoin: string
}

/**
 * Bitunix web session credentials, used only for the internal trigger/stop-limit
 * endpoint (api.bitunix.com) that the API key cannot authenticate. The token is
 * short-lived and pasted by the user from a logged-in bitunix.com browser session.
 */
export interface WebSession {
  webToken: string
  webUserId: string
  webOneId: string
}

interface CredentialsState extends Credentials, WebSession {
  /** Safety gate: real orders can only be placed when this is explicitly on. */
  liveTradingEnabled: boolean
  hasKeys: () => boolean
  hasWebSession: () => boolean
  setCredentials: (c: Partial<Credentials>) => void
  setWebSession: (s: Partial<WebSession>) => void
  setLiveTradingEnabled: (v: boolean) => void
  clear: () => void
}

export const useCredentials = create<CredentialsState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      secretKey: '',
      marginCoin: 'USDT',
      webToken: '',
      webUserId: '',
      webOneId: '',
      liveTradingEnabled: false,
      hasKeys: () => Boolean(get().apiKey && get().secretKey),
      hasWebSession: () => Boolean(get().webToken),
      setCredentials: (c) => set((s) => ({ ...s, ...c })),
      setWebSession: (w) => set((s) => ({ ...s, ...w })),
      setLiveTradingEnabled: (v) => set({ liveTradingEnabled: v }),
      clear: () =>
        set({
          apiKey: '',
          secretKey: '',
          marginCoin: 'USDT',
          webToken: '',
          webUserId: '',
          webOneId: '',
          liveTradingEnabled: false,
        }),
    }),
    {
      name: 'bitunix-credentials',
      partialize: (s) => ({
        apiKey: s.apiKey,
        secretKey: s.secretKey,
        marginCoin: s.marginCoin,
        webToken: s.webToken,
        webUserId: s.webUserId,
        webOneId: s.webOneId,
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

/** Non-React accessor for the web session token headers. */
export function getWebSession(): WebSession {
  const s = useCredentials.getState()
  return { webToken: s.webToken, webUserId: s.webUserId, webOneId: s.webOneId }
}
