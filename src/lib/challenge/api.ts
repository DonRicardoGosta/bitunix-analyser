import type {
  AccountBalanceResponse,
  ChallengeConfigInput,
  ChallengeEvent,
  ChallengeRun,
  ChallengeSummary,
  CredentialsPayload,
  MinMarginResult,
  RiskLevel,
  ValidateConfigResult,
} from '@shared/challenge/types'

// REST client for the Challenge backend. All paths are under /api and proxied
// to the backend by Vite (dev) and nginx (prod).

const BASE = '/api'

export interface ApiClientError extends Error {
  status?: number
  details?: unknown
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  const json: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const body = json as { error?: string; details?: unknown } | null
    const err: ApiClientError = new Error(body?.error ?? `HTTP ${res.status}`)
    err.status = res.status
    err.details = body?.details
    throw err
  }
  return json as T
}

export interface StrategyInfo {
  id: string
  symbols: string[]
  interval: string
}

export const challengeApi = {
  health: () => req<{ status: string; ts: number }>('/health'),

  credentialsStatus: () => req<{ hasCredentials: boolean }>('/credentials/status'),
  setCredentials: (payload: CredentialsPayload) =>
    req<{ ok: true }>('/credentials', { method: 'POST', body: JSON.stringify(payload) }),

  account: () => req<AccountBalanceResponse>('/account'),
  strategies: () => req<StrategyInfo[]>('/strategies'),

  validate: (config: ChallengeConfigInput) =>
    req<ValidateConfigResult>('/challenges/validate', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  minMargin: (symbol: string, leverage: number) =>
    req<MinMarginResult>(
      `/min-margin?symbol=${encodeURIComponent(symbol)}&leverage=${encodeURIComponent(leverage)}`,
    ),

  create: (config: ChallengeConfigInput) =>
    req<ChallengeRun>('/challenges', { method: 'POST', body: JSON.stringify(config) }),
  list: () => req<ChallengeSummary[]>('/challenges'),
  history: () => req<ChallengeRun[]>('/history'),
  get: (id: string) => req<ChallengeSummary>(`/challenges/${id}`),
  stop: (id: string) => req<{ ok: true }>(`/challenges/${id}/stop`, { method: 'POST' }),
  setRisk: (id: string, symbol: string, riskLevel: RiskLevel) =>
    req<{ ok: true }>(`/challenges/${id}/risk`, {
      method: 'PATCH',
      body: JSON.stringify({ symbol, riskLevel }),
    }),
  events: (id: string, limit = 200) =>
    req<ChallengeEvent[]>(`/challenges/${id}/events?limit=${limit}`),
}
