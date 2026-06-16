import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCredentials } from '../../../store/credentials'
import {
  ensureBuilderShedPolling,
  getActiveBuilderShedJobs,
  getBuilderShedJobs,
} from './builderShed'

/** Polls for builder open-order fills and sheds excess with a hedge CLOSE + positionId. */
export function useBuilderShedWatcher(): {
  activeCount: number
  failedCount: number
} {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = useCredentials((s) => s.liveTradingEnabled)
  const queryClient = useQueryClient()
  const [, bump] = useState(0)

  useEffect(() => {
    if (!hasKeys || !live) return
    return ensureBuilderShedPolling(() => {
      bump((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['pendingPositions'] })
      queryClient.invalidateQueries({ queryKey: ['account'] })
    })
  }, [hasKeys, live, queryClient])

  const jobs = getBuilderShedJobs()
  return {
    activeCount: getActiveBuilderShedJobs().length,
    failedCount: jobs.filter((j) => j.status === 'failed').length,
  }
}
