import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ChallengeConfigInput,
  CredentialsPayload,
  RiskLevel,
} from '@shared/challenge/types'
import { challengeApi } from '../../lib/challenge/api'

// TanStack Query hooks over the Challenge REST client. Live running state comes
// from the WebSocket stream (useChallengeStream); these cover config, account,
// validation, history and mutations.

export function useBackendHealth() {
  return useQuery({
    queryKey: ['challenge', 'health'],
    queryFn: challengeApi.health,
    refetchInterval: 10_000,
    retry: false,
  })
}

export function useCredentialsStatus() {
  return useQuery({
    queryKey: ['challenge', 'credStatus'],
    queryFn: challengeApi.credentialsStatus,
    refetchInterval: 30_000,
    retry: false,
  })
}

export function useBackendAccount(enabled: boolean) {
  return useQuery({
    queryKey: ['challenge', 'account'],
    queryFn: challengeApi.account,
    enabled,
    refetchInterval: 15_000,
    retry: false,
  })
}

export function useStrategies() {
  return useQuery({
    queryKey: ['challenge', 'strategies'],
    queryFn: challengeApi.strategies,
    staleTime: 300_000,
    retry: false,
  })
}

export function useValidation(config: ChallengeConfigInput, enabled: boolean) {
  return useQuery({
    queryKey: ['challenge', 'validate', JSON.stringify(config)],
    queryFn: () => challengeApi.validate(config),
    enabled,
    retry: false,
    staleTime: 8_000,
  })
}

export function useMinMargin(symbol: string, leverage: number, enabled: boolean) {
  return useQuery({
    queryKey: ['challenge', 'minMargin', symbol, leverage],
    queryFn: () => challengeApi.minMargin(symbol, leverage),
    enabled: enabled && Boolean(symbol) && leverage > 0,
    staleTime: 60_000,
    retry: false,
  })
}

export function useHistory() {
  return useQuery({
    queryKey: ['challenge', 'history'],
    queryFn: challengeApi.history,
    refetchInterval: 15_000,
    retry: false,
  })
}

export function useChallengeEvents(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['challenge', 'events', id],
    queryFn: () => challengeApi.events(id, 300),
    enabled,
    retry: false,
  })
}

export function useCreateChallenge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: ChallengeConfigInput) => challengeApi.create(config),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['challenge', 'history'] }),
  })
}

export function useStopChallenge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => challengeApi.stop(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['challenge', 'history'] }),
  })
}

export function useSetRisk() {
  return useMutation({
    mutationFn: (v: { id: string; symbol: string; riskLevel: RiskLevel }) =>
      challengeApi.setRisk(v.id, v.symbol, v.riskLevel),
  })
}

export function useSetCredentials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CredentialsPayload) => challengeApi.setCredentials(payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['challenge', 'credStatus'] }),
  })
}
