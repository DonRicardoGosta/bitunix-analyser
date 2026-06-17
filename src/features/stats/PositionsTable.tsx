import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { PendingPositionRaw, TpslOrderRaw } from '../../lib/bitunix/types'
import { useTickers } from '../../store/tickers'
import { useCredentials } from '../../store/credentials'
import { flashClosePosition, modifyTpslOrder, placePositionTpsl } from '../../lib/bitunix/rest'
import { roundToPrecision } from '../analysis/setup/order'
import { Badge, EmptyState } from '../../components/ui/primitives'
import { fmtPrice, fmtSignedUsd, fmtUsd, pnlColor, toNum } from '../../lib/format'
import { positionOutcome, type PositionTpsl } from './positions'
import type { PositionReview } from './review'
import type { StopSuggestion } from './stopSuggest'

interface TightenTarget {
  position: PendingPositionRaw
  suggestion: StopSuggestion
}

function decimalsOf(v: string | number | undefined): number {
  if (v === undefined) return 2
  const s = String(v)
  const i = s.indexOf('.')
  return i === -1 ? 0 : Math.min(s.length - i - 1, 10)
}

function normalizeStopType(v: string | undefined): 'MARK_PRICE' | 'LAST_PRICE' {
  return v === 'MARK_PRICE' ? 'MARK_PRICE' : 'LAST_PRICE'
}

