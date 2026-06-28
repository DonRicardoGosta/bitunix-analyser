import type { RiskLevel } from '@shared/challenge/types'
import { clamp } from '@shared/num'
import type { RiskParams } from './types'

// Per-coin risk-level resolution (item 9). A single "normal" (level 2) base is
// scaled into conservative (1) and aggressive (3) tiers. Level changes apply to
// new decisions only; positions snapshot their params at entry.
export function standardRiskTiers(base: RiskParams): Record<RiskLevel, RiskParams> {
  return {
    1: {
      minConfidence: clamp(base.minConfidence + 15, 0, 100),
      trendThreshold: base.trendThreshold + 0.1,
      takeProfitPct: base.takeProfitPct * 0.6,
      stopLossPct: base.stopLossPct * 0.7,
      cooldownSec: base.cooldownSec * 2,
    },
    2: { ...base },
    3: {
      minConfidence: clamp(base.minConfidence - 15, 0, 100),
      trendThreshold: Math.max(0.05, base.trendThreshold - 0.1),
      takeProfitPct: base.takeProfitPct * 1.5,
      stopLossPct: base.stopLossPct * 1.25,
      cooldownSec: Math.max(15, Math.round(base.cooldownSec * 0.5)),
    },
  }
}

export function resolveTier(
  tiers: Record<RiskLevel, RiskParams>,
  level: RiskLevel,
): RiskParams {
  return tiers[level] ?? tiers[2]
}
