// Bitunix futures API response types (subset used by the Challenge backend).
// Mirrors src/lib/bitunix/types.ts on the frontend.

export interface BitunixEnvelope<T> {
  code: number
  msg: string
  data: T
}

export interface KlineRaw {
  time: number
  open: string | number
  high: string | number
  low: string | number
  close: string | number
  baseVol: string | number
  quoteVol: string | number
  type?: string
}

export interface TickerRaw {
  symbol: string
  markPrice: string
  lastPrice: string
  open: string
  last: string
  quoteVol: string
  baseVol: string
  high: string
  low: string
}

export interface TradingPairRaw {
  symbol: string
  base: string
  quote: string
  minTradeVolume?: string
  maxLimitOrderVolume?: string
  maxMarketOrderVolume?: string
  basePrecision?: number
  quotePrecision?: number
  maxLeverage?: number | string
  minLeverage?: number | string
  defaultLeverage?: number | string
  defaultMarginMode?: string | number
  symbolStatus?: string
  isApiSupported?: boolean
}

export type OrderSide = 'BUY' | 'SELL'
export type TradeSide = 'OPEN' | 'CLOSE'
export type OrderType = 'LIMIT' | 'MARKET'
export type MarginMode = 'ISOLATION' | 'CROSS'

export interface PlaceOrderParams {
  symbol: string
  qty: string
  side: OrderSide
  tradeSide?: TradeSide
  positionId?: string
  orderType: OrderType
  price?: string
  effect?: 'IOC' | 'FOK' | 'GTC' | 'POST_ONLY'
  reduceOnly?: boolean
  clientId?: string
  tpPrice?: string
  tpStopType?: 'MARK_PRICE' | 'LAST_PRICE'
  tpOrderType?: OrderType
  tpOrderPrice?: string
  slPrice?: string
  slStopType?: 'MARK_PRICE' | 'LAST_PRICE'
  slOrderType?: OrderType
  slOrderPrice?: string
}

export interface OrderResult {
  orderId?: string
  clientId?: string
}

export interface AccountRaw {
  marginCoin: string
  available: string
  frozen: string
  margin: string
  transfer: string
  positionMode: string
  crossUnrealizedPNL: string
  isolationUnrealizedPNL: string
  bonus: string
}

export interface PendingPositionRaw {
  positionId: string
  symbol: string
  qty: string
  entryValue: string
  side: 'LONG' | 'SHORT' | 'BUY' | 'SELL'
  marginMode: string
  positionMode: string
  leverage: number
  fee: string
  funding: string
  realizedPNL: string
  margin: string
  unrealizedPNL: string
  liqPrice: string
  marginRate: string
  avgOpenPrice: string
  ctime: number
  mtime: number
}

export interface LeverageMarginMode {
  symbol: string
  marginCoin: string
  leverage: number
  marginMode: MarginMode
}
