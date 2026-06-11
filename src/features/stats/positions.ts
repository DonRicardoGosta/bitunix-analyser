import type { PendingPositionRaw, TpslOrderRaw } from '../../lib/bitunix/types'
import { toNum } from '../../lib/format'

export interface PositionTpsl {
  tp: number
  sl: number
}

/** Aggregates TP/SL trigger orders per position (qty-weighted average price). */
export function buildTpslMap(orders: TpslOrderRaw[] | undefined): Record<string, PositionTpsl> {
  const acc: Record<string, { tpNum: number; tpDen: number; slNum: number; slDen: number }> = {}
  for (const o of orders ?? []) {
    const id = o.positionId
    if (!id) continue
    const a = acc[id] ?? { tpNum: 0, tpDen: 0, slNum: 0, slDen: 0 }
    const tp = toNum(o.tpPrice, NaN)
    const sl = toNum(o.slPrice, NaN)
    const tpQty = toNum(o.tpQty, 0) || 1
    const slQty = toNum(o.slQty, 0) || 1
    if (Number.isFinite(tp) && tp > 0) {
      a.tpNum += tp * tpQty
      a.tpDen += tpQty
    }
    if (Number.isFinite(sl) && sl > 0) {
      a.slNum += sl * slQty
      a.slDen += slQty
    }
    acc[id] = a
  }
  const out: Record<string, PositionTpsl> = {}
  for (const [id, a] of Object.entries(acc)) {
    out[id] = { tp: a.tpDen > 0 ? a.tpNum / a.tpDen : NaN, sl: a.slDen > 0 ? a.slNum / a.slDen : NaN }
  }
  return out
}

export interface ProjectedBalances {
  ifTp: number
  ifSl: number
  tpDelta: number
  slDelta: number
}

/**
 * Projects wallet balance if every open position reaches its TP (or its SL).
 * Positions without a TP/SL contribute their current unrealized PnL instead.
 */
export function projectedBalances(
  positions: PendingPositionRaw[],
  tpslMap: Record<string, PositionTpsl>,
  wallet: number,
): ProjectedBalances {
  let tpSum = 0
  let slSum = 0
  for (const p of positions) {
    const entry = toNum(p.avgOpenPrice)
    const qty = toNum(p.qty)
    const isLong = p.side === 'LONG'
    const unrealized = toNum(p.unrealizedPNL)
    const t = tpslMap[p.positionId]
    const tp = t?.tp ?? NaN
    const sl = t?.sl ?? NaN
    tpSum +=
      Number.isFinite(tp) && tp > 0 && entry > 0 ? (isLong ? qty * (tp - entry) : qty * (entry - tp)) : unrealized
    slSum +=
      Number.isFinite(sl) && sl > 0 && entry > 0 ? (isLong ? qty * (sl - entry) : qty * (entry - sl)) : unrealized
  }
  return { ifTp: wallet + tpSum, ifSl: wallet + slSum, tpDelta: tpSum, slDelta: slSum }
}
