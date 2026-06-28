// Normalized OHLCV candle shared by the SPA and the backend.
// `time` is a UNIX timestamp in seconds (matches lightweight-charts).

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
