import { createTrendStrategy } from '../trend'

// BTC trends are cleaner and slower: a higher timeframe, wider EMAs, a stricter
// confidence gate and larger targets.
export const btcStrategy = createTrendStrategy({
  id: 'btc-trend',
  symbols: ['BTCUSDT'],
  interval: '15m',
  emaFast: 21,
  emaSlow: 55,
  rsiPeriod: 14,
  atrPeriod: 14,
  warmup: 80,
  base: {
    minConfidence: 62,
    trendThreshold: 0.3,
    takeProfitPct: 80,
    stopLossPct: 45,
    cooldownSec: 240,
  },
})
