import type {
  BinanceDepth,
  BinancePeriod,
  LongShortPoint,
  OpenInterestPoint,
  TakerVolumePoint,
} from './types'

// Routed through the reverse proxy (nginx/Vite) -> https://fapi.binance.com.
// Binance public market data needs no API key.
const BASE = '/binance'

export class BinanceError extends Error {
  code?: number
  constructor(msg: string, code?: number) {
    super(`Binance error${code !== undefined ? ` ${code}` : ''}: ${msg}`)
    this.code = code
  }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const code = json && typeof json === 'object' ? (json as { code?: number }).code : undefined
    const msg = json && typeof json === 'object' ? (json as { msg?: string }).msg : res.statusText
    throw new BinanceError(msg || `HTTP ${res.status}`, code)
  }
  return json as T
}

export function getDepth(symbol: string, limit = 1000): Promise<BinanceDepth> {
  return get<BinanceDepth>('/fapi/v1/depth', { symbol, limit })
}

export interface PricePoint {
  time: number
  close: number
}

/** Lightweight price series (close) for overlaying on derivative charts. */
export async function getKlineCloses(
  symbol: string,
  interval: string,
  limit = 200,
): Promise<PricePoint[]> {
  const rows = await get<unknown[][]>('/fapi/v1/klines', { symbol, interval, limit })
  return rows.map((r) => ({ time: Number(r[0]), close: Number(r[4]) }))
}

export function getOpenInterestHist(
  symbol: string,
  period: BinancePeriod = '5m',
  limit = 200,
): Promise<OpenInterestPoint[]> {
  return get<OpenInterestPoint[]>('/futures/data/openInterestHist', { symbol, period, limit })
}

export function getGlobalLongShort(
  symbol: string,
  period: BinancePeriod = '5m',
  limit = 200,
): Promise<LongShortPoint[]> {
  return get<LongShortPoint[]>('/futures/data/globalLongShortAccountRatio', { symbol, period, limit })
}

export function getTopTraderLongShort(
  symbol: string,
  period: BinancePeriod = '5m',
  limit = 200,
): Promise<LongShortPoint[]> {
  return get<LongShortPoint[]>('/futures/data/topLongShortPositionRatio', { symbol, period, limit })
}

export function getTakerVolume(
  symbol: string,
  period: BinancePeriod = '5m',
  limit = 200,
): Promise<TakerVolumePoint[]> {
  return get<TakerVolumePoint[]>('/futures/data/takerlongshortRatio', { symbol, period, limit })
}

interface ExchangeInfo {
  symbols: { symbol: string; status: string; contractType: string }[]
}

let symbolSetCache: Set<string> | null = null

/** Returns the set of tradable USD-M perpetual symbols (cached). */
export async function getPerpetualSymbols(): Promise<Set<string>> {
  if (symbolSetCache) return symbolSetCache
  const info = await get<ExchangeInfo>('/fapi/v1/exchangeInfo')
  symbolSetCache = new Set(
    info.symbols
      .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
      .map((s) => s.symbol),
  )
  return symbolSetCache
}

export async function hasSymbol(symbol: string): Promise<boolean> {
  try {
    const set = await getPerpetualSymbols()
    return set.has(symbol)
  } catch {
    // If exchangeInfo is unreachable, optimistically assume it exists.
    return true
  }
}
