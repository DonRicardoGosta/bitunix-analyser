import type {
  ChallengeConfigInput,
  MinMarginResult,
  ValidateConfigResult,
  ValidationError,
} from '@shared/challenge/types'
import { toNum } from '@shared/num'
import { getTickers, getTradingPairs } from '../bitunix/rest'

// Capital validation + minimum-margin computation (item 3). Shared by the
// validate-config / min-margin REST endpoints and by the manager before start.

interface MarketSnapshot {
  price: Map<string, number>
  minQty: Map<string, number>
}

async function loadMarket(): Promise<MarketSnapshot> {
  const [pairs, tickers] = await Promise.all([getTradingPairs(), getTickers()])
  const minQty = new Map<string, number>()
  for (const p of pairs) minQty.set(p.symbol, toNum(p.minTradeVolume, 0))
  const price = new Map<string, number>()
  for (const t of tickers) price.set(t.symbol, toNum(t.lastPrice) || toNum(t.markPrice))
  return { price, minQty }
}

function minMarginFrom(symbol: string, leverage: number, market: MarketSnapshot): MinMarginResult {
  const price = market.price.get(symbol) ?? 0
  const minQty = market.minQty.get(symbol) ?? 0
  const minNotional = minQty * price
  const lev = leverage > 0 ? leverage : 1
  const minMargin = minNotional / lev
  return { symbol, minQty, minNotional, minMargin, price }
}

/** Smallest viable margin for one order of `symbol` at `leverage`. */
export async function computeMinMargin(symbol: string, leverage: number): Promise<MinMarginResult> {
  const market = await loadMarket()
  return minMarginFrom(symbol, leverage, market)
}

/**
 * Validate a challenge config against an available balance.
 * `availableBalance` is the account available (Live) or the virtual start
 * balance (Paper).
 */
export async function validateConfig(
  config: ChallengeConfigInput,
  availableBalance: number,
): Promise<ValidateConfigResult> {
  const errors: ValidationError[] = []
  const market = await loadMarket()

  if (!config.coins || config.coins.length === 0) {
    errors.push({ code: 'NO_COINS', message: 'Add at least one coin to the challenge.' })
  }

  const seen = new Set<string>()
  let totalMarginRequired = 0
  for (const coin of config.coins ?? []) {
    const sym = coin.symbol.toUpperCase()
    if (seen.has(sym)) {
      errors.push({ code: 'DUPLICATE_SYMBOL', message: `${sym} is listed more than once.`, symbol: sym })
    }
    seen.add(sym)
    if (!(coin.leverage > 0) || !(coin.orderQty > 0) || !(coin.marginAllocated > 0)) {
      errors.push({
        code: 'INVALID_FIELD',
        message: `${sym}: leverage, order size and margin must be positive.`,
        symbol: sym,
      })
      continue
    }
    totalMarginRequired += coin.marginAllocated
    const mm = minMarginFrom(sym, coin.leverage, market)
    if (mm.minMargin > 0 && coin.marginAllocated + 1e-9 < mm.minMargin) {
      errors.push({
        code: 'BELOW_MIN_MARGIN',
        message: `${sym}: margin ${coin.marginAllocated.toFixed(2)} below minimum ${mm.minMargin.toFixed(2)} USDT.`,
        symbol: sym,
      })
    }
  }

  const usagePct = config.maxAccountUsagePct > 0 ? config.maxAccountUsagePct : 100
  const maxUsable = (availableBalance * usagePct) / 100
  if (totalMarginRequired > maxUsable + 1e-9) {
    errors.push({
      code: 'INSUFFICIENT_CAPITAL',
      message: `Total margin ${totalMarginRequired.toFixed(2)} exceeds usable ${maxUsable.toFixed(2)} USDT (${usagePct}% of ${availableBalance.toFixed(2)}).`,
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    totalMarginRequired,
    availableBalance,
    maxUsable,
  }
}
