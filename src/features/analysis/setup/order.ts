import type { TradingPairRaw } from '../../../lib/bitunix/types'
import { toNum } from '../../../lib/format'

export type TpMode = 'TP1' | 'TP2' | 'BOTH'

export interface SymbolSpec {
  symbol: string
  basePrecision: number
  quotePrecision: number
  minTradeVolume: number
  minLeverage: number
  maxLeverage: number
  defaultLeverage: number
}

export function parseSpec(raw: TradingPairRaw | undefined, symbol: string): SymbolSpec {
  return {
    symbol,
    basePrecision: raw?.basePrecision ?? 3,
    quotePrecision: raw?.quotePrecision ?? 2,
    minTradeVolume: toNum(raw?.minTradeVolume, 0),
    minLeverage: Math.max(1, Math.round(toNum(raw?.minLeverage, 1))),
    maxLeverage: Math.max(1, Math.round(toNum(raw?.maxLeverage, 100))),
    defaultLeverage: Math.max(1, Math.round(toNum(raw?.defaultLeverage, 20))),
  }
}

export function floorToPrecision(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const f = Math.pow(10, Math.max(0, decimals))
  return Math.floor(value * f) / f
}

export function roundToPrecision(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const f = Math.pow(10, Math.max(0, decimals))
  return Math.round(value * f) / f
}

/** Derive collateral (USDT) from base qty, entry, and leverage. */
export function marginFromQty(
  qty: number,
  entry: number,
  leverage: number,
  quotePrecision: number,
): number {
  if (!Number.isFinite(qty) || !Number.isFinite(entry) || !Number.isFinite(leverage) || leverage <= 0) return 0
  return roundToPrecision((qty * entry) / leverage, quotePrecision)
}

/** Derive base qty from collateral, entry, and leverage. */
export function qtyFromMargin(
  margin: number,
  entry: number,
  leverage: number,
  basePrecision: number,
): number {
  if (!Number.isFinite(margin) || !Number.isFinite(entry) || entry <= 0) return 0
  return floorToPrecision((margin * leverage) / entry, basePrecision)
}

export interface OrderLeg {
  label: 'TP1' | 'TP2'
  tp: number
  qty: number
  profit: number // USDT PnL if this leg's TP is hit
}

export interface BuilderRungSizing {
  price: number
  /** Margin (USDT) allocated to this rung from the budget. */
  targetMargin: number
  /** Floored base quantity the rung's margin slice buys. */
  targetQty: number
  /** Order size for this rung (= targetQty when valid, 0 when below the minimum). */
  netQty: number
  /** True when the rung's target quantity is below the exchange minimum. */
  belowMin: boolean
  /** Net notional (netQty * price). */
  notional: number
  warning?: string
}

/**
 * Sizes one builder rung from its margin slice. A rung is only valid when its
 * target quantity clears the exchange minimum — there is no open-then-shed
 * trick; sub-minimum rungs are flagged so the caller can block the build.
 */
export function planBuilderRung(args: {
  price: number
  targetMargin: number
  leverage: number
  spec: SymbolSpec
}): BuilderRungSizing {
  const { price, targetMargin, leverage, spec } = args
  const targetQty = qtyFromMargin(targetMargin, price, leverage, spec.basePrecision)
  const min = spec.minTradeVolume
  const belowMin = min > 0 && targetQty < min

  let warning: string | undefined
  if (targetQty <= 0) warning = 'Rung size rounds to zero — raise the budget or leverage, or use fewer rungs.'
  else if (belowMin) warning = `Rung at ${price} is below the exchange minimum (${min}).`

  const netQty = belowMin ? 0 : targetQty

  return {
    price,
    targetMargin,
    targetQty,
    netQty,
    belowMin,
    notional: netQty * price,
    warning,
  }
}

export interface OrderProjection {
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  leverage: number
  margin: number
  qty: number
  notional: number
  legs: OrderLeg[]
  profitTotal: number
  profitRoiPct: number
  lossPnl: number // negative number (PnL at stop)
  lossRoiPct: number
  liqPrice: number
  rr: number
  warnings: string[]
  /** Non-blocking informational notes (e.g. stop beyond liquidation). */
  notices: string[]
}

