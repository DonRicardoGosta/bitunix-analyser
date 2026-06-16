import type { PriceLineDragMeta } from '../../../components/charts/chartTypes'
import { fmtPrice, fmtSignedUsd, pnlColor } from '../../../lib/format'
import { positionPnlAt } from '../../stats/positions'

interface Props {
  meta: PriceLineDragMeta
  fromPrice: number
  toPrice: number
  pending: boolean
  error: unknown
  onCancel: () => void
  onConfirm: () => void
}

export function TpslDragConfirmModal({
  meta,
  fromPrice,
  toPrice,
  pending,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const title = meta.kind === 'tp' ? 'Move take-profit?' : 'Move stop-loss?'
  const fromPnl = positionPnlAt(meta.side, meta.entry, fromPrice, meta.qty)
  const toPnl = positionPnlAt(meta.side, meta.entry, toPrice, meta.qty)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">
          {title} · {meta.side} {meta.symbol}
        </h3>
        <p className="mt-1 text-xs text-zinc-400">Confirm the new trigger price on Bitunix.</p>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">Old price</span>
            <span className="tabular text-zinc-200">{fmtPrice(fromPrice)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-zinc-500">New price</span>
            <span className="tabular text-zinc-200">{fmtPrice(toPrice)}</span>
          </div>
          {Number.isFinite(fromPnl) && Number.isFinite(toPnl) && (
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500">Trigger PnL</span>
              <span className="tabular">
                <span className={pnlColor(fromPnl)}>{fmtSignedUsd(fromPnl)}</span>
                <span className="text-zinc-600"> → </span>
                <span className={pnlColor(toPnl)}>{fmtSignedUsd(toPnl)}</span>
              </span>
            </div>
          )}
        </div>

        {!!error && (
          <p className="mt-3 text-xs text-rose-300">
            {error instanceof Error ? error.message : 'Request failed'}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
