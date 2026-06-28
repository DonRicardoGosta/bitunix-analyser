import type { RiskLevel } from '@shared/challenge/types'
import { atr, efficiencyRatio, ema, rsi } from '@shared/indicators'
import type { KlineInterval } from '@shared/market/intervals'
import { clamp } from '@shared/num'
import { resolveTier, standardRiskTiers } from './params'
import type { Decision, RiskParams, Strategy, StrategyContext } from './types'

// Trend-following strategy engine ported in spirit from the SPA's setup engine:
// EMA trend + RSI momentum + Kaufman efficiency (regime) -> a -1..+1 bias and a
// 0..100 confidence. Entries require trend + confidence over the risk-level
// gates; exits use margin-percent TP/SL plus a trend-reversal flip.

export interface TrendStrategyConfig {
  id: string
  symbols?: string[]
  interval: KlineInterval
  emaFast: number
  emaSlow: number
  rsiPeriod: number
  atrPeriod: number
  warmup: number
  base: RiskParams
}

function lastDefined(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i]
    if (v !== null && Number.isFinite(v)) return v
  }
  return null
}

/** EMA-separation + price-location trend score in -1..+1. */
function trendValue(fast: number | null, slow: number | null, price: number): number {
  if (fast === null || slow === null || slow === 0) return 0
  const separation = (fast - slow) / slow
  const location = (price - slow) / slow
  return clamp(separation * 8 + location * 4, -1, 1)
}

export function createTrendStrategy(cfg: TrendStrategyConfig): Strategy {
  const tiers = standardRiskTiers(cfg.base)

  function resolveParams(level: RiskLevel): RiskParams {
    return resolveTier(tiers, level)
  }

  function evaluate(ctx: StrategyContext): Decision {
    const { candles, price, params, position } = ctx
    if (candles.length < cfg.warmup) {
      return { action: 'hold', reasons: [`warming up (${candles.length}/${cfg.warmup} candles)`] }
    }

    const closes = candles.map((c) => c.close)
    const emaFast = lastDefined(ema(closes, cfg.emaFast))
    const emaSlow = lastDefined(ema(closes, cfg.emaSlow))
    const rsiV = lastDefined(rsi(closes, cfg.rsiPeriod)) ?? 50
    const er = efficiencyRatio(closes, 30)
    const atrV = lastDefined(atr(candles, cfg.atrPeriod)) ?? price * 0.01

    const trend = trendValue(emaFast, emaSlow, price)
    const rsiBias = clamp((rsiV - 50) / 30, -1, 1)
    const bias = clamp(trend * 0.7 + rsiBias * 0.3, -1, 1)
    const confidence = clamp(Math.abs(bias) * 70 + er * 30, 0, 100)
    const meta = {
      bias: Number(bias.toFixed(3)),
      confidence: Number(confidence.toFixed(1)),
      trend: Number(trend.toFixed(3)),
      rsi: Number(rsiV.toFixed(1)),
      efficiency: Number(er.toFixed(2)),
      atr: Number(atrV.toFixed(6)),
      emaFast: emaFast !== null ? Number(emaFast.toFixed(6)) : null,
      emaSlow: emaSlow !== null ? Number(emaSlow.toFixed(6)) : null,
      minConfidence: Number(params.minConfidence.toFixed(0)),
      trendThreshold: Number(params.trendThreshold.toFixed(2)),
    }

    // ----- Manage an open position -----
    if (position) {
      const dir = position.side === 'LONG' ? 1 : -1
      const pnlPct = ((price - position.entryPrice) / position.entryPrice) * position.leverage * dir * 100
      const reasons = [`position PnL ${pnlPct.toFixed(2)}% of margin`]

      if (pnlPct >= params.takeProfitPct) {
        reasons.push(`take-profit hit (>= ${params.takeProfitPct.toFixed(0)}%)`)
        return { action: 'close', reasons, confidence, bias, meta }
      }
      if (pnlPct <= -params.stopLossPct) {
        reasons.push(`stop-loss hit (<= -${params.stopLossPct.toFixed(0)}%)`)
        return { action: 'close', reasons, confidence, bias, meta }
      }
      const reversed =
        (position.side === 'LONG' && bias < -params.trendThreshold) ||
        (position.side === 'SHORT' && bias > params.trendThreshold)
      if (reversed) {
        reasons.push(`trend reversed against ${position.side} (bias ${bias.toFixed(2)})`)
        return { action: 'close', reasons, confidence, bias, meta }
      }
      reasons.push('holding: TP/SL not reached, trend intact')
      return { action: 'hold', reasons, confidence, bias, meta }
    }

    // ----- Look for a new entry -----
    const reasons: string[] = [
      `bias ${bias.toFixed(2)} (trend ${trend.toFixed(2)}, rsi ${rsiV.toFixed(0)})`,
      `confidence ${confidence.toFixed(0)} vs gate ${params.minConfidence.toFixed(0)}`,
    ]
    if (confidence < params.minConfidence) {
      reasons.push('skip: confidence below gate')
      return { action: 'hold', reasons, confidence, bias, meta }
    }
    if (bias > params.trendThreshold) {
      reasons.push(`enter LONG (bias > ${params.trendThreshold.toFixed(2)})`)
      return { action: 'open_long', side: 'LONG', reasons, confidence, bias, meta }
    }
    if (bias < -params.trendThreshold) {
      reasons.push(`enter SHORT (bias < -${params.trendThreshold.toFixed(2)})`)
      return { action: 'open_short', side: 'SHORT', reasons, confidence, bias, meta }
    }
    reasons.push(`skip: |bias| below threshold ${params.trendThreshold.toFixed(2)}`)
    return { action: 'hold', reasons, confidence, bias, meta }
  }

  return {
    id: cfg.id,
    symbols: cfg.symbols,
    interval: cfg.interval,
    warmup: cfg.warmup,
    resolveParams,
    evaluate,
  }
}
