import { useEffect } from 'react'
import { binanceWs } from '../../lib/binance/ws'
import type { ForceOrderMsg, LiquidationEvent } from '../../lib/binance/types'
import { useAnalysisLive } from '../../store/analysisLive'
import { toNum } from '../../lib/format'

/**
 * Subscribes to the Binance per-symbol liquidation stream and accumulates
 * events in the analysis store. A SELL forceOrder is a long liquidation; a BUY
 * forceOrder is a short liquidation.
 */
export function useLiquidationStream(symbol: string): void {
  const addLiquidation = useAnalysisLive((s) => s.addLiquidation)

  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@forceOrder`
    const handler = (data: unknown) => {
      const msg = data as ForceOrderMsg
      if (!msg?.o) return
      const price = toNum(msg.o.ap) || toNum(msg.o.p)
      const qty = toNum(msg.o.q)
      if (!price || !qty) return
      const event: LiquidationEvent = {
        time: toNum(msg.o.T) || toNum(msg.E) || Date.now(),
        price,
        qty,
        side: msg.o.S,
        liquidatedSide: msg.o.S === 'SELL' ? 'LONG' : 'SHORT',
        notional: price * qty,
      }
      addLiquidation(event)
    }
    const unsub = binanceWs.subscribe(stream, handler)
    return () => unsub()
  }, [symbol, addLiquidation])
}
