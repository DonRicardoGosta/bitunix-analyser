import { getCredentials } from '../../store/credentials'
import {
  buildQueryParamsString,
  buildQueryString,
  makeNonce,
  signRequest,
  type QueryParams,
} from './sign'
import type {
  AccountRaw,
  BitunixEnvelope,
  DepthRaw,
  FundingRateRaw,
  HistoryPositionPage,
  HistoryTradePage,
  KlineRaw,
  PendingPositionRaw,
  TickerRaw,
  TradingPairRaw,
} from './types'

// All REST traffic goes through the reverse proxy (nginx in prod, Vite in dev),
// which strips this prefix and forwards to https://fapi.bitunix.com.
const BASE = '/bitunix'

export class BitunixError extends Error {
  code: number
  constructor(code: number, msg: string) {
    super(`Bitunix error ${code}: ${msg}`)
    this.code = code
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new BitunixError(res.status, `HTTP ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as BitunixEnvelope<T>
  if (json.code !== 0) {
    throw new BitunixError(json.code, json.msg || 'request failed')
  }
  return json.data
}

/** Public GET — no signing required. */
export async function publicGet<T>(path: string, params?: QueryParams): Promise<T> {
  const qs = buildQueryString(params)
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  return parseEnvelope<T>(res)
}

/** Private GET — signs the request with the stored API key/secret. */
export async function privateGet<T>(path: string, params?: QueryParams): Promise<T> {
  const { apiKey, secretKey } = getCredentials()
  if (!apiKey || !secretKey) throw new BitunixError(-1, 'API key/secret not set')

  const nonce = makeNonce()
  const timestamp = Date.now().toString()
  const queryParamsStr = buildQueryParamsString(params)
  const sign = await signRequest({
    apiKey,
    secretKey,
    nonce,
    timestamp,
    queryParams: queryParamsStr,
    body: '',
  })

  const qs = buildQueryString(params)
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
      nonce,
      timestamp,
      sign,
      language: 'en-US',
      'Content-Type': 'application/json',
    },
  })
  return parseEnvelope<T>(res)
}

// ---- Public market data ----

export type KlineInterval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '8h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M'

export function getKline(params: {
  symbol: string
  interval: KlineInterval
  limit?: number
  startTime?: number
  endTime?: number
  type?: 'LAST_PRICE' | 'MARK_PRICE'
}): Promise<KlineRaw[]> {
  return publicGet<KlineRaw[]>('/api/v1/futures/market/kline', params)
}

export function getDepth(symbol: string, limit: '1' | '5' | '15' | '50' | 'max' = 'max'): Promise<DepthRaw> {
  return publicGet<DepthRaw>('/api/v1/futures/market/depth', { symbol, limit })
}

export function getTickers(symbols?: string): Promise<TickerRaw[]> {
  return publicGet<TickerRaw[]>('/api/v1/futures/market/tickers', symbols ? { symbols } : undefined)
}

export function getFundingRate(symbol: string): Promise<FundingRateRaw[]> {
  return publicGet<FundingRateRaw[]>('/api/v1/futures/market/funding_rate', { symbol })
}

export function getTradingPairs(): Promise<TradingPairRaw[]> {
  return publicGet<TradingPairRaw[]>('/api/v1/futures/market/trading_pairs')
}

// ---- Private account / trading data ----

export function getAccount(marginCoin = 'USDT'): Promise<AccountRaw[]> {
  return privateGet<AccountRaw[]>('/api/v1/futures/account', { marginCoin })
}

export function getPendingPositions(symbol?: string): Promise<PendingPositionRaw[]> {
  return privateGet<PendingPositionRaw[]>(
    '/api/v1/futures/position/get_pending_positions',
    symbol ? { symbol } : undefined,
  )
}

export function getHistoryPositions(params?: {
  symbol?: string
  startTime?: number
  endTime?: number
  skip?: number
  limit?: number
}): Promise<HistoryPositionPage> {
  return privateGet<HistoryPositionPage>('/api/v1/futures/position/get_history_positions', params)
}

export function getHistoryTrades(params?: {
  symbol?: string
  startTime?: number
  endTime?: number
  skip?: number
  limit?: number
}): Promise<HistoryTradePage> {
  return privateGet<HistoryTradePage>('/api/v1/futures/trade/get_history_trades', params)
}

/** Lightweight connection test used by the Settings page. */
export async function testConnection(marginCoin = 'USDT'): Promise<AccountRaw> {
  const data = await getAccount(marginCoin)
  const acct = Array.isArray(data) ? data[0] : (data as unknown as AccountRaw)
  if (!acct) throw new BitunixError(-1, 'No account data returned')
  return acct
}
