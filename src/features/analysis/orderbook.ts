import type { BinanceDepth } from '../../lib/binance/types'
import { toNum } from '../../lib/format'

export interface Level {
  price: number
  qty: number
}

export interface ParsedBook {
  bids: Level[] // sorted price desc
  asks: Level[] // sorted price asc
  mid: number
  spread: number
  spreadPct: number
}

export function parseDepth(depth: BinanceDepth): ParsedBook {
  const bids = depth.bids
    .map(([p, q]) => ({ price: toNum(p), qty: toNum(q) }))
    .filter((l) => l.qty > 0)
    .sort((a, b) => b.price - a.price)
  const asks = depth.asks
    .map(([p, q]) => ({ price: toNum(p), qty: toNum(q) }))
    .filter((l) => l.qty > 0)
    .sort((a, b) => a.price - b.price)
  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0
  return { bids, asks, mid, spread, spreadPct: mid ? (spread / mid) * 100 : 0 }
}

export interface LiquidityBin {
  price: number
  bidNotional: number
  askNotional: number
}

/**
 * Bins the order book into evenly spaced price levels across +/- windowPct of
 * mid. Each bin carries resting liquidity as USD notional (price * qty).
 */
export function binLiquidity(
  book: ParsedBook,
  windowPct: number,
  bins: number,
): { rows: LiquidityBin[]; maxNotional: number } {
  const { mid } = book
  if (!mid) return { rows: [], maxNotional: 0 }
  const low = mid * (1 - windowPct / 100)
  const high = mid * (1 + windowPct / 100)
  const step = (high - low) / bins
  if (step <= 0) return { rows: [], maxNotional: 0 }

  const rows: LiquidityBin[] = Array.from({ length: bins }, (_, i) => ({
    price: low + step * (i + 0.5),
    bidNotional: 0,
    askNotional: 0,
  }))

  const place = (price: number, notional: number, side: 'bid' | 'ask') => {
    if (price < low || price >= high) return
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((price - low) / step)))
    if (side === 'bid') rows[idx].bidNotional += notional
    else rows[idx].askNotional += notional
  }

  for (const l of book.bids) place(l.price, l.price * l.qty, 'bid')
  for (const l of book.asks) place(l.price, l.price * l.qty, 'ask')

  let maxNotional = 0
  for (const r of rows) maxNotional = Math.max(maxNotional, r.bidNotional, r.askNotional)
  return { rows, maxNotional }
}

export interface CumulativePoint {
  price: number
  cum: number
}

export function cumulativeDepth(
  book: ParsedBook,
  windowPct: number,
): { bids: CumulativePoint[]; asks: CumulativePoint[] } {
  const { mid } = book
  const low = mid * (1 - windowPct / 100)
  const high = mid * (1 + windowPct / 100)
  const bids: CumulativePoint[] = []
  let cum = 0
  for (const l of book.bids) {
    if (l.price < low) break
    cum += l.price * l.qty
    bids.push({ price: l.price, cum })
  }
  bids.reverse()
  const asks: CumulativePoint[] = []
  cum = 0
  for (const l of book.asks) {
    if (l.price > high) break
    cum += l.price * l.qty
    asks.push({ price: l.price, cum })
  }
  return { bids, asks }
}

export interface ImbalanceResult {
  bidNotional: number
  askNotional: number
  total: number
  /** -1 (all asks / sell pressure) .. +1 (all bids / buy pressure). */
  skew: number
  ratio: number
}

export function imbalance(book: ParsedBook, windowPct: number): ImbalanceResult {
  const { mid } = book
  const low = mid * (1 - windowPct / 100)
  const high = mid * (1 + windowPct / 100)
  let bidNotional = 0
  let askNotional = 0
  for (const l of book.bids) {
    if (l.price < low) break
    bidNotional += l.price * l.qty
  }
  for (const l of book.asks) {
    if (l.price > high) break
    askNotional += l.price * l.qty
  }
  const total = bidNotional + askNotional
  const skew = total > 0 ? (bidNotional - askNotional) / total : 0
  const ratio = askNotional > 0 ? bidNotional / askNotional : bidNotional > 0 ? Infinity : 1
  return { bidNotional, askNotional, total, skew, ratio }
}

/** Resting order-book notional (USDT) between two prices on one side of the book. */
export function restingNotionalInBand(
  book: ParsedBook,
  priceLow: number,
  priceHigh: number,
  side: 'support' | 'resistance',
): number {
  const lo = Math.min(priceLow, priceHigh)
  const hi = Math.max(priceLow, priceHigh)
  const levels = side === 'support' ? book.bids : book.asks
  let sum = 0
  for (const l of levels) {
    if (l.price >= lo && l.price <= hi) sum += l.price * l.qty
  }
  return sum
}

/** Compress a parsed book to the nearest N levels per side for storage. */
export function compressForHistory(book: ParsedBook, perSide = 150): {
  bids: [number, number][]
  asks: [number, number][]
  mid: number
} {
  return {
    mid: book.mid,
    bids: book.bids.slice(0, perSide).map((l) => [l.price, l.qty]),
    asks: book.asks.slice(0, perSide).map((l) => [l.price, l.qty]),
  }
}