export interface ProjectInput {
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  tp1: number
  tp2: number
  leverage: number
  margin: number
  tpMode: TpMode
  /** Fraction (0..1) of qty closed at TP1 when tpMode === 'BOTH'. */
  split: number
  spec: SymbolSpec
  marginMode: 'CROSS' | 'ISOLATION'
  /** Free balance backing a cross position (used for the liq. estimate). */
  availableBalance?: number
}

function pnlAt(side: 'LONG' | 'SHORT', entry: number, price: number, qty: number): number {
  return side === 'LONG' ? qty * (price - entry) : qty * (entry - price)
}

export function projectOrder(input: ProjectInput): OrderProjection {
  const { side, entry, stop, tp1, tp2, leverage, margin, tpMode, split, spec, marginMode, availableBalance } =
    input
  const warnings: string[] = []
  const isCross = marginMode === 'CROSS'

  const qty = qtyFromMargin(margin, entry, leverage, spec.basePrecision)
  const notional = qty * entry

  const legs: OrderLeg[] = []
  if (tpMode === 'TP1') {
    legs.push({ label: 'TP1', tp: tp1, qty, profit: pnlAt(side, entry, tp1, qty) })
  } else if (tpMode === 'TP2') {
    legs.push({ label: 'TP2', tp: tp2, qty, profit: pnlAt(side, entry, tp2, qty) })
  } else {
    const qty1 = floorToPrecision(qty * split, spec.basePrecision)
    const qty2 = floorToPrecision(qty - qty1, spec.basePrecision)
    legs.push({ label: 'TP1', tp: tp1, qty: qty1, profit: pnlAt(side, entry, tp1, qty1) })
    legs.push({ label: 'TP2', tp: tp2, qty: qty2, profit: pnlAt(side, entry, tp2, qty2) })
    if (spec.minTradeVolume > 0 && (qty1 < spec.minTradeVolume || qty2 < spec.minTradeVolume)) {
      warnings.push('A leg is below the minimum trade size — increase size or use a single TP.')
    }
  }

  const profitTotal = legs.reduce((a, l) => a + l.profit, 0)
  const lossPnl = pnlAt(side, entry, stop, qty)
  const lossRoiPct = margin > 0 ? (lossPnl / margin) * 100 : 0

  // Loss buffer before liquidation: isolated = the position margin; cross = the
  // whole free balance backs the position (falls back to margin if unknown).
  const buffer = isCross ? (availableBalance && availableBalance > 0 ? availableBalance : margin) : margin

  const notices: string[] = []
  if (buffer > 0 && Math.abs(lossPnl) >= buffer) {
    notices.push(
      isCross
        ? 'Loss at the stop exceeds your available balance — a cross position would be liquidated before the stop triggers. Lower leverage/size or tighten the stop.'
        : 'Stop-loss is beyond the liquidation price at this leverage — you would be liquidated before it triggers. Lower the leverage or tighten the stop.',
    )
  }

  // Weighted-average TP for the R:R headline.
  const totalLegQty = legs.reduce((a, l) => a + l.qty, 0) || qty
  const blendedTp = legs.reduce((a, l) => a + l.tp * l.qty, 0) / totalLegQty
  const rr = Math.abs(entry - stop) > 0 ? Math.abs(blendedTp - entry) / Math.abs(entry - stop) : 0

  // Approximate liquidation price (excludes fees/funding/MMR). For isolated the
  // buffer is the position margin (=> entry*(1 ∓ 1/leverage)); for cross the
  // whole free balance backs it, pushing liquidation further away.
  const liqFraction = notional > 0 ? Math.min(buffer / notional, 1) : 0
  const liqPrice = side === 'LONG' ? entry * (1 - liqFraction) : entry * (1 + liqFraction)

  if (spec.minTradeVolume > 0 && qty < spec.minTradeVolume) {
    warnings.push(
      `Position size ${qty} is below the minimum (${spec.minTradeVolume}). Increase size or leverage.`,
    )
  }
  if (qty <= 0) warnings.push('Position size is zero — increase size or leverage.')

  return {
    side,
    entry,
    stop,
    leverage,
    margin,
    qty,
    notional,
    legs,
    profitTotal,
    profitRoiPct: margin > 0 ? (profitTotal / margin) * 100 : 0,
    lossPnl,
    lossRoiPct,
    liqPrice,
    rr,
    warnings,
    notices,
  }
}
