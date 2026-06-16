import { useState } from 'react'
import clsx from 'clsx'
import type { ParsedPendingPosition } from '../../stats/positions'
import type { TpslOrderRaw } from '../../../lib/bitunix/types'
import { useCredentials } from '../../../store/credentials'
import { useTickers } from '../../../store/tickers'
import { Badge, Panel } from '../../../components/ui/primitives'
import { fmtPrice, fmtSignedUsd, pnlColor, toNum } from '../../../lib/format'
import { useSymbolSpecs } from '../useSymbolSpecs'
import { groupPositionTpslOrders } from '../../stats/positionChart'
import { usePositionMutations } from '../../stats/usePositionMutations'
import { TpslEditModal, type TpslEditTarget } from './TpslEditModal'

interface Props {
  positions: ParsedPendingPosition[]
  tpslOrders: TpslOrderRaw[] | undefined
}

export function ChartPositionsPanel({ positions, tpslOrders }: Props) {
  const tickers = useTickers((s) => s.map)
  const hasKeys = useCredentials((s) => s.hasKeys())
  const symbol = positions[0]?.symbol ?? ''
  const { spec } = useSymbolSpecs(symbol)
  const { closeMut, cancelTpslMut, isBusy } = usePositionMutations()

  const [editTarget, setEditTarget] = useState<TpslEditTarget | null>(null)
  const [confirmClose, setConfirmClose] = useState<ParsedPendingPosition | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{
    position: ParsedPendingPosition
    orderId: string
    kind: 'tp' | 'sl'
    hasOtherLeg: boolean
  } | null>(null)

  if (positions.length === 0) return null

  return (
    <>
      <Panel title="Open positions" subtitle={`${symbol} — manage TP/SL and close`}>
        <div className="space-y-3">
          {positions.map((p) => {
            const upnl = toNum(p.unrealizedPNL)
            const { tp, sl } = groupPositionTpslOrders(p.positionId, tpslOrders)
            const closing = closeMut.isPending && closeMut.variables === p.positionId

            return (
              <div key={p.positionId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side}</Badge>
                    <span className="text-sm tabular text-zinc-300">Size {fmtPrice(p.qty)}</span>
                    <span className="text-sm tabular text-zinc-400">Entry {fmtPrice(p.avgOpenPrice)}</span>
                    <span className="text-sm tabular text-zinc-400">{p.leverage}x</span>
                  </div>
                  <span className={clsx('text-sm tabular font-medium', pnlColor(upnl))}>
                    {fmtSignedUsd(upnl)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <LevelList
                    title="Take profit"
                    levels={tp}
                    tone="tp"
                    onEdit={(level) =>
                      setEditTarget({ mode: 'edit-tp', position: p, level })
                    }
                    onCancel={(level) =>
                      setCancelTarget({
                        position: p,
                        orderId: level.orderId,
                        kind: 'tp',
                        hasOtherLeg: toNum(level.order.slPrice, 0) > 0,
                      })
                    }
                    disabled={!hasKeys || isBusy}
                  />
                  <LevelList
                    title="Stop loss"
                    levels={sl}
                    tone="sl"
                    onEdit={(level) =>
                      setEditTarget({ mode: 'edit-sl', position: p, level })
                    }
                    onCancel={(level) =>
                      setCancelTarget({
                        position: p,
                        orderId: level.orderId,
                        kind: 'sl',
                        hasOtherLeg: toNum(level.order.tpPrice, 0) > 0,
                      })
                    }
                    disabled={!hasKeys || isBusy}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setEditTarget({ mode: 'add-tp', position: p })}
                    disabled={!hasKeys || isBusy}
                    className="rounded-md border border-cyan-500/40 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40"
                  >
                    Add TP
                  </button>
                  <button
                    onClick={() => setEditTarget({ mode: 'add-sl', position: p })}
                    disabled={!hasKeys || isBusy}
                    className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    Add SL
                  </button>
                  <button
                    onClick={() => setConfirmClose(p)}
                    disabled={!hasKeys || closing || isBusy}
                    className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    {closing ? 'Closing…' : 'Close position'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {(closeMut.isError || cancelTpslMut.isError) && (
          <div className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {(closeMut.error ?? cancelTpslMut.error) instanceof Error
              ? (closeMut.error ?? cancelTpslMut.error)?.message
              : 'Request failed'}
          </div>
        )}
      </Panel>

      {editTarget && (
        <TpslEditModal
          target={editTarget}
          spec={spec}
          mark={tickers[editTarget.position.symbol]?.last ?? toNum(editTarget.position.avgOpenPrice)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {confirmClose && (
        <CloseConfirmModal
          position={confirmClose}
          mark={tickers[confirmClose.symbol]?.last ?? toNum(confirmClose.avgOpenPrice)}
          pending={closeMut.isPending}
          onCancel={() => setConfirmClose(null)}
          onConfirm={() => {
            closeMut.mutate(confirmClose.positionId, { onSuccess: () => setConfirmClose(null) })
          }}
        />
      )}

      {cancelTarget && (
        <CancelConfirmModal
          target={cancelTarget}
          pending={cancelTpslMut.isPending}
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => {
            cancelTpslMut.mutate(
              { symbol: cancelTarget.position.symbol, orderId: cancelTarget.orderId },
              { onSuccess: () => setCancelTarget(null) },
            )
          }}
        />
      )}
    </>
  )
}

function LevelList({
  title,
  levels,
  tone,
  onEdit,
  onCancel,
  disabled,
}: {
  title: string
  levels: ReturnType<typeof groupPositionTpslOrders>['tp']
  tone: 'tp' | 'sl'
  onEdit: (level: (typeof levels)[number]) => void
  onCancel: (level: (typeof levels)[number]) => void
  disabled: boolean
}) {
  return (
    <div>
      <div
        className={clsx(
          'mb-1 text-[11px] font-medium uppercase tracking-wide',
          tone === 'tp' ? 'text-cyan-400/80' : 'text-rose-400/80',
        )}
      >
        {title}
      </div>
      {levels.length === 0 ? (
        <div className="text-xs text-zinc-600">None set</div>
      ) : (
        <ul className="space-y-1">
          {levels.map((level) => (
            <li
              key={`${level.orderId}-${level.kind}-${level.index}`}
              className="flex items-center justify-between gap-2 rounded-md bg-zinc-800/40 px-2 py-1.5 text-xs"
            >
              <span className="tabular text-zinc-200">
                {fmtPrice(level.price)}
                {level.qty > 0 ? ` · ${fmtPrice(level.qty)}` : ''}
              </span>
              <span className="flex gap-1">
                <button
                  onClick={() => onEdit(level)}
                  disabled={disabled}
                  className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  onClick={() => onCancel(level)}
                  disabled={disabled}
                  className="text-zinc-500 hover:text-rose-300 disabled:opacity-40"
                >
                  Cancel
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CloseConfirmModal({
  position,
  mark,
  pending,
  onCancel,
  onConfirm,
}: {
  position: ParsedPendingPosition
  mark: number
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">
          Close {position.side} {position.symbol}?
        </h3>
        <p className="mt-1 text-xs text-zinc-400">Closes the entire position at market on Bitunix.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="Size" value={fmtPrice(position.qty)} />
          <InfoRow label="Entry" value={fmtPrice(position.avgOpenPrice)} />
          <InfoRow label="Mark" value={fmtPrice(mark)} />
          <InfoRow label="uPnL" value={fmtSignedUsd(toNum(position.unrealizedPNL))} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-rose-400 disabled:opacity-50"
          >
            {pending ? 'Closing…' : 'Close at market'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CancelConfirmModal({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: { kind: 'tp' | 'sl'; hasOtherLeg: boolean }
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const leg = target.kind === 'tp' ? 'take-profit' : 'stop-loss'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">Cancel {leg}?</h3>
        <p className="mt-1 text-xs text-zinc-400">
          {target.hasOtherLeg
            ? 'This order also has another trigger leg — cancelling removes the entire TP/SL order.'
            : 'Removes this pending trigger order from Bitunix.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-rose-400 disabled:opacity-50"
          >
            {pending ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-zinc-800/30 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular font-medium text-zinc-200">{value}</span>
    </div>
  )
}
