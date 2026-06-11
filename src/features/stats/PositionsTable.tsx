import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { PendingPositionRaw } from '../../lib/bitunix/types'
import { useTickers } from '../../store/tickers'
import { useCredentials } from '../../store/credentials'
import { flashClosePosition } from '../../lib/bitunix/rest'
import { Badge, EmptyState } from '../../components/ui/primitives'
import { fmtPrice, fmtSignedUsd, pnlColor, toNum } from '../../lib/format'
import type { PositionTpsl } from './positions'

export function PositionsTable({
  positions,
  tpslMap,
}: {
  positions: PendingPositionRaw[]
  tpslMap: Record<string, PositionTpsl>
}) {
  const tickers = useTickers((s) => s.map)
  const hasKeys = useCredentials((s) => s.hasKeys())
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<PendingPositionRaw | null>(null)

  const closeMut = useMutation({
    mutationFn: (positionId: string) => flashClosePosition(positionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendingPositions'] })
      qc.invalidateQueries({ queryKey: ['positionTpsl'] })
      qc.invalidateQueries({ queryKey: ['account'] })
      setConfirm(null)
    },
  })

  if (!positions.length) {
    return <EmptyState title="No open positions" hint="Open positions will appear here in real time." />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-2">Symbol</th>
            <th className="px-2 py-2">Side</th>
            <th className="px-2 py-2 text-right">Size</th>
            <th className="px-2 py-2 text-right">Entry</th>
            <th className="px-2 py-2 text-right">Mark</th>
            <th className="px-2 py-2 text-right">TP</th>
            <th className="px-2 py-2 text-right">SL</th>
            <th className="px-2 py-2 text-right">Liq.</th>
            <th className="px-2 py-2 text-right">Lev.</th>
            <th className="px-2 py-2 text-right">uPnL</th>
            <th className="px-2 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mark = tickers[p.symbol]?.last ?? toNum(p.avgOpenPrice)
            const liq = toNum(p.liqPrice)
            const upnl = toNum(p.unrealizedPNL)
            const t = tpslMap[p.positionId]
            const closing = closeMut.isPending && closeMut.variables === p.positionId
            return (
              <tr key={p.positionId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-2 py-2 font-medium text-zinc-100">{p.symbol}</td>
                <td className="px-2 py-2">
                  <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side}</Badge>
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.qty)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.avgOpenPrice)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(mark)}</td>
                <td className="px-2 py-2 text-right tabular text-emerald-300/80">
                  {t && Number.isFinite(t.tp) && t.tp > 0 ? fmtPrice(t.tp) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-rose-300/80">
                  {t && Number.isFinite(t.sl) && t.sl > 0 ? fmtPrice(t.sl) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-amber-300/80">
                  {liq > 0 ? fmtPrice(liq) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-400">{p.leverage}x</td>
                <td className={clsx('px-2 py-2 text-right tabular', pnlColor(upnl))}>{fmtSignedUsd(upnl)}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={() => setConfirm(p)}
                    disabled={!hasKeys || closing}
                    className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    {closing ? 'Closing…' : 'Close'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {closeMut.isError && (
        <div className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {closeMut.error instanceof Error ? closeMut.error.message : 'Failed to close position'}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100">Close {confirm.side} {confirm.symbol}?</h3>
            <p className="mt-1 text-xs text-zinc-400">
              This closes the entire position at market on Bitunix futures.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Row label="Size" value={fmtPrice(confirm.qty)} />
              <Row label="Entry" value={fmtPrice(confirm.avgOpenPrice)} />
              <Row label="Mark" value={fmtPrice(tickers[confirm.symbol]?.last ?? toNum(confirm.avgOpenPrice))} />
              <Row label="uPnL" value={fmtSignedUsd(toNum(confirm.unrealizedPNL))} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => closeMut.mutate(confirm.positionId)}
                disabled={closeMut.isPending}
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-rose-400 disabled:opacity-50"
              >
                {closeMut.isPending ? 'Closing…' : 'Close at market'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-zinc-800/30 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular font-medium text-zinc-200">{value}</span>
    </div>
  )
}
