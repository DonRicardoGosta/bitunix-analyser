import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ChallengeRun } from '@shared/challenge/types'
import { fmtUsd, fmtSignedUsd, fmtTime, fmtDuration, pnlColor } from '../../lib/format'
import { Panel, Badge, Spinner, ErrorNote, EmptyState } from '../../components/ui/primitives'
import { CATEGORY_TONE, LEVEL_TONE, MODE_META, RISK_META, STATUS_META } from './shared'
import { useChallengeEvents, useHistory } from './useChallengeData'

export function ChallengeHistoryPage() {
  const history = useHistory()
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Challenge history</h1>
          <p className="mt-0.5 text-sm text-zinc-500">All challenges run by the backend engine.</p>
        </div>
        <Link
          to="/challenge"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Back to engine
        </Link>
      </div>

      <Panel>
        {history.isLoading ? (
          <Spinner label="Loading history…" />
        ) : history.error ? (
          <ErrorNote error={history.error} />
        ) : !history.data || history.data.length === 0 ? (
          <EmptyState title="No challenges yet" hint="Started challenges will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Mode</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Started</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 text-right font-medium">Start</th>
                  <th className="py-2 pr-4 text-right font-medium">Result PnL</th>
                  <th className="py-2 font-medium">Coins</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((run) => (
                  <HistoryRow
                    key={run.id}
                    run={run}
                    open={open === run.id}
                    onToggle={() => setOpen(open === run.id ? null : run.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function HistoryRow({
  run,
  open,
  onToggle,
}: {
  run: ChallengeRun
  open: boolean
  onToggle: () => void
}) {
  const status = STATUS_META[run.status]
  const mode = MODE_META[run.config.mode]
  const end = run.endedAt ?? Date.now()

  return (
    <>
      <tr
        className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/30"
        onClick={onToggle}
      >
        <td className="py-2 pr-4 text-zinc-200">{run.config.name}</td>
        <td className="py-2 pr-4">
          <Badge tone={mode.tone}>{mode.label}</Badge>
        </td>
        <td className="py-2 pr-4">
          <Badge tone={status.tone}>{status.label}</Badge>
        </td>
        <td className="py-2 pr-4 text-zinc-400">{fmtTime(run.startedAt)}</td>
        <td className="py-2 pr-4 text-zinc-400 tabular">{fmtDuration(end - run.startedAt)}</td>
        <td className="py-2 pr-4 text-right text-zinc-300 tabular">{fmtUsd(run.startBalance)}</td>
        <td className={'py-2 pr-4 text-right tabular ' + pnlColor(run.resultPnl)}>
          {fmtSignedUsd(run.resultPnl)}
        </td>
        <td className="py-2 text-zinc-400">{run.config.coins.map((c) => c.symbol).join(', ')}</td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-900 bg-zinc-900/30">
          <td colSpan={8} className="p-4">
            <HistoryDetail run={run} />
          </td>
        </tr>
      )}
    </>
  )
}

function HistoryDetail({ run }: { run: ChallengeRun }) {
  const events = useChallengeEvents(run.id, true)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Configuration
        </h4>
        <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
          <span>Profit target: <span className="text-zinc-200">{run.config.profitTargetPct}%</span></span>
          <span>Max loss: <span className="text-zinc-200">{run.config.maxLossPct}%</span></span>
          <span>Account usage: <span className="text-zinc-200">{run.config.maxAccountUsagePct}%</span></span>
          {run.closeReason && <span>Reason: <span className="text-zinc-200">{run.closeReason}</span></span>}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wide text-zinc-500">
              <th className="py-1 pr-3 font-medium">Symbol</th>
              <th className="py-1 pr-3 font-medium">Lev</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 pr-3 text-right font-medium">Margin</th>
              <th className="py-1 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {run.config.coins.map((c) => (
              <tr key={c.symbol} className="border-t border-zinc-800">
                <td className="py-1 pr-3 text-zinc-200">{c.symbol}</td>
                <td className="py-1 pr-3 text-zinc-300">{c.leverage}x</td>
                <td className="py-1 pr-3 text-right text-zinc-300 tabular">{c.orderQty}</td>
                <td className="py-1 pr-3 text-right text-zinc-300 tabular">{fmtUsd(c.marginAllocated)}</td>
                <td className="py-1 text-zinc-300">{RISK_META[c.riskLevel].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Events</h4>
        {events.isLoading ? (
          <Spinner label="Loading events…" />
        ) : events.error ? (
          <ErrorNote error={events.error} />
        ) : !events.data || events.data.length === 0 ? (
          <p className="text-xs text-zinc-600">No events recorded.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {[...events.data].reverse().map((e) => (
              <div key={e.id} className="flex gap-2 border-b border-zinc-900 py-1">
                <span className="shrink-0 text-zinc-600">{fmtTime(e.ts).split(', ')[1] ?? ''}</span>
                <span className={'shrink-0 uppercase ' + CATEGORY_TONE[e.category]}>{e.category}</span>
                {e.symbol && <span className="shrink-0 text-zinc-500">{e.symbol}</span>}
                <span className={'min-w-0 flex-1 ' + LEVEL_TONE[e.level]}>{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
