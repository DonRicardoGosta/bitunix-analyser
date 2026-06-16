import type { PendingPositionRaw, TpslOrderRaw } from '../../lib/bitunix/types'
import type { PriceLineDef } from '../../components/charts/chartTypes'
import { toNum } from '../../lib/format'

export interface PositionTpslLevel {
  orderId: string
  kind: 'tp' | 'sl'
  price: number
  qty: number
  stopType: 'MARK_PRICE' | 'LAST_PRICE'
  index: number
  order: TpslOrderRaw
}

function normalizeStopType(v: string | undefined): 'MARK_PRICE' | 'LAST_PRICE' {
  return v === 'MARK_PRICE' ? 'MARK_PRICE' : 'LAST_PRICE'
}

/** Split raw TP/SL orders into individual TP and SL levels for one position. */
export function groupPositionTpslOrders(
  positionId: string,
  orders: TpslOrderRaw[] | undefined,
): { tp: PositionTpslLevel[]; sl: PositionTpslLevel[] } {
  const tp: PositionTpslLevel[] = []
  const sl: PositionTpslLevel[] = []
  let tpIdx = 0
  let slIdx = 0

  for (const order of orders ?? []) {
    if (order.positionId !== positionId) continue
    const tpPrice = toNum(order.tpPrice, NaN)
    if (Number.isFinite(tpPrice) && tpPrice > 0) {
      tpIdx++
      tp.push({
        orderId: order.id,
        kind: 'tp',
        price: tpPrice,
        qty: toNum(order.tpQty, 0),
        stopType: normalizeStopType(order.tpStopType),
        index: tpIdx,
        order,
      })
    }
    const slPrice = toNum(order.slPrice, NaN)
    if (Number.isFinite(slPrice) && slPrice > 0) {
      slIdx++
      sl.push({
        orderId: order.id,
        kind: 'sl',
        price: slPrice,
        qty: toNum(order.slQty, 0),
        stopType: normalizeStopType(order.slStopType),
        index: slIdx,
        order,
      })
    }
  }

  tp.sort((a, b) => a.price - b.price)
  sl.sort((a, b) => a.price - b.price)
  return { tp, sl }
}

function levelLabel(tag: string, kind: 'tp' | 'sl', index: number, total: number): string {
  const base = kind === 'tp' ? 'TP' : 'SL'
  const suffix = total > 1 ? String(index) : ''
  return `${tag} ${base}${suffix}`
}

/** Build chart price lines from API position side and all TP/SL trigger orders. */
export function buildPositionChartLines(
  positions: PendingPositionRaw[],
  tpslOrders: TpslOrderRaw[] | undefined,
): PriceLineDef[] {
  const out: PriceLineDef[] = []

  positions.forEach((p, pi) => {
    const isLong = p.side === 'LONG'
    const tag = positions.length > 1 ? `${isLong ? 'L' : 'S'}${pi + 1}` : p.side
    const entry = toNum(p.avgOpenPrice)
    const liq = toNum(p.liqPrice)

    if (entry > 0) {
      out.push({
        price: entry,
        color: isLong ? '#22c55e' : '#ef4444',
        title: `${tag} entry`,
        width: 2,
      })
    }

    const { tp, sl } = groupPositionTpslOrders(p.positionId, tpslOrders)
    for (const level of tp) {
      out.push({
        price: level.price,
        color: '#22d3ee',
        title: levelLabel(tag, 'tp', level.index, tp.length),
        dashed: true,
      })
    }
    for (const level of sl) {
      out.push({
        price: level.price,
        color: '#f43f5e',
        title: levelLabel(tag, 'sl', level.index, sl.length),
        dashed: true,
      })
    }

    if (liq > 0) {
      out.push({
        price: liq,
        color: '#f59e0b',
        title: `${tag} Liq`,
        dashed: true,
      })
    }
  })

  return out
}

export function normalizeStopTypeExport(v: string | undefined): 'MARK_PRICE' | 'LAST_PRICE' {
  return normalizeStopType(v)
}
