import type { PendingPositionRaw, TpslOrderRaw } from '../../lib/bitunix/types'
import { toNum } from '../../lib/format'

export type PositionSide = 'LONG' | 'SHORT'

export type ParsedPendingPosition = Omit<PendingPositionRaw, 'side'> & { side: PositionSide }

/** Map API position side (LONG/SHORT or hedge BUY/SELL) to LONG/SHORT. */
export function normalizePositionSide(raw: string): PositionSide {
  const s = raw.toUpperCase()
  if (s === 'LONG' || s === 'BUY') return 'LONG'
  if (s === 'SHORT' || s === 'SELL') return 'SHORT'
  return 'LONG'
}

/** Normalize pending position fields after fetch (hedge mode may return BUY/SELL). */
export function parsePendingPosition(p: PendingPositionRaw): ParsedPendingPosition {
  return { ...p, side: normalizePositionSide(p.side) }
}

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

/**
 * Determines whether a position is long. Derives the direction from the real
 * unrealized PnL vs. mark price (robust to the API's `side` labelling), and
 * falls back to the `side` field when that is ambiguous.
 */
export function positionIsLong(p: PendingPositionRaw, mark: number): boolean {
  const entry = toNum(p.avgOpenPrice)
  const u = toNum(p.unrealizedPNL)
  if (entry > 0 && mark > 0 && Math.abs(mark - entry) > entry * 1e-6 && Math.abs(u) > 1e-9) {
    return (u >= 0) === (mark >= entry)
  }
  return normalizePositionSide(p.side) === 'LONG'
}

export interface PositionOutcome {
  isLong: boolean
  /** Favorable (profit) trigger price + PnL. */
  tpPrice: number | null
  tpPnl: number
  /** Adverse (loss) trigger price + PnL. */
  slPrice: number | null
  slPnl: number
}

/**
 * Computes a position's outcome at its two trigger prices and assigns the more
 * profitable one to "TP" and the less profitable to "SL" — so the buckets can
 * never come out swapped regardless of how the API labels the triggers.
 */
export function positionOutcome(
  p: PendingPositionRaw,
  tpsl: PositionTpsl | undefined,
  mark: number,
): PositionOutcome {
  const entry = toNum(p.avgOpenPrice)
  const qty = toNum(p.qty)
  const unrealized = toNum(p.unrealizedPNL)
  const isLong = positionIsLong(p, mark)
  const pnlAt = (price: number) => (isLong ? qty * (price - entry) : qty * (entry - price))

  const aPrice = tpsl && Number.isFinite(tpsl.tp) && tpsl.tp > 0 ? tpsl.tp : null
  const bPrice = tpsl && Number.isFinite(tpsl.sl) && tpsl.sl > 0 ? tpsl.sl : null
  const a = { price: aPrice, pnl: aPrice !== null && entry > 0 ? pnlAt(aPrice) : unrealized }
  const b = { price: bPrice, pnl: bPrice !== null && entry > 0 ? pnlAt(bPrice) : unrealized }
  const [fav, adv] = a.pnl >= b.pnl ? [a, b] : [b, a]

  return { isLong, tpPrice: fav.price, tpPnl: fav.pnl, slPrice: adv.price, slPnl: adv.pnl }
}

export interface ProjectedBalances {
  ifTp: number
  ifSl: number
  tpDelta: number
  slDelta: number
}

/**
 * Projects wallet balance if every open position reaches its favorable target
 * (TP) or its adverse stop (SL). Positions without a trigger contribute their
 * current unrealized PnL instead.
 */
export function projectedBalances(
  positions: PendingPositionRaw[],
  tpslMap: Record<string, PositionTpsl>,
  wallet: number,
  markOf: (symbol: string) => number,
): ProjectedBalances {
  let tpSum = 0
  let slSum = 0
  for (const p of positions) {
    const o = positionOutcome(p, tpslMap[p.positionId], markOf(p.symbol))
    tpSum += o.tpPnl
    slSum += o.slPnl
  }
  return { ifTp: wallet + tpSum, ifSl: wallet + slSum, tpDelta: tpSum, slDelta: slSum }
}
