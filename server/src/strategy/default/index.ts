import { createTrendStrategy } from '../trend'

// Generic fallback strategy used for any symbol without a dedicated module.
export const defaultStrategy = createTrendStrategy({
  id: 'default-trend',
  interval: '5m',
  emaFast: 9,
  emaSlow: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  warmup: 60,
  base: {
    minConfidence: 55,
    trendThreshold: 0.25,
    takeProfitPct: 60,
    stopLossPct: 40,
    cooldownSec: 120,
  },
})