export function PositionsTable({
  positions,
  tpslMap,
  reviews,
  stopSuggestions,
  slOrders,
}: {
  positions: PendingPositionRaw[]
  tpslMap: Record<string, PositionTpsl>
  reviews?: Record<string, PositionReview>
  stopSuggestions?: Record<string, StopSuggestion | null>
  slOrders?: Record<string, TpslOrderRaw>
}) {
  const tickers = useTickers((s) => s.map)
  const hasKeys = useCredentials((s) => s.hasKeys())
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<PendingPositionRaw | null>(null)
  const [tighten, setTighten] = useState<TightenTarget | null>(null)

  const closeMut = useMutation({
    mutationFn: (positionId: string) => flashClosePosition(positionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendingPositions'] })
      qc.invalidateQueries({ queryKey: ['positionTpsl'] })
      qc.invalidateQueries({ queryKey: ['account'] })
      setConfirm(null)
    },
  })

  const tightenMut = useMutation({
    mutationFn: async ({ position, suggestion }: TightenTarget) => {
      const slOrder = slOrders?.[position.positionId]
      const dec = decimalsOf(slOrder?.slPrice ?? position.avgOpenPrice)
      const slPrice = String(roundToPrecision(suggestion.price, dec))
      if (slOrder) {
        await modifyTpslOrder({
          orderId: slOrder.id,
          slPrice,
          slStopType: normalizeStopType(slOrder.slStopType),
          slQty: slOrder.slQty || position.qty,
          ...(toNum(slOrder.tpPrice, 0) > 0
            ? {
                tpPrice: slOrder.tpPrice,
                tpStopType: normalizeStopType(slOrder.tpStopType),
                tpQty: slOrder.tpQty || position.qty,
              }
            : {}),
        })
      } else {
        await placePositionTpsl({
          symbol: position.symbol,
          positionId: position.positionId,
          slPrice,
          slStopType: 'LAST_PRICE',
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positionTpsl'] })
      qc.invalidateQueries({ queryKey: ['pendingPositions'] })
      setTighten(null)
    },
  })

  if (!positions.length) {
    return <EmptyState title="No open positions" hint="Open positions will appear here in real time." />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-2">Symbol</th>
            <th className="px-2 py-2">Side</th>
            <th className="px-2 py-2">Signal</th>
            <th className="px-2 py-2 text-right">Size</th>
            <th className="px-2 py-2 text-right">Entry</th>
            <th className="px-2 py-2 text-right">Mark</th>
            <th className="px-2 py-2 text-right">TP</th>
            <th className="px-2 py-2 text-right">SL</th>
            <th className="px-2 py-2 text-right">Liq.</th>
            <th className="px-2 py-2 text-right">Lev.</th>
            <th className="px-2 py-2 text-right">Margin</th>
            <th className="px-2 py-2 text-right">uPnL</th>
            <th className="px-2 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mark = tickers[p.symbol]?.last ?? toNum(p.avgOpenPrice)
            const liq = toNum(p.liqPrice)
            const upnl = toNum(p.unrealizedPNL)
            const margin = toNum(p.margin)
            const roi = margin > 0 ? (upnl / margin) * 100 : null
            const o = positionOutcome(p, tpslMap[p.positionId], mark)
            const review = reviews?.[p.positionId]
            const suggestion = stopSuggestions?.[p.positionId] ?? null
            const closing = closeMut.isPending && closeMut.variables === p.positionId
            const tightening = tightenMut.isPending && tightenMut.variables?.position.positionId === p.positionId
            return (
              <tr key={p.positionId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-2 py-2 font-medium text-zinc-100">{p.symbol}</td>
                <td className="px-2 py-2">
                  <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side}</Badge>
                </td>
                <td className="px-2 py-2">
                  {review && review.verdict !== 'unknown' ? (
                    <span title={review.reasons.join(' · ')} className="cursor-default">
                      <Badge tone={review.tone}>{review.label}</Badge>
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.qty)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.avgOpenPrice)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(mark)}</td>
                <td className="px-2 py-2 text-right tabular text-emerald-300/80">
                  {o.tpPrice !== null ? fmtPrice(o.tpPrice) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-rose-300/80">
                  <span className="inline-flex items-center justify-end gap-1">
                    {o.slPrice !== null ? fmtPrice(o.slPrice) : '—'}
                    {suggestion && (
                      <span
                        title={`Stop is ${suggestion.currentDistAtr.toFixed(1)}× ATR away — far from price`}
                        className="text-amber-400"
                      >
                        ⚠
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular text-amber-300/80">
                  {liq > 0 ? fmtPrice(liq) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-400">{p.leverage}x</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{margin > 0 ? fmtUsd(margin) : '—'}</td>
                <td className={clsx('px-2 py-2 text-right tabular', pnlColor(upnl))}>
                  {fmtSignedUsd(upnl)}
                  {roi !== null && (
                    <span className="ml-1 text-xs opacity-80">
                      ({roi >= 0 ? '+' : ''}{roi.toFixed(1)}%)
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {suggestion && (
                      <button
                        onClick={() => setTighten({ position: p, suggestion })}
                        disabled={!hasKeys || tightening}
                        title={`Pull stop to ${fmtPrice(suggestion.price)} — ${suggestion.reason}`}
                        className="rounded-md border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        {tightening ? 'Moving…' : 'Tighten SL'}
                      </button>
                    )}
                    <button
                      onClick={() => setConfirm(p)}
                      disabled={!hasKeys || closing}
                      className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                    >
                      {closing ? 'Closing…' : 'Close'}
                    </button>
                  </div>
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
      {tightenMut.isError && (
        <div className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {tightenMut.error instanceof Error ? tightenMut.error.message : 'Failed to modify stop-loss'}
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
              <Row label="Margin" value={toNum(confirm.margin) > 0 ? fmtUsd(toNum(confirm.margin)) : '—'} />
              <Row label="uPnL" value={fmtSignedUsd(toNum(confirm.unrealizedPNL))} />
              <Row
                label="ROI"
                value={
                  toNum(confirm.margin) > 0
                    ? `${toNum(confirm.unrealizedPNL) >= 0 ? '+' : ''}${(
                        (toNum(confirm.unrealizedPNL) / toNum(confirm.margin)) *
                        100
                      ).toFixed(1)}%`
                    : '—'
                }
              />
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

      {tighten && (
        <TightenModal
          target={tighten}
          mark={tickers[tighten.position.symbol]?.last ?? toNum(tighten.position.avgOpenPrice)}
          currentSl={positionOutcome(tighten.position, tpslMap[tighten.position.positionId], tickers[tighten.position.symbol]?.last ?? toNum(tighten.position.avgOpenPrice)).slPrice}
          pending={tightenMut.isPending}
          onCancel={() => setTighten(null)}
          onConfirm={() => tightenMut.mutate(tighten)}
        />
      )}
    </div>
  )
}

function TightenModal({
  target,
  mark,
  currentSl,
  pending,
  onCancel,
  onConfirm,
}: {
  target: TightenTarget
  mark: number
  currentSl: number | null
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { position: p, suggestion } = target
  const entry = toNum(p.avgOpenPrice)
  const qty = toNum(p.qty)
  // The protective stop sits below price for a long and above it for a short,
  // so the suggested side is self-consistent regardless of API side labelling.
  const isLong = suggestion.price < mark
  const pnlAt = (price: number) => (isLong ? qty * (price - entry) : qty * (entry - price))
  const curLoss = currentSl !== null ? pnlAt(currentSl) : null
  const newLoss = pnlAt(suggestion.price)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-100">Tighten stop · {p.side} {p.symbol}</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Moves the stop-loss closer to price — {suggestion.reason}. Nothing else about the position changes.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Row label="Mark" value={fmtPrice(mark)} />
          <Row label="Entry" value={fmtPrice(entry)} />
          <Row label="Current SL" value={currentSl !== null ? fmtPrice(currentSl) : '—'} />
          <Row label="New SL" value={fmtPrice(suggestion.price)} />
          <Row label="Distance now" value={`${suggestion.currentDistAtr.toFixed(1)}× ATR`} />
          <Row label="Distance new" value={`${suggestion.newDistAtr.toFixed(1)}× ATR`} />
          {curLoss !== null && <Row label="Risk now" value={fmtSignedUsd(curLoss)} />}
          <Row label="Risk new" value={fmtSignedUsd(newLoss)} />
        </div>
        <p className="mt-3 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          Caps the loss ~{Math.round(suggestion.riskReductionPct * 100)}% tighter. A closer stop is more likely to be hit by normal swings.
        </p>
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
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {pending ? 'Moving…' : 'Move stop-loss'}
          </button>
        </div>
      </div>
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
