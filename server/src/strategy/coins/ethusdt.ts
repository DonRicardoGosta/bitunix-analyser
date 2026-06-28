import { createTrendStrategy } from '../trend'

// ETH: mid-volatility trend follower on the 5m timeframe.
export const ethStrategy = createTrendStrategy({
  id: 'eth-trend',
  symbols: ['ETHUSDT'],
  interval: '5m',
  emaFast: 12,
  emaSlow: 48,
  rsiPeriod: 14,
  atrPeriod: 14,
  warmup: 60,
  base: {
    minConfidence: 56,
    trendThreshold: 0.24,
    takeProfitPct: 65,
    stopLossPct: 40,
    cooldownSec: 120,
  },
})
