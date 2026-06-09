import type { HistoryPositionRaw, HistoryTradeRaw } from '../../lib/bitunix/types'
import { toNum } from '../../lib/format'

export interface ClosedPosition {
  positionId: string
  symbol: string
  side: 'LONG' | 'SHORT'
  leverage: number
  qty: number
  entryPrice: number
  closePrice: number
  grossPnl: number
  fee: number
  funding: number
  netPnl: number
  openTime: number
  closeTime: number
  holdMs: number
}

export function normalizePositions(rows: HistoryPositionRaw[]): ClosedPosition[] {
  return rows
    .map((r) => {
      const grossPnl = toNum(r.realizedPNL)
      const fee = toNum(r.fee)
      const funding = toNum(r.funding)
      return {
        positionId: r.positionId,
        symbol: r.symbol,
        side: r.side,
        leverage: r.leverage,
        qty: toNum(r.maxQty),
        entryPrice: toNum(r.entryPrice),
        closePrice: toNum(r.closePrice),
        grossPnl,
        fee,
        funding,
        // Net = gross trading PnL + funding received/paid - transaction fees.
        netPnl: grossPnl + funding - fee,
        openTime: toNum(r.ctime),
        closeTime: toNum(r.mtime),
        holdMs: Math.max(0, toNum(r.mtime) - toNum(r.ctime)),
      }
    })
    .sort((a, b) => a.closeTime - b.closeTime)
}

export interface EquityPoint {
  time: number
  equity: number
  drawdown: number
}

export interface PositionStats {
  count: number
  wins: number
  losses: number
  winRate: number
  totalNet: number
  totalGross: number
  totalFees: number
  totalFunding: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  expectancy: number
  bestTrade: number
  worstTrade: number
  largestWinStreak: number
  largestLossStreak: number
  maxDrawdown: number
  maxDrawdownPct: number
  avgHoldMs: number
  equityCurve: EquityPoint[]
}

export function computePositionStats(positions: ClosedPosition[]): PositionStats {
  const count = positions.length
  const winsArr = positions.filter((p) => p.netPnl > 0)
  const lossArr = positions.filter((p) => p.netPnl < 0)
  const totalNet = sum(positions.map((p) => p.netPnl))
  const totalGross = sum(positions.map((p) => p.grossPnl))
  const totalFees = sum(positions.map((p) => p.fee))
  const totalFunding = sum(positions.map((p) => p.funding))
  const grossWin = sum(winsArr.map((p) => p.netPnl))
  const grossLoss = sum(lossArr.map((p) => p.netPnl))

  let equity = 0
  let peak = 0
  let maxDd = 0
  const equityCurve: EquityPoint[] = []
  for (const p of positions) {
    equity += p.netPnl
    if (equity > peak) peak = equity
    const dd = equity - peak
    if (dd < maxDd) maxDd = dd
    equityCurve.push({ time: p.closeTime, equity, drawdown: dd })
  }

  let winStreak = 0
  let lossStreak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  for (const p of positions) {
    if (p.netPnl > 0) {
      winStreak++
      lossStreak = 0
      maxWinStreak = Math.max(maxWinStreak, winStreak)
    } else if (p.netPnl < 0) {
      lossStreak++
      winStreak = 0
      maxLossStreak = Math.max(maxLossStreak, lossStreak)
    }
  }

  const winRate = count ? winsArr.length / count : 0
  const avgWin = winsArr.length ? grossWin / winsArr.length : 0
  const avgLoss = lossArr.length ? grossLoss / lossArr.length : 0

  return {
    count,
    wins: winsArr.length,
    losses: lossArr.length,
    winRate,
    totalNet,
    totalGross,
    totalFees,
    totalFunding,
    avgWin,
    avgLoss,
    profitFactor: grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : grossWin > 0 ? Infinity : 0,
    expectancy: count ? totalNet / count : 0,
    bestTrade: count ? Math.max(...positions.map((p) => p.netPnl)) : 0,
    worstTrade: count ? Math.min(...positions.map((p) => p.netPnl)) : 0,
    largestWinStreak: maxWinStreak,
    largestLossStreak: maxLossStreak,
    maxDrawdown: maxDd,
    maxDrawdownPct: peak > 0 ? (maxDd / peak) * 100 : 0,
    avgHoldMs: count ? sum(positions.map((p) => p.holdMs)) / count : 0,
    equityCurve,
  }
}

