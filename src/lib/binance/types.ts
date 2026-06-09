// Binance USD-M futures public data types (subset used by the app).

export interface BinanceDepth {
  lastUpdateId: number
  E?: number
  T?: number
  bids: [string, string][]
  asks: [string, string][]
}

export interface OpenInterestPoint {
  symbol: string
  sumOpenInterest: string
  sumOpenInterestValue: string
  timestamp: number
}

export interface LongShortPoint {
  symbol?: string
  pair?: string
  longShortRatio: string
  longAccount: string
  shortAccount: string
  timestamp: number
}

export interface TakerVolumePoint {
  buySellRatio: string
  buyVol: string
  sellVol: string
  timestamp: number | string
}

export interface AggTradeMsg {
  e: 'aggTrade'
  E: number
  s: string
  a: number
  p: string
  q: string
  f: number
  l: number
  T: number
  m: boolean // true = buyer is maker => aggressor is the seller (sell trade)
}

export interface ForceOrderMsg {
  e: 'forceOrder'
  E: number
  o: {
    s: string
    S: 'BUY' | 'SELL'
    o: string
    f: string
    q: string
    p: string
    ap: string
    X: string
    l: string
    z: string
    T: number
  }
}

export type BinancePeriod =
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'

export interface LiquidationEvent {
  time: number
  price: number
  qty: number
  /** Side of the liquidated position: a SELL forceOrder == a long got liquidated. */
  side: 'BUY' | 'SELL'
  liquidatedSide: 'LONG' | 'SHORT'
  notional: number
}
