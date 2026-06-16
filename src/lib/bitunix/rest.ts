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
  CancelTpslOrderParams,
  DepthRaw,
  FundingRateRaw,
  HistoryPositionPage,
  HistoryTradePage,
  KlineRaw,
  LeverageMarginMode,
  MarginMode,
  ModifyTpslOrderParams,
  OrderResult,
  OrderListPage,
  PendingPositionRaw,
  PlaceOrderParams,
  PlaceTpslOrderParams,
  PositionTpslParams,
  TickerRaw,
  TpslOrderRaw,
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

/**
 * Private POST — the signed body MUST be the exact compact JSON string that is
 * sent, so we stringify once and reuse it for both signing and the request.
 */
export async function privatePost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { apiKey, secretKey } = getCredentials()
  if (!apiKey || !secretKey) throw new BitunixError(-1, 'API key/secret not set')

  const nonce = makeNonce()
  const timestamp = Date.now().toString()
  const bodyStr = JSON.stringify(body) // compact, no spaces
  const sign = await signRequest({
    apiKey,
    secretKey,
    nonce,
    timestamp,
    queryParams: '',
    body: bodyStr,
  })

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      nonce,
      timestamp,
      sign,
      language: 'en-US',
      'Content-Type': 'application/json',
    },
    body: bodyStr,
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

export async function getFundingRate(symbol: string): Promise<FundingRateRaw | null> {
  // The live API returns a single object here, while the docs show an array;
  // normalize both shapes.
  const data = await publicGet<FundingRateRaw | FundingRateRaw[]>(
    '/api/v1/futures/market/funding_rate',
    { symbol },
  )
  if (Array.isArray(data)) return data[0] ?? null
  return data ?? null
}

export function getTradingPairs(symbols?: string): Promise<TradingPairRaw[]> {
  return publicGet<TradingPairRaw[]>(
    '/api/v1/futures/market/trading_pairs',
    symbols ? { symbols } : undefined,
  )
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

export function getPendingOrders(params?: {
  symbol?: string
  orderId?: string
  clientId?: string
  status?: string
  startTime?: number
  endTime?: number
  skip?: number
  limit?: number
}): Promise<OrderListPage> {
  return privateGet<OrderListPage>('/api/v1/futures/trade/get_pending_orders', params)
}

export function getHistoryOrders(params?: {
  symbol?: string
  orderId?: string
  clientId?: string
  status?: string
  type?: string
  startTime?: number
  endTime?: number
  skip?: number
  limit?: number
}): Promise<OrderListPage> {
  return privateGet<OrderListPage>('/api/v1/futures/trade/get_history_orders', params)
}

// ---- Trading (order placement & account settings) ----

export function placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
  return privatePost<OrderResult>('/api/v1/futures/trade/place_order', { ...params })
}

export function changeLeverage(
  symbol: string,
  leverage: number,
  marginCoin = 'USDT',
): Promise<unknown> {
  return privatePost('/api/v1/futures/account/change_leverage', { symbol, leverage, marginCoin })
}

export function changeMarginMode(
  symbol: string,
  marginMode: MarginMode,
  marginCoin = 'USDT',
): Promise<unknown> {
  return privatePost('/api/v1/futures/account/change_margin_mode', { symbol, marginMode, marginCoin })
}

/**
 * Sets the account-wide position mode (ONE_WAY or HEDGE). Hedge mode is the
 * prerequisite for Bitunix "Multi-Trade" and lets you hold long+short at once.
 * Fails (and should be ignored) if positions/orders already exist.
 */
export function changePositionMode(positionMode: 'ONE_WAY' | 'HEDGE'): Promise<unknown> {
  return privatePost('/api/v1/futures/account/change_position_mode', { positionMode })
}

export function getLeverageMarginMode(
  symbol: string,
  marginCoin = 'USDT',
): Promise<LeverageMarginMode> {
  return privateGet<LeverageMarginMode>('/api/v1/futures/account/get_leverage_margin_mode', {
    symbol,
    marginCoin,
  })
}

/** Pending TP/SL trigger orders attached to open positions. */
export function getTpslPending(symbol?: string): Promise<TpslOrderRaw[]> {
  return privateGet<TpslOrderRaw[]>(
    '/api/v1/futures/tpsl/get_pending_orders',
    symbol ? { symbol } : undefined,
  )
}

/** Modify an existing standalone TP/SL trigger order (e.g. move the stop). */
export function modifyTpslOrder(params: ModifyTpslOrderParams): Promise<{ orderId: string }> {
  return privatePost<{ orderId: string }>('/api/v1/futures/tpsl/modify_order', { ...params })
}

/**
 * Place/replace the position-wide TP/SL (closes the whole position at market
 * when triggered). Used as a fallback when a position has no existing SL order.
 */
export function placePositionTpsl(params: PositionTpslParams): Promise<{ orderId: string }> {
  return privatePost<{ orderId: string }>('/api/v1/futures/tpsl/position/place_order', { ...params })
}

/** Place a new TP/SL trigger order (supports partial qty per level). */
export function placeTpslOrder(params: PlaceTpslOrderParams): Promise<{ orderId: string }> {
  return privatePost<{ orderId: string }>('/api/v1/futures/tpsl/place_order', { ...params })
}

/** Cancel a pending TP/SL trigger order. */
export function cancelTpslOrder(params: CancelTpslOrderParams): Promise<{ orderId: string }> {
  return privatePost<{ orderId: string }>('/api/v1/futures/tpsl/cancel_order', { ...params })
}

/** Close an open position at market by its position id. */
export function flashClosePosition(positionId: string): Promise<{ positionId: string }> {
  return privatePost('/api/v1/futures/trade/flash_close_position', { positionId })
}

/** Lightweight connection test used by the Settings page. */
export async function testConnection(marginCoin = 'USDT'): Promise<AccountRaw> {
  const data = await getAccount(marginCoin)
  const acct = Array.isArray(data) ? data[0] : (data as unknown as AccountRaw)
  if (!acct) throw new BitunixError(-1, 'No account data returned')
  return acct
}
