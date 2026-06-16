import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCredentials } from '../../../store/credentials'
import {
  ensureBuilderShedPolling,
  getActiveBuilderShedJobs,
  getBuilderShedJobs,
} from './builderShed'
import {
  ensureBuilderTriggerPolling,
  getActiveBuilderTriggerJobs,
  getBuilderTriggerJobs,
} from './builderTrigger'

/** Polls builder shed jobs and momentum trigger entries (app-wide). */
export function useBuilderShedWatcher(symbol?: string): {
  activeCount: number
  failedCount: number
  triggerCount: number
  triggerFailedCount: number
} {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = useCredentials((s) => s.liveTradingEnabled)
  const queryClient = useQueryClient()
  const [, bump] = useState(0)

  useEffect(() => {
    if (!hasKeys || !live) return
    const onTick = () => {
      bump((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['pendingPositions'] })
      queryClient.invalidateQueries({ queryKey: ['account'] })
      queryClient.invalidateQueries({ queryKey: ['pendingOrders'] })
    }
    const stopShed = ensureBuilderShedPolling(onTick)
    const stopTrigger = ensureBuilderTriggerPolling(onTick)
    return () => {
      stopShed()
      stopTrigger()
    }
  }, [hasKeys, live, queryClient])

  const jobs = getBuilderShedJobs().filter((j) => !symbol || j.symbol === symbol)
  const triggers = getBuilderTriggerJobs().filter((j) => !symbol || j.symbol === symbol)
  return {
    activeCount: getActiveBuilderShedJobs(symbol).length,
    failedCount: jobs.filter((j) => j.status === 'failed').length,
    triggerCount: getActiveBuilderTriggerJobs(symbol).length,
    triggerFailedCount: triggers.filter((j) => j.status === 'failed').length,
  }
}
