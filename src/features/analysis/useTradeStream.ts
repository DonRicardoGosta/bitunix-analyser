import { useEffect } from 'react'
import { binanceWs } from '../../lib/binance/ws'
import type { AggTradeMsg } from '../../lib/binance/types'
import { useAnalysisLive } from '../../store/analysisLive'
import { toNum } from '../../lib/format'

/**
 * Subscribes to the Binance aggregated-trade stream and feeds the trade tape /
 * CVD accumulator. `m` (buyer-is-maker) true => the aggressor was a seller.
 */
export function useTradeStream(symbol: string): void {
  const addTrade = useAnalysisLive((s) => s.addTrade)

  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@aggTrade`
    const handler = (data: unknown) => {
      const msg = data as AggTradeMsg
      if (msg?.e !== 'aggTrade') return
      addTrade({
        time: toNum(msg.T) || Date.now(),
        price: toNum(msg.p),
        qty: toNum(msg.q),
        buy: msg.m === false,
      })
    }
    const unsub = binanceWs.subscribe(stream, handler)
    return () => unsub()
  }, [symbol, addTrade])
}
