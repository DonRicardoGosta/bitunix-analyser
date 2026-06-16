import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCredentials } from '../../../store/credentials'
import {
  ensureBuilderShedPolling,
  getActiveBuilderShedJobs,
  getBuilderShedJobs,
} from './builderShed'
import {
  ensureBuilderDeferredPolling,
  getActiveBuilderDeferredRungs,
  getBuilderDeferredRungs,
} from './builderDeferred'

/** Polls builder fill/shed jobs and deferred momentum rung placement. */
export function useBuilderShedWatcher(): {
  activeCount: number
  failedCount: number
  deferredCount: number
  deferredFailedCount: number
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
    const stopDeferred = ensureBuilderDeferredPolling(onTick)
    return () => {
      stopShed()
      stopDeferred()
    }
  }, [hasKeys, live, queryClient])

  const jobs = getBuilderShedJobs()
  const deferred = getBuilderDeferredRungs()
  return {
    activeCount: getActiveBuilderShedJobs().length,
    failedCount: jobs.filter((j) => j.status === 'failed').length,
    deferredCount: getActiveBuilderDeferredRungs().length,
    deferredFailedCount: deferred.filter((j) => j.status === 'failed').length,
  }
}
