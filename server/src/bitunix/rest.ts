// Signed Bitunix futures REST client for Node. Unlike the browser client this
// calls the real host directly (no CORS, no proxy). Mirrors the signing and
// envelope handling of src/lib/bitunix/rest.ts.

import type { KlineInterval } from '@shared/market/intervals'
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
  KlineRaw,
  MarginMode,
  OrderResult,
  PendingPositionRaw,
  PlaceOrderParams,
  TickerRaw,
  TradingPairRaw,
} from './types'

const BASE = 'https://fapi.bitunix.com'

export class BitunixError extends Error {
  code: number
  constructor(code: number, msg: string) {
    super(`Bitunix error ${code}: ${msg}`)
    this.code = code
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  if (!res.ok) throw new BitunixError(res.status, `HTTP ${res.status} ${res.statusText}`)
  const json = (await res.json()) as BitunixEnvelope<T>
  if (json.code !== 0) throw new BitunixError(json.code, json.msg || 'request failed')
  return json.data
}

// ---- Public market data (no signing) ----

export async function publicGet<T>(path: string, params?: QueryParams): Promise<T> {
  const qs = buildQueryString(params)
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  return parseEnvelope<T>(res)
}

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

export function getTickers(symbols?: string): Promise<TickerRaw[]> {
  return publicGet<TickerRaw[]>('/api/v1/futures/market/tickers', symbols ? { symbols } : undefined)
}

export function getTradingPairs(symbols?: string): Promise<TradingPairRaw[]> {
  return publicGet<TradingPairRaw[]>(
    '/api/v1/futures/market/trading_pairs',
    symbols ? { symbols } : undefined,
  )
}

// ---- Signed client (per-credentials) ----

export interface BitunixCredentials {
  apiKey: string
  secretKey: string
  marginCoin?: string
}

export class BitunixRest {
  private readonly apiKey: string
  private readonly secretKey: string
  readonly marginCoin: string

  constructor(creds: BitunixCredentials) {
    this.apiKey = creds.apiKey
    this.secretKey = creds.secretKey
    this.marginCoin = creds.marginCoin || 'USDT'
  }

  private async privateGet<T>(path: string, params?: QueryParams): Promise<T> {
    if (!this.apiKey || !this.secretKey) throw new BitunixError(-1, 'API key/secret not set')
    const nonce = makeNonce()
    const timestamp = Date.now().toString()
    const queryParamsStr = buildQueryParamsString(params)
    const sign = await signRequest({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
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
        'api-key': this.apiKey,
        nonce,
        timestamp,
        sign,
        language: 'en-US',
        'Content-Type': 'application/json',
      },
    })
    return parseEnvelope<T>(res)
  }

  private async privatePost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.apiKey || !this.secretKey) throw new BitunixError(-1, 'API key/secret not set')
    const nonce = makeNonce()
    const timestamp = Date.now().toString()
    const bodyStr = JSON.stringify(body) // compact, no spaces
    const sign = await signRequest({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      nonce,
      timestamp,
      queryParams: '',
      body: bodyStr,
    })
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
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

  getAccount(marginCoin = this.marginCoin): Promise<AccountRaw[]> {
    return this.privateGet<AccountRaw[]>('/api/v1/futures/account', { marginCoin })
  }

  getPendingPositions(symbol?: string): Promise<PendingPositionRaw[]> {
    return this.privateGet<PendingPositionRaw[]>(
      '/api/v1/futures/position/get_pending_positions',
      symbol ? { symbol } : undefined,
    )
  }

  placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    return this.privatePost<OrderResult>('/api/v1/futures/trade/place_order', { ...params })
  }

  changeLeverage(symbol: string, leverage: number, marginCoin = this.marginCoin): Promise<unknown> {
    return this.privatePost('/api/v1/futures/account/change_leverage', { symbol, leverage, marginCoin })
  }

  changeMarginMode(symbol: string, marginMode: MarginMode, marginCoin = this.marginCoin): Promise<unknown> {
    return this.privatePost('/api/v1/futures/account/change_margin_mode', {
      symbol,
      marginMode,
      marginCoin,
    })
  }

  changePositionMode(positionMode: 'ONE_WAY' | 'HEDGE'): Promise<unknown> {
    return this.privatePost('/api/v1/futures/account/change_position_mode', { positionMode })
  }

  flashClosePosition(positionId: string): Promise<{ positionId: string }> {
    return this.privatePost('/api/v1/futures/trade/flash_close_position', { positionId })
  }
}
