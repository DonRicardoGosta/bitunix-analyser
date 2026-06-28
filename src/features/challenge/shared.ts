import type { EventCategory, EventLevel, RiskLevel, RunStatus, TradingMode } from '@shared/challenge/types'

export const INPUT =
  'rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-cyan-500'

export const RISK_LEVELS: RiskLevel[] = [1, 2, 3]

export const RISK_META: Record<RiskLevel, { label: string; tone: 'up' | 'accent' | 'down' }> = {
  1: { label: 'Conservative', tone: 'up' },
  2: { label: 'Normal', tone: 'accent' },
  3: { label: 'Aggressive', tone: 'down' },
}

export const STATUS_META: Record<
  RunStatus,
  { label: string; tone: 'up' | 'down' | 'accent' | 'neutral' }
> = {
  running: { label: 'Running', tone: 'accent' },
  success: { label: 'Success', tone: 'up' },
  failed: { label: 'Failed', tone: 'down' },
  stopped: { label: 'Stopped', tone: 'neutral' },
}

export const MODE_META: Record<TradingMode, { label: string; tone: 'warn' | 'accent' }> = {
  live: { label: 'LIVE', tone: 'warn' },
  paper: { label: 'PAPER', tone: 'accent' },
}

export const CATEGORY_TONE: Record<EventCategory, string> = {
  entry: 'text-emerald-300',
  exit: 'text-cyan-300',
  risk: 'text-amber-300',
  signal: 'text-zinc-300',
  api: 'text-violet-300',
  system: 'text-zinc-400',
}

export const LEVEL_TONE: Record<EventLevel, string> = {
  info: 'text-zinc-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
}
