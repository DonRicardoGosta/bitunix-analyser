import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCredentials } from '../../../store/credentials'
import {
  ensureBuilderTpslPolling,
  getActiveBuilderTpslJobs,
  getBuilderTpslJobs,
  pruneFinishedBuilderTpslJobs,
} from './builderTpsl'

/**
 * Polls the builder TP/SL apply jobs (app-wide): attaches the shared position
 * TP/SL once a momentum trigger fills.
 */
export function useBuilderShedWatcher(symbol?: string): {
  tpslPendingCount: number
  tpslFailedCount: number
} {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = useCredentials((s) => s.liveTradingEnabled)
  const queryClient = useQueryClient()
  const [, bump] = useState(0)

  useEffect(() => {
    if (!hasKeys || !live) return
    // Clear stale finished jobs once on mount so old failure notices don't linger.
    pruneFinishedBuilderTpslJobs()
    bump((n) => n + 1)
    const onTick = () => {
      bump((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['pendingPositions'] })
      queryClient.invalidateQueries({ queryKey: ['account'] })
      queryClient.invalidateQueries({ queryKey: ['pendingOrders'] })
    }
    return ensureBuilderTpslPolling(onTick)
  }, [hasKeys, live, queryClient])

  const tpslJobs = getBuilderTpslJobs().filter((j) => !symbol || j.symbol === symbol)
  return {
    tpslPendingCount: getActiveBuilderTpslJobs(symbol).length,
    tpslFailedCount: tpslJobs.filter((j) => j.status === 'failed').length,
  }
}
