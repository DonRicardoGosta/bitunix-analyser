import type { KlineInterval } from './rest'

export const INTERVALS: KlineInterval[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '1w',
]

const WS_CHANNEL: Record<KlineInterval, string> = {
  '1m': 'market_kline_1min',
  '3m': 'market_kline_3min',
  '5m': 'market_kline_5min',
  '15m': 'market_kline_15min',
  '30m': 'market_kline_30min',
  '1h': 'market_kline_60min',
  '2h': 'market_kline_2h',
  '4h': 'market_kline_4h',
  '6h': 'market_kline_6h',
  '8h': 'market_kline_8h',
  '12h': 'market_kline_12h',
  '1d': 'market_kline_1day',
  '3d': 'market_kline_3day',
  '1w': 'market_kline_1week',
  '1M': 'market_kline_1month',
}

const MARK_WS_CHANNEL: Record<KlineInterval, string> = Object.fromEntries(
  Object.entries(WS_CHANNEL).map(([k, v]) => [k, v.replace('market_', 'mark_')]),
) as Record<KlineInterval, string>

const SECONDS: Record<KlineInterval, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '8h': 28800,
  '12h': 43200,
  '1d': 86400,
  '3d': 259200,
  '1w': 604800,
  '1M': 2592000,
}

export function klineChannel(interval: KlineInterval, mark = false): string {
  return (mark ? MARK_WS_CHANNEL : WS_CHANNEL)[interval]
}

export function intervalSeconds(interval: KlineInterval): number {
  return SECONDS[interval]
}

/** Binance period that best matches a Bitunix interval (for OI / long-short). */
export function toBinancePeriod(interval: KlineInterval): '5m' | '15m' | '30m' | '1h' | '4h' | '1d' {
  switch (interval) {
    case '1m':
    case '5m':
      return '5m'
    case '15m':
      return '15m'
    case '30m':
      return '30m'
    case '1h':
    case '2h':
      return '1h'
    case '4h':
    case '6h':
      return '4h'
    default:
      return '1d'
  }
}
