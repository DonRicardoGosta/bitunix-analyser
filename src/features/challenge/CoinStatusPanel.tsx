import type { CoinStatus, DecisionAction } from '@shared/challenge/types'
import { Badge } from '../../components/ui/primitives'
import { RISK_META } from './shared'

const ACTION_META: Record<DecisionAction, { label: string; tone: 'up' | 'down' | 'accent' | 'neutral' }> = {
  open_long: { label: 'OPEN LONG', tone: 'up' },
  open_short: { label: 'OPEN SHORT', tone: 'down' },
  close: { label: 'CLOSE', tone: 'accent' },
  hold: { label: 'HOLD', tone: 'neutral' },
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// One coin's live decision state: why it is holding / would open / manages a
// position. Recomputed by the backend each state push.
function CoinStatusCard({ s }: { s: CoinStatus }) {
  const warming = s.candles < s.warmup
  const action = ACTION_META[s.action] ?? ACTION_META.hold
  const primaryReason = s.reasons.at(-1) ?? ''

  // bias -1..+1 -> 0..100 position; gate ticks at +/- trendThreshold.
  const biasPos = ((clamp(s.bias, -1, 1) + 1) / 2) * 100
  const gateLeft = ((1 - clamp(s.trendThreshold, 0, 1)) / 2) * 100
  const gateRight = ((1 + clamp(s.trendThreshold, 0, 1)) / 2) * 100
  const confPos = clamp(s.confidence, 0, 100)
  const confGate = clamp(s.minConfidence, 0, 100)
  const confPass = s.confidence >= s.minConfidence

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-100">{s.symbol}</span>
        <Badge tone={RISK_META[s.riskLevel].tone}>{RISK_META[s.riskLevel].label}</Badge>
        <Badge tone={action.tone}>{action.label}</Badge>
        <span className="text-[11px] text-zinc-600">{s.interval}</span>
        {warming && (
          <span className="text-[11px] text-amber-400">warming up {s.candles}/{s.warmup}</span>
        )}
      </div>

      {/* Reason: why hold / why not open / position management */}
      <p className="mb-2 text-xs text-zinc-400">{primaryReason}</p>

      {/* Bias vs entry threshold */}
      <div className="mb-2">
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Bias</span>
          <span className="tabular text-zinc-300">
            {s.bias.toFixed(2)} <span className="text-zinc-600">/ gate ±{s.trendThreshold.toFixed(2)}</span>
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
          <div className="absolute inset-y-0 w-px bg-amber-500/60" style={{ left: `${gateLeft}%` }} />
          <div className="absolute inset-y-0 w-px bg-amber-500/60" style={{ left: `${gateRight}%` }} />
          <div
            className={'absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded ' + (s.bias >= 0 ? 'bg-emerald-400' : 'bg-rose-400')}
            style={{ left: `calc(${biasPos}% - 2px)` }}
          />
        </div>
      </div>

      {/* Confidence vs gate */}
      <div className="mb-2">
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Confidence</span>
          <span className="tabular text-zinc-300">
            {s.confidence.toFixed(0)}{' '}
            <span className={confPass ? 'text-emerald-400' : 'text-zinc-600'}>/ gate {s.minConfidence.toFixed(0)}</span>
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={'h-full rounded-full ' + (confPass ? 'bg-emerald-500' : 'bg-zinc-500')}
            style={{ width: `${confPos}%` }}
          />
          <div className="absolute inset-y-0 w-px bg-amber-500/70" style={{ left: `${confGate}%` }} />
        </div>
      </div>

      {/* Indicator chips */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span>RSI <span className="text-zinc-300">{s.rsi.toFixed(0)}</span></span>
        <span>trend <span className="text-zinc-300">{s.trend.toFixed(2)}</span></span>
        <span>efficiency <span className="text-zinc-300">{s.efficiency.toFixed(2)}</span></span>
        <span>ATR <span className="text-zinc-300">{s.atr}</span></span>
        {!s.hasPosition && s.cooldownRemainingSec > 0 && (
          <span className="text-amber-400">cooldown {s.cooldownRemainingSec}s</span>
        )}
      </div>

      {/* Position management: PnL between SL and TP */}
      {s.position && <PositionBar p={s.position} />}
    </div>
  )
}

function PositionBar({ p }: { p: NonNullable<CoinStatus['position']> }) {
  const span = p.stopLossPct + p.takeProfitPct
  const zero = span > 0 ? (p.stopLossPct / span) * 100 : 50
  const pos = span > 0 ? clamp(((p.pnlPctOfMargin + p.stopLossPct) / span) * 100, 0, 100) : 50
  const up = p.pnlPctOfMargin >= 0

  return (
    <div className="mt-1 border-t border-zinc-800 pt-2">
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{p.side} PnL</span>
        <span className={'tabular ' + (up ? 'text-emerald-400' : 'text-rose-400')}>
          {up ? '+' : ''}{p.pnlPctOfMargin.toFixed(1)}% of margin
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="absolute inset-y-0 left-0 w-px bg-rose-500/70" title="stop-loss" />
        <div className="absolute inset-y-0 right-0 w-px bg-emerald-500/70" title="take-profit" />
        <div className="absolute inset-y-0 w-px bg-zinc-600" style={{ left: `${zero}%` }} title="entry" />
        <div
          className={'absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded ' + (up ? 'bg-emerald-400' : 'bg-rose-400')}
          style={{ left: `calc(${pos}% - 2px)` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
        <span>SL -{p.stopLossPct.toFixed(0)}%</span>
        <span>TP +{p.takeProfitPct.toFixed(0)}%</span>
      </div>
    </div>
  )
}

export function CoinStatusPanel({ status }: { status: CoinStatus[] }) {
  if (status.length === 0) return null
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {status.map((s) => (
        <CoinStatusCard key={s.symbol} s={s} />
      ))}
    </div>
  )
}
