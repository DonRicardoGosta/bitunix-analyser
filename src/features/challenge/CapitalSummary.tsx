import type { ValidateConfigResult } from '@shared/challenge/types'
import { fmtUsd } from '../../lib/format'
import { Spinner } from '../../components/ui/primitives'

export function CapitalSummary({
  result,
  loading,
  error,
}: {
  result?: ValidateConfigResult
  loading: boolean
  error?: unknown
}) {
  if (loading && !result) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <Spinner label="Validating capital…" />
      </div>
    )
  }
  if (error && !result) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        Capital check unavailable: {msg}
      </div>
    )
  }
  if (!result) return null

  const remaining = result.maxUsable - result.totalMarginRequired
  const usagePct =
    result.maxUsable > 0 ? Math.min(100, (result.totalMarginRequired / result.maxUsable) * 100) : 0
  const over = remaining < 0

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <Cell label="Available" value={fmtUsd(result.availableBalance)} />
        <Cell label="Usable (cap)" value={fmtUsd(result.maxUsable)} />
        <Cell label="Margin required" value={fmtUsd(result.totalMarginRequired)} />
        <Cell label="Remaining" value={fmtUsd(remaining)} tone={over ? 'down' : 'up'} />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Capital committed</span>
          <span className="tabular">{usagePct.toFixed(0)}% of usable</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={'h-full rounded-full transition-all ' + (over ? 'bg-rose-500' : 'bg-emerald-500')}
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {result.errors.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {result.errors.map((e, i) => (
            <li
              key={`${e.code}-${i}`}
              className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300"
            >
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'down' ? 'text-rose-400' : tone === 'up' ? 'text-emerald-400' : 'text-zinc-100'
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={'mt-0.5 text-sm font-semibold tabular ' + color}>{value}</div>
    </div>
  )
}
