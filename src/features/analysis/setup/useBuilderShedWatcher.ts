import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCredentials } from '../../../store/credentials'
import {
  ensureBuilderShedPolling,
  getActiveBuilderShedJobs,
  getBuilderShedJobs,
  processBuilderShedJobs,
  pruneFinishedBuilderShedJobs,
  retryFailedBuilderShedJobs,
} from './builderShed'
import {
  ensureBuilderTpslPolling,
  getActiveBuilderTpslJobs,
  getBuilderTpslJobs,
  processBuilderTpslJobs,
  pruneFinishedBuilderTpslJobs,
} from './builderTpsl'

/**
 * Polls builder background jobs (app-wide):
 *  - shed jobs: close the open+shed excess once a pullback limit fills.
 *  - tpsl jobs: attach the shared position TP/SL once a momentum trigger fills.
 */
export function useBuilderShedWatcher(symbol?: string): {
  activeCount: number
  failedCount: number
  tpslPendingCount: number
  tpslFailedCount: number
  shedBusy: boolean
  shedNow: () => Promise<void>
} {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const live = useCredentials((s) => s.liveTradingEnabled)
  const queryClient = useQueryClient()
  const [, bump] = useState(0)
  const [shedBusy, setShedBusy] = useState(false)
  const busyRef = useRef(false)

  // Run the shed (and TP/SL apply) immediately, retrying any failed rungs, so the
  // user does not have to wait for the background poll.
  const shedNow = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setShedBusy(true)
    try {
      retryFailedBuilderShedJobs(symbol)
      bump((n) => n + 1)
      await Promise.allSettled([processBuilderShedJobs(), processBuilderTpslJobs()])
      ensureBuilderShedPolling()
      ensureBuilderTpslPolling()
      queryClient.invalidateQueries({ queryKey: ['pendingPositions'] })
      queryClient.invalidateQueries({ queryKey: ['account'] })
    } finally {
      busyRef.current = false
      setShedBusy(false)
      bump((n) => n + 1)
    }
  }, [symbol, queryClient])

  useEffect(() => {
    if (!hasKeys || !live) return
    // Clear stale finished jobs once on mount so old failure notices don't linger.
    pruneFinishedBuilderShedJobs()
    pruneFinishedBuilderTpslJobs()
    bump((n) => n + 1)
    const onTick = () => {
      bump((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['pendingPositions'] })
      queryClient.invalidateQueries({ queryKey: ['account'] })
      queryClient.invalidateQueries({ queryKey: ['pendingOrders'] })
    }
    const stopShed = ensureBuilderShedPolling(onTick)
    const stopTpsl = ensureBuilderTpslPolling(onTick)
    return () => {
      stopShed()
      stopTpsl()
    }
  }, [hasKeys, live, queryClient])

  const jobs = getBuilderShedJobs().filter((j) => !symbol || j.symbol === symbol)
  const tpslJobs = getBuilderTpslJobs().filter((j) => !symbol || j.symbol === symbol)
  return {
    activeCount: getActiveBuilderShedJobs(symbol).length,
    failedCount: jobs.filter((j) => j.status === 'failed').length,
    tpslPendingCount: getActiveBuilderTpslJobs(symbol).length,
    tpslFailedCount: tpslJobs.filter((j) => j.status === 'failed').length,
    shedBusy,
    shedNow,
  }
}
