import type { ChallengeSummary } from '@shared/challenge/types'
import { fmtUsd, fmtSignedUsd, fmtPrice, pnlColor, fmtDuration } from '../../lib/format'
import { Badge, StatCard } from '../../components/ui/primitives'
import { RiskLevelControl } from './RiskLevelControl'
import { useStopChallenge } from './useChallengeData'
import { MODE_META, STATUS_META } from './shared'

export function ChallengeCard({ summary }: { summary: ChallengeSummary }) {
  const stop = useStopChallenge()
  const { run, runtime, positions } = summary
  const status = STATUS_META[run.status]
  const mode = MODE_META[run.config.mode]
  const targetEquity = run.startBalance * (1 + run.config.profitTargetPct / 100)
  const floorEquity = run.startBalance * (1 - run.config.maxLossPct / 100)
  const span = targetEquity - floorEquity
  const progress = span > 0 ? Math.min(100, Math.max(0, ((runtime.equity - floorEquity) / span) * 100)) : 0

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">{run.config.name}</h3>
          <Badge tone={mode.tone}>{mode.label}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">{fmtDuration(Date.now() - run.startedAt)}</span>
          {run.status === 'running' && (
            <button
              type="button"
              onClick={() => stop.mutate(run.id)}
              disabled={stop.isPending}
              className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              {stop.isPending ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Equity" value={fmtUsd(runtime.equity)} sub={`Start ${fmtUsd(run.startBalance)}`} />
        <StatCard
          label="Realized"
          value={fmtSignedUsd(runtime.realizedPnl)}
          tone={runtime.realizedPnl >= 0 ? 'up' : 'down'}
        />
        <StatCard
          label="Unrealized"
          value={fmtSignedUsd(runtime.unrealizedPnl)}
          tone={runtime.unrealizedPnl >= 0 ? 'up' : 'down'}
        />
        <StatCard
          label="Used margin"
          value={fmtUsd(runtime.usedMargin)}
          sub={`${runtime.openPositions} open`}
        />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Floor {fmtUsd(floorEquity)}</span>
          <span>Target {fmtUsd(targetEquity)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {positions.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wide text-zinc-500">
                <th className="py-1.5 pr-3 font-medium">Symbol</th>
                <th className="py-1.5 pr-3 font-medium">Side</th>
                <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 text-right font-medium">Entry</th>
                <th className="py-1.5 pr-3 text-right font-medium">Mark</th>
                <th className="py-1.5 pr-3 text-right font-medium">uPnL</th>
                <th className="py-1.5 pr-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-3 text-zinc-200">{p.symbol}</td>
                  <td className="py-1.5 pr-3">
                    <span className={p.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                      {p.side} {p.leverage}x
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular text-zinc-300">{p.qty}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-zinc-300">{fmtPrice(p.entryPrice)}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-zinc-300">{fmtPrice(p.markPrice)}</td>
                  <td className={'py-1.5 pr-3 text-right tabular ' + pnlColor(p.unrealizedPnl)}>
                    {fmtSignedUsd(p.unrealizedPnl)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {run.status === 'running' ? (
                      <RiskLevelControl challengeId={run.id} symbol={p.symbol} riskLevel={p.riskLevel} />
                    ) : (
                      p.riskLevel
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.closeReason && (
        <p className="mt-3 text-xs text-zinc-500">Reason: {run.closeReason}</p>
      )}
    </div>
  )
}
