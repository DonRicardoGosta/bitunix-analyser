import 'dotenv/config'

function str(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

function num(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  /** Port the Fastify server listens on (proxied via nginx /api). */
  port: num('PORT', 8090),
  host: str('HOST', '0.0.0.0'),
  /** Directory for the SQLite database + generated encryption key. */
  dataDir: str('DATA_DIR', './data'),
  /** Optional 32-byte key (hex/base64); generated + persisted if absent. */
  encryptionKey: str('CHALLENGE_ENCRYPTION_KEY', ''),
  logLevel: str('LOG_LEVEL', 'info'),
  /** Default margin coin used for account/balance queries. */
  marginCoin: str('MARGIN_COIN', 'USDT'),
  /** Paper-trading taker fee rate (fraction of notional) applied per fill. */
  paperTakerFee: num('PAPER_TAKER_FEE', 0.0006),
  /** Paper-trading slippage (fraction of price) applied against the fill. */
  paperSlippagePct: num('PAPER_SLIPPAGE_PCT', 0.0002),
  /** Min interval between tick-level TP/SL proximity log lines per position. */
  tickLogIntervalMs: num('TICK_LOG_INTERVAL_MS', 8000),
} as const

export type AppConfig = typeof config
