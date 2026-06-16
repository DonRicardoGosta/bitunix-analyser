import { useEffect, useMemo, useState } from 'react'
import type { ParsedPendingPosition } from '../../stats/positions'
import { roundToPrecision } from '../setup/order'
import type { SymbolSpec } from '../setup/order'
import { fmtPrice, fmtSignedUsd, pnlColor, toNum } from '../../../lib/format'
import type { PositionTpslLevel } from '../../stats/positionChart'
import { positionPnlAt } from '../../stats/positions'
import { buildModifyTpslParams, usePositionMutations } from '../../stats/usePositionMutations'

export type TpslEditMode = 'add-tp' | 'add-sl' | 'edit-tp' | 'edit-sl'

export interface TpslEditTarget {
  mode: TpslEditMode
  position: ParsedPendingPosition
  level?: PositionTpslLevel
}

interface Props {
  target: TpslEditTarget
  spec: SymbolSpec
  mark: number
  onClose: () => void
}

function validatePrice(
  side: 'LONG' | 'SHORT',
  kind: 'tp' | 'sl',
  price: number,
  entry: number,
): string | null {
  if (!Number.isFinite(price) || price <= 0) return 'Enter a valid price'
  if (side === 'LONG') {
    if (kind === 'tp' && price <= entry) return 'LONG take-profit must be above entry'
    if (kind === 'sl' && price >= entry) return 'LONG stop-loss must be below entry'
  } else {
    if (kind === 'tp' && price >= entry) return 'SHORT take-profit must be below entry'
    if (kind === 'sl' && price <= entry) return 'SHORT stop-loss must be above entry'
  }
  return null
}

export function TpslEditModal({ target, spec, mark, onClose }: Props) {
  const { mode, position, level } = target
  const kind = mode.endsWith('tp') ? 'tp' : 'sl'
  const isEdit = mode.startsWith('edit')
  const entry = toNum(position.avgOpenPrice)
  const defaultQty = toNum(position.qty)

  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const { addTpslMut, modifyTpslMut } = usePositionMutations()

  useEffect(() => {
    if (isEdit && level) {
      setPrice(String(level.price))
      setQty(level.qty > 0 ? String(level.qty) : String(defaultQty))
    } else {
      setPrice('')
      setQty(String(defaultQty))
    }
  }, [isEdit, level, defaultQty])

  const parsedPrice = toNum(price, NaN)
  const parsedQty = toNum(qty, NaN)
  const validationError = useMemo(
    () => validatePrice(position.side, kind, parsedPrice, entry),
    [position.side, kind, parsedPrice, entry],
  )
  const qtyError =
    !Number.isFinite(parsedQty) || parsedQty <= 0 ? 'Enter a valid quantity' : null
  const triggerPnl = useMemo(() => {
    if (validationError || qtyError) return NaN
    return positionPnlAt(position.side, entry, parsedPrice, parsedQty)
  }, [position.side, entry, parsedPrice, parsedQty, validationError, qtyError])
  const pending = addTpslMut.isPending || modifyTpslMut.isPending
  const error = addTpslMut.error ?? modifyTpslMut.error

  const title =
    mode === 'add-tp'
      ? `Add take-profit · ${position.side} ${position.symbol}`
      : mode === 'add-sl'
        ? `Add stop-loss · ${position.side} ${position.symbol}`
        : mode === 'edit-tp'
          ? `Edit take-profit · ${position.side} ${position.symbol}`
          : `Edit stop-loss · ${position.side} ${position.symbol}`

  const submit = async () => {
    if (validationError || qtyError) return
    const priceStr = String(roundToPrecision(parsedPrice, spec.quotePrecision))
    const qtyStr = String(roundToPrecision(parsedQty, spec.basePrecision))

    if (isEdit && level) {
      await modifyTpslMut.mutateAsync(buildModifyTpslParams(level.order, kind, priceStr, qtyStr))
    } else {
      const base = {
        symbol: position.symbol,
        positionId: position.positionId,
      }
      if (kind === 'tp') {
        await addTpslMut.mutateAsync({
          ...base,
          tpPrice: priceStr,
          tpQty: qtyStr,
          tpStopType: 'LAST_PRICE',
          tpOrderType: 'MARKET',
        })
      } else {
        await addTpslMut.mutateAsync({
          ...base,
          slPrice: priceStr,
          slQty: qtyStr,
          slStopType: 'LAST_PRICE',
          slOrderType: 'MARKET',
        })
      }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Mark {fmtPrice(mark)} · Entry {fmtPrice(entry)}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-500">
            Current uPnL{' '}
            <span className={pnlColor(toNum(position.unrealizedPNL))}>
              {fmtSignedUsd(position.unrealizedPNL)}
            </span>
          </span>
          {Number.isFinite(triggerPnl) && (
            <span className="text-zinc-500">
              Trigger PnL{' '}
              <span className={pnlColor(triggerPnl)}>{fmtSignedUsd(triggerPnl)}</span>
            </span>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs text-zinc-500">
            Trigger price
            <input
              type="number"
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="block text-xs text-zinc-500">
            Quantity (base)
            <input
              type="number"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        </div>

        {(validationError || qtyError) && (
          <p className="mt-2 text-xs text-rose-300">{validationError ?? qtyError}</p>
        )}
        {error && (
          <p className="mt-2 text-xs text-rose-300">
            {error instanceof Error ? error.message : 'Request failed'}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={pending || !!validationError || !!qtyError}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            {pending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
