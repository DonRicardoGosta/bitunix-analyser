import type { AccountRaw } from '../../lib/bitunix/types'
import { toNum } from '../../lib/format'
import type { ClosedPosition } from '../stats/compute'

export interface AccountEquity {
  available: number
  margin: number
  frozen: number
  unrealized: number
  wallet: number
  equity: number
}

/**
 * Wallet/equity breakdown from a Bitunix account snapshot. Shared by the Stats
 * and Challenge pages so both agree on what "equity" means.
 */
export function accountEquity(acct?: AccountRaw): AccountEquity {
  const available = toNum(acct?.available)
  const margin = toNum(acct?.margin)
  const frozen = toNum(acct?.frozen)
  const unrealized = toNum(acct?.crossUnrealizedPNL) + toNum(acct?.isolationUnrealizedPNL)
  const wallet = available + margin + frozen
  return { available, margin, frozen, unrealized, wallet, equity: wallet + unrealized }
}

export interface ChallengeConfig {
  /** Equity the challenge started from (USDT). */
  startBalance: number
  /** Profit target as a percentage of the start balance. */
  profitTargetPct: number
  /** Maximum allowed trailing drawdown (% from the peak) before the run fails. */
  maxDrawdownPct: number
  /** Challenge start time (ms); closed trades before this are ignored. */
  startTime: number
  /** Margin committed per trade, as a percentage of current equity. */
  marginPerTradePct: number
  /** Take-profit size as a percentage of the trade margin (100% = margin doubles). */
  takeProfitPct: number
}

export type ChallengeStatus = 'active' | 'passed' | 'failed'

export interface ChallengeEquityPoint {
  time: number
  equity: number
}

export interface ChallengeDay {
  /** Local midnight (ms) of the trading day. */
  day: number
  net: number
  trades: number
}

export interface ChallengeProgress {
  startBalance: number
  equity: number
  profit: number
  profitPct: number
  targetProfit: number
  targetEquity: number
  /** Progress toward the profit target, clamped to 0..1. */
  progress: number
  peakEquity: number
  /** Drawdown floor that fails the run: peak * (1 - maxDrawdownPct / 100). */
  floorEquity: number
  /** Current drawdown vs the peak (<= 0). */
  currentDrawdown: number
  currentDrawdownPct: number
  /** Worst drawdown reached over the challenge window (<= 0). */
  maxDrawdown: number
  maxDrawdownPct: number
  drawdownLimitPct: number
  /** How much of the allowed drawdown buffer has been consumed, 0..100. */
  drawdownUsedPct: number
  /** Gain from one winning trade as a percentage of current equity. */
  perTradeGainPct: number
  /** Gain from one winning trade in USDT, at the current equity. */
  perTradeGainUsd: number
  /**
   * Winning trades (each hitting TP) still needed to reach the target,
   * compounding equity each time. 0 once reached, Infinity if unreachable.
   */
  tradesToTarget: number
  status: ChallengeStatus
  tradeCount: number
  curve: ChallengeEquityPoint[]
  days: ChallengeDay[]
}

/**
 * Evaluate a challenge run against the current account equity and the closed
 * positions inside the challenge window. The equity curve is reconstructed as
 * `startBalance + cumulative realized net PnL`, capped with the live equity
 * snapshot so unrealized PnL and transfers are reflected in the latest point.
 */
export function computeChallenge(
  config: ChallengeConfig,
  equity: number,
  positions: ClosedPosition[],
): ChallengeProgress {
  const startBalance = config.startBalance > 0 ? config.startBalance : 0
  const targetProfit = startBalance * (config.profitTargetPct / 100)
  const targetEquity = startBalance + targetProfit

  const inWindow = positions
    .filter((p) => p.closeTime >= config.startTime)
    .sort((a, b) => a.closeTime - b.closeTime)

  const curve: ChallengeEquityPoint[] = [{ time: config.startTime, equity: startBalance }]
  let running = startBalance
  for (const p of inWindow) {
    running += p.netPnl
    curve.push({ time: p.closeTime, equity: running })
  }
  curve.push({ time: Date.now(), equity })

  let peak = curve[0].equity
  let maxDd = 0
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity
    const dd = pt.equity - peak
    if (dd < maxDd) maxDd = dd
  }

  const currentDrawdown = equity - peak
  const currentDrawdownPct = peak > 0 ? (Math.abs(currentDrawdown) / peak) * 100 : 0
  const maxDrawdownPct = peak > 0 ? (Math.abs(maxDd) / peak) * 100 : 0
  const floorEquity = peak * (1 - config.maxDrawdownPct / 100)

  const profit = equity - startBalance
  const profitPct = startBalance > 0 ? (profit / startBalance) * 100 : 0
  const progress = targetProfit > 0 ? clamp(profit / targetProfit, 0, 1) : 0
  const drawdownUsedPct =
    config.maxDrawdownPct > 0 ? clamp((maxDrawdownPct / config.maxDrawdownPct) * 100, 0, 100) : 0

  // Projection: each winning trade commits `marginPerTradePct` of equity and
  // returns `takeProfitPct` of that margin, so equity compounds by this fraction.
  const perTradeGainFrac = (config.marginPerTradePct / 100) * (config.takeProfitPct / 100)
  const perTradeGainPct = perTradeGainFrac * 100
  const perTradeGainUsd = equity * perTradeGainFrac
  let tradesToTarget: number
  if (targetProfit <= 0 || equity >= targetEquity) tradesToTarget = 0
  else if (perTradeGainFrac <= 0 || equity <= 0) tradesToTarget = Infinity
  else tradesToTarget = Math.ceil(Math.log(targetEquity / equity) / Math.log(1 + perTradeGainFrac))

  let status: ChallengeStatus = 'active'
  if (config.maxDrawdownPct > 0 && maxDrawdownPct >= config.maxDrawdownPct) status = 'failed'
  else if (targetProfit > 0 && equity >= targetEquity) status = 'passed'

  const dayMap = new Map<number, ChallengeDay>()
  for (const p of inWindow) {
    const d = startOfDay(p.closeTime)
    const cur = dayMap.get(d) ?? { day: d, net: 0, trades: 0 }
    cur.net += p.netPnl
    cur.trades += 1
    dayMap.set(d, cur)
  }
  const days = [...dayMap.values()].sort((a, b) => b.day - a.day)

  return {
    startBalance,
    equity,
    profit,
    profitPct,
    targetProfit,
    targetEquity,
    progress,
    peakEquity: peak,
    floorEquity,
    currentDrawdown,
    currentDrawdownPct,
    maxDrawdown: maxDd,
    maxDrawdownPct,
    drawdownLimitPct: config.maxDrawdownPct,
    drawdownUsedPct,
    perTradeGainPct,
    perTradeGainUsd,
    tradesToTarget,
    status,
    tradeCount: inWindow.length,
    curve,
    days,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
