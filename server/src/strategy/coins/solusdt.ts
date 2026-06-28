import { createTrendStrategy } from '../trend'

// SOL is more volatile: faster EMAs, a lower entry threshold, and wider TP/SL
// with a shorter cooldown to catch quick swings.
export const solStrategy = createTrendStrategy({
  id: 'sol-trend',
  symbols: ['SOLUSDT'],
  interval: '5m',
  emaFast: 8,
  emaSlow: 34,
  rsiPeriod: 10,
  atrPeriod: 14,
  warmup: 50,
  base: {
    minConfidence: 50,
    trendThreshold: 0.2,
    takeProfitPct: 90,
    stopLossPct: 55,
    cooldownSec: 90,
  },
})
