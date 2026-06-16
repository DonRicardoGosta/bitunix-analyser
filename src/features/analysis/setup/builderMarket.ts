import { getTickers } from '../../../lib/bitunix/rest'
import { toNum } from '../../../lib/format'
import { useTickers } from '../../../store/tickers'

/** Best-effort live last price for order placement (ticker cache, then REST). */
export async function fetchLivePrice(symbol: string): Promise<number> {
  const cached = useTickers.getState().map[symbol]?.last
  if (cached && cached > 0) return cached

  try {
    const rows = await getTickers(symbol)
    const row = rows.find((r) => r.symbol === symbol) ?? rows[0]
    const last = row ? toNum(row.lastPrice) : 0
    return last > 0 ? last : 0
  } catch {
    return 0
  }
}

export function cachedLivePrice(symbol: string): number {
  return useTickers.getState().map[symbol]?.last ?? 0
}
