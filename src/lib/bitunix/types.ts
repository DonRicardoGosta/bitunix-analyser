// Bitunix futures API response types (subset used by the app).

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

export interface DepthRaw {
  asks: [string, string][]
  bids: [string, string][]
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

export interface FundingRateRaw {
  symbol: string
  markPrice: string
  lastPrice: string
  fundingRate: string
  nextFundingTime: string | number
  fundingInterval: number
  maxFundingRate: string
  minFundingRate: string
}

export interface TradingPairRaw {
  symbol: string
  base: string
  quote: string
  minTradeVolume?: string
  maxLeverage?: string
  pricePrecision?: number
  basePrecision?: number
  quotePrecision?: number
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
  side: 'LONG' | 'SHORT'
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

export interface HistoryPositionRaw {
  positionId: string
  symbol: string
  maxQty: string
  entryPrice: string
  closePrice: string
  liqQty: string
  side: 'LONG' | 'SHORT'
  marginMode: string
  positionMode: string
  leverage: number
  fee: string
  funding: string
  realizedPNL: string
  liqPrice: string
  ctime: number
  mtime: number
}

export interface HistoryPositionPage {
  positionList: HistoryPositionRaw[]
  total: number
}

export interface HistoryTradeRaw {
  tradeId: string
  orderId: string
  symbol: string
  qty: string
  positionMode: string
  marginMode: string
  leverage: number
  price: string
  side: 'BUY' | 'SELL'
  orderType: string
  effect?: string
  clientId?: string
  reduceOnly?: boolean
  fee: string
  realizedPNL: string
  ctime: number
  roleType?: string
}

export interface HistoryTradePage {
  tradeList: HistoryTradeRaw[]
  total: number
}
