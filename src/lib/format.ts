// Display formatting helpers (no business logic).

export function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function fmtNumber(value: number | string | undefined, digits = 2): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Adaptive price formatting: more decimals for tiny prices. */
export function fmtPrice(value: number | string | undefined): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  let digits = 2
  if (abs < 0.0001) digits = 8
  else if (abs < 0.01) digits = 6
  else if (abs < 1) digits = 5
  else if (abs < 100) digits = 4
  else if (abs < 10000) digits = 2
  else digits = 2
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtUsd(value: number | string | undefined, digits = 2): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  return (
    (n < 0 ? '-$' : '$') +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  )
}

export function fmtCompact(value: number | string | undefined, digits = 2): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`
  return `${sign}${abs.toFixed(digits)}`
}

export function fmtPct(value: number | string | undefined, digits = 2): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

export function fmtSignedUsd(value: number | string | undefined, digits = 2): string {
  const n = toNum(value, NaN)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${fmtUsd(n, digits)}`
}

export function fmtTime(ts: number | string | undefined): string {
  const n = toNum(ts, NaN)
  if (!Number.isFinite(n)) return '—'
  return new Date(n).toLocaleString()
}

export function fmtClock(ts: number | string | undefined): string {
  const n = toNum(ts, NaN)
  if (!Number.isFinite(n)) return '—'
  return new Date(n).toLocaleTimeString()
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  const sec = s % 60
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function pnlColor(n: number): string {
  if (n > 0) return 'text-emerald-400'
  if (n < 0) return 'text-rose-400'
  return 'text-zinc-400'
}