export interface SymbolBreakdown {
  symbol: string
  net: number
  count: number
  wins: number
  winRate: number
}

export function bySymbol(positions: ClosedPosition[]): SymbolBreakdown[] {
  const map = new Map<string, SymbolBreakdown>()
  for (const p of positions) {
    const cur = map.get(p.symbol) ?? { symbol: p.symbol, net: 0, count: 0, wins: 0, winRate: 0 }
    cur.net += p.netPnl
    cur.count += 1
    if (p.netPnl > 0) cur.wins += 1
    map.set(p.symbol, cur)
  }
  const arr = [...map.values()]
  for (const s of arr) s.winRate = s.count ? s.wins / s.count : 0
  return arr.sort((a, b) => b.net - a.net)
}

export interface SideBreakdown {
  side: 'LONG' | 'SHORT'
  net: number
  count: number
  wins: number
  winRate: number
}

export function bySide(positions: ClosedPosition[]): SideBreakdown[] {
  const sides: ('LONG' | 'SHORT')[] = ['LONG', 'SHORT']
  return sides.map((side) => {
    const subset = positions.filter((p) => p.side === side)
    const wins = subset.filter((p) => p.netPnl > 0).length
    return {
      side,
      net: sum(subset.map((p) => p.netPnl)),
      count: subset.length,
      wins,
      winRate: subset.length ? wins / subset.length : 0,
    }
  })
}

/** [day-of-week 0..6][hour 0..23] net PnL grid, keyed on close time. */
export function timeHeatmap(positions: ClosedPosition[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const p of positions) {
    const d = new Date(p.closeTime)
    grid[d.getDay()][d.getHours()] += p.netPnl
  }
  return grid
}

export interface HoldBucket {
  label: string
  count: number
  net: number
}

export function holdingDistribution(positions: ClosedPosition[]): HoldBucket[] {
  const buckets: { label: string; max: number }[] = [
    { label: '<5m', max: 5 * 60_000 },
    { label: '5–30m', max: 30 * 60_000 },
    { label: '30m–1h', max: 60 * 60_000 },
    { label: '1–4h', max: 4 * 3600_000 },
    { label: '4–12h', max: 12 * 3600_000 },
    { label: '12–24h', max: 24 * 3600_000 },
    { label: '>1d', max: Infinity },
  ]
  const out: HoldBucket[] = buckets.map((b) => ({ label: b.label, count: 0, net: 0 }))
  for (const p of positions) {
    const idx = buckets.findIndex((b) => p.holdMs < b.max)
    const i = idx === -1 ? buckets.length - 1 : idx
    out[i].count += 1
    out[i].net += p.netPnl
  }
  return out
}

export interface TradeStats {
  count: number
  volume: number
  fees: number
  realizedPnl: number
  takers: number
  makers: number
}

export function computeTradeStats(trades: HistoryTradeRaw[]): TradeStats {
  let volume = 0
  let fees = 0
  let realized = 0
  let takers = 0
  let makers = 0
  for (const t of trades) {
    volume += toNum(t.qty) * toNum(t.price)
    fees += toNum(t.fee)
    realized += toNum(t.realizedPNL)
    if ((t.roleType || '').toUpperCase() === 'TAKER') takers += 1
    else if ((t.roleType || '').toUpperCase() === 'MAKER') makers += 1
  }
  return { count: trades.length, volume, fees, realizedPnl: realized, takers, makers }
}

function sum(arr: number[]): number {
  let s = 0
  for (const x of arr) s += x
  return s
}
