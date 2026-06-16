import { placeStopLimitOrder } from '../../../lib/bitunix/rest'
import type { WebOrderSide } from '../../../lib/bitunix/types'
import { floorToPrecision, roundToPrecision } from './order'

// Native Bitunix trigger (stop-limit) entries for the Position Builder momentum
// style. Each rung becomes a real stop-limit order on the exchange: when the
// market reaches the rung price, a limit order at that price is placed. This
// replaces the previous client-side price polling — orders now rest on Bitunix
// and fire without the app being open.

export interface MomentumTriggerRung {
  /** Trigger price that arms the entry (also used as the limit price). */
  triggerPrice: number
  /** Order size in base coin. */
  amount: number
}

export interface MomentumTriggerResult {
  placed: number
  failed: number
  orderIds: string[]
  errors: string[]
}

/** Bitunix web order side: 2 = BUY/LONG, 1 = SELL/SHORT. */
function webSide(side: 'LONG' | 'SHORT'): WebOrderSide {
  return side === 'LONG' ? 2 : 1
}

/** Place one native stop-limit trigger per momentum rung. */
export async function submitMomentumTriggers(args: {
  symbol: string
  side: 'LONG' | 'SHORT'
  rungs: MomentumTriggerRung[]
  basePrecision: number
  quotePrecision: number
}): Promise<MomentumTriggerResult> {
  const { symbol, side, rungs, basePrecision, quotePrecision } = args
  const result: MomentumTriggerResult = { placed: 0, failed: 0, orderIds: [], errors: [] }

  for (const rung of rungs) {
    const amount = floorToPrecision(rung.amount, basePrecision)
    if (amount <= 0) continue
    const priceStr = String(roundToPrecision(rung.triggerPrice, quotePrecision))
    try {
      const res = await placeStopLimitOrder({
        symbol,
        side: webSide(side),
        price: priceStr,
        stopPrice: priceStr,
        amount: String(amount),
        frontAmount: String(amount),
        effectType: 1, // GTC
        orderUnit: 1, // base coin quantity
        reductionOnly: false,
        usePercentage: false,
      })
      result.placed++
      const id = res?.orderId ?? res?.id
      if (id) result.orderIds.push(id)
    } catch (e) {
      result.failed++
      result.errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  return result
}
