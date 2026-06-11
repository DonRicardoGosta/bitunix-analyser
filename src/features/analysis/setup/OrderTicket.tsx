import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TradePlan } from './engine'
import {
  projectOrder,
  roundToPrecision,
  type TpMode,
} from './order'
import { useSymbolSpecs } from '../useSymbolSpecs'
import { useCredentials } from '../../../store/credentials'
import { useUiPrefs } from '../../../store/uiPrefs'
import {
  changeLeverage,
  changeMarginMode,
  changePositionMode,
  placeOrder,
} from '../../../lib/bitunix/rest'
import type { PlaceOrderParams } from '../../../lib/bitunix/types'
import { Panel } from '../../../components/ui/primitives'
import { fmtPrice, fmtUsd, fmtCompact, pnlColor, toNum } from '../../../lib/format'

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125]

interface Props {
  symbol: string
  side: 'LONG' | 'SHORT'
  onSideChange: (s: 'LONG' | 'SHORT') => void
  long: TradePlan
  short: TradePlan
  currentPrice: number
  positionMode?: string
  availableBalance?: number
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting'; step: string }
  | { kind: 'done'; orderIds: string[] }
  | { kind: 'error'; message: string; orderIds: string[] }

export function OrderTicket({
  symbol,
  side,
  onSideChange,
  long,
  short,
  currentPrice,
  positionMode,
  availableBalance,
}: Props) {
  const plan = side === 'LONG' ? long : short
  const { spec } = useSymbolSpecs(symbol)
  const marginCoin = useCredentials((s) => s.marginCoin)
  const hasKeys = useCredentials((s) => s.hasKeys())
  const liveTradingEnabled = useCredentials((s) => s.liveTradingEnabled)

  // Persisted ticket settings (remembered across navigation/reloads).
  const leverage = useUiPrefs((s) => s.ticketLeverage)
  const margin = useUiPrefs((s) => s.ticketMargin)
  const orderType = useUiPrefs((s) => s.ticketOrderType)
  const marginMode = useUiPrefs((s) => s.ticketMarginMode)
  const tpMode = useUiPrefs((s) => s.ticketTpMode)
  const split = useUiPrefs((s) => s.ticketSplit)
  const setTicket = useUiPrefs((s) => s.setTicket)
  const setLeverage = (v: number) => setTicket({ ticketLeverage: v })
  const setMargin = (v: string) => setTicket({ ticketMargin: v })
  const setOrderType = (v: 'LIMIT' | 'MARKET') => setTicket({ ticketOrderType: v })
  const setMarginMode = (v: 'CROSS' | 'ISOLATION') => setTicket({ ticketMarginMode: v })
  const setTpMode = (v: TpMode) => setTicket({ ticketTpMode: v })
  const setSplit = (v: number) => setTicket({ ticketSplit: v })

  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [tp1, setTp1] = useState('')
  const [tp2, setTp2] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' })

  // Tracks which price fields the user has manually edited; edited fields stop
  // auto-following the live setup until reset or a side change.
  const editedRef = useRef({ entry: false, stop: false, tp1: false, tp2: false })

  // Reset edits when the side or symbol changes.
  useEffect(() => {
    editedRef.current = { entry: false, stop: false, tp1: false, tp2: false }
    setSubmit({ kind: 'idle' })
  }, [side, symbol])

  // Keep un-edited prices in sync with the continuously recomputed plan.
  useEffect(() => {
    const q = spec.quotePrecision
    if (!editedRef.current.entry) setEntry(String(roundToPrecision(plan.entry, q)))
    if (!editedRef.current.stop) setStop(String(roundToPrecision(plan.stop, q)))
    if (!editedRef.current.tp1) setTp1(String(roundToPrecision(plan.tp1, q)))
    if (!editedRef.current.tp2) setTp2(String(roundToPrecision(plan.tp2, q)))
  }, [plan.entry, plan.stop, plan.tp1, plan.tp2, spec.quotePrecision])

  const editPrice = (field: 'entry' | 'stop' | 'tp1' | 'tp2', setter: (v: string) => void) => (v: string) => {
    editedRef.current[field] = true
    setter(v)
  }

  // Clamp leverage into the symbol's allowed range when specs load.
  useEffect(() => {
    const clamped = Math.min(spec.maxLeverage, Math.max(spec.minLeverage, leverage || spec.defaultLeverage))
    if (clamped !== leverage) setTicket({ ticketLeverage: clamped })
  }, [spec.minLeverage, spec.maxLeverage, spec.defaultLeverage, leverage, setTicket])

  const effectiveEntry = orderType === 'MARKET' ? currentPrice : toNum(entry, currentPrice)

  const projection = useMemo(
    () =>
      projectOrder({
        side,
        entry: effectiveEntry,
        stop: toNum(stop),
        tp1: toNum(tp1),
        tp2: toNum(tp2),
        leverage,
        margin: toNum(margin),
        tpMode,
        split,
        spec,
        marginMode,
        availableBalance,
      }),
    [side, effectiveEntry, stop, tp1, tp2, leverage, margin, tpMode, split, spec, marginMode, availableBalance],
  )

  const presets = LEVERAGE_PRESETS.filter((p) => p >= spec.minLeverage && p <= spec.maxLeverage)
  const canSubmit =
    hasKeys && liveTradingEnabled && projection.qty > 0 && projection.warnings.length === 0 && submit.kind !== 'submitting'

  async function doSubmit() {
    setShowConfirm(false)
    const orderIds: string[] = []
    try {
      // Multi-Trade requires Hedge position mode; enable it before opening.
      // (The Multi-Trade toggle itself is manual-only in the Bitunix app.)
      setSubmit({ kind: 'submitting', step: 'Enabling Hedge mode…' })
      let hedge = positionMode === 'HEDGE'
      try {
        await changePositionMode('HEDGE')
        hedge = true
      } catch {
        // Can't switch while positions/orders exist — keep the known mode.
      }

      setSubmit({ kind: 'submitting', step: 'Setting margin mode…' })
      try {
        await changeMarginMode(symbol, marginMode, marginCoin)
      } catch {
        // Margin mode can't change with an open position/order — ignore and continue.
      }

      setSubmit({ kind: 'submitting', step: 'Setting leverage…' })
      await changeLeverage(symbol, leverage, marginCoin)

      const isLong = side === 'LONG'
      const base: Omit<PlaceOrderParams, 'qty' | 'tpPrice'> = {
        symbol,
        side: isLong ? 'BUY' : 'SELL',
        orderType,
        effect: 'GTC',
        slPrice: String(roundToPrecision(toNum(stop), spec.quotePrecision)),
        slStopType: 'LAST_PRICE',
        slOrderType: 'MARKET',
      }
      if (hedge) base.tradeSide = 'OPEN'
      if (orderType === 'LIMIT') base.price = String(roundToPrecision(effectiveEntry, spec.quotePrecision))

      for (let i = 0; i < projection.legs.length; i++) {
        const leg = projection.legs[i]
        if (leg.qty <= 0) continue
        setSubmit({ kind: 'submitting', step: `Placing order ${i + 1}/${projection.legs.length}…` })
        const params: PlaceOrderParams = {
          ...base,
          qty: String(leg.qty),
          tpPrice: String(roundToPrecision(leg.tp, spec.quotePrecision)),
          tpStopType: 'LAST_PRICE',
          tpOrderType: 'MARKET',
        }
        const res = await placeOrder(params)
        if (res?.orderId) orderIds.push(res.orderId)
      }
      setSubmit({ kind: 'done', orderIds })
    } catch (e) {
      setSubmit({ kind: 'error', message: e instanceof Error ? e.message : String(e), orderIds })
    }
  }

  function resetPrices() {
    editedRef.current = { entry: false, stop: false, tp1: false, tp2: false }
    const q = spec.quotePrecision
    setEntry(String(roundToPrecision(plan.entry, q)))
    setStop(String(roundToPrecision(plan.stop, q)))
    setTp1(String(roundToPrecision(plan.tp1, q)))
    setTp2(String(roundToPrecision(plan.tp2, q)))
  }

  return (
    <Panel
      title="Order ticket"
      subtitle="Size the trade, project P&L, and open the position"
      actions={
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
          {(['LONG', 'SHORT'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSideChange(s)}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-semibold',
                side === s
                  ? s === 'LONG'
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'bg-rose-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Inputs */}
        <div className="flex flex-col gap-4">
          {/* Leverage */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Leverage</span>
              <span className="tabular text-sm font-semibold text-cyan-300">{leverage}x</span>
            </div>
            <input
              type="range"
              min={spec.minLeverage}
              max={spec.maxLeverage}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setLeverage(p)}
                  className={clsx(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium',
                    leverage === p ? 'bg-cyan-500/20 text-cyan-300' : 'border border-zinc-800 text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {p}x
                </button>
              ))}
              <input
                type="number"
                min={spec.minLeverage}
                max={spec.maxLeverage}
                value={leverage}
                onChange={(e) =>
                  setLeverage(Math.min(spec.maxLeverage, Math.max(spec.minLeverage, Math.round(Number(e.target.value) || spec.minLeverage))))
                }
                className="w-16 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-xs text-zinc-100 outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-zinc-600">max {spec.maxLeverage}x</span>
            </div>
          </div>

          {/* Margin */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Margin ({marginCoin})</span>
              {availableBalance ? (
                <span className="text-[10px] text-zinc-600">avail {fmtUsd(availableBalance)}</span>
              ) : null}
            </div>
            <input
              type="number"
              min={0}
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
            />
            {availableBalance ? (
              <div className="mt-1 flex gap-1">
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <button
                    key={f}
                    onClick={() => setMargin(String(roundToPrecision(availableBalance * f, 2)))}
                    className="rounded-md border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    {f * 100}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Order type */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Order</span>
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {(['LIMIT', 'MARKET'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    orderType === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {t === 'LIMIT' ? 'Limit' : 'Market'}
                </button>
              ))}
            </div>
            <button onClick={resetPrices} className="ml-auto text-[11px] text-cyan-400 hover:underline">
              reset to setup
            </button>
          </div>

          {/* Margin mode */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Margin mode</span>
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {(['CROSS', 'ISOLATION'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarginMode(m)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    marginMode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {m === 'CROSS' ? 'Cross' : 'Isolated'}
                </button>
              ))}
            </div>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-2 gap-2">
            <PriceInput
              label={orderType === 'MARKET' ? 'Entry (market)' : 'Entry'}
              value={orderType === 'MARKET' ? String(roundToPrecision(currentPrice, spec.quotePrecision)) : entry}
              onChange={editPrice('entry', setEntry)}
              disabled={orderType === 'MARKET'}
            />
            <PriceInput label="Stop loss" value={stop} onChange={editPrice('stop', setStop)} tone="down" />
            <PriceInput label="TP1" value={tp1} onChange={editPrice('tp1', setTp1)} tone="up" />
            <PriceInput label="TP2" value={tp2} onChange={editPrice('tp2', setTp2)} tone="up" />
          </div>

          {/* TP selector */}
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Take profit</div>
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {([
                ['TP1', 'TP1 only'],
                ['TP2', 'TP2 only'],
                ['BOTH', 'Both'],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setTpMode(m)}
                  className={clsx(
                    'flex-1 rounded-md px-2 py-1 text-xs font-medium',
                    tpMode === m ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {tpMode === 'BOTH' && (
              <div className="mt-2">
                <div className="mb-1 flex justify-between text-[10px] text-zinc-500">
                  <span>TP1 {Math.round(split * 100)}%</span>
                  <span>TP2 {Math.round((1 - split) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={Math.round(split * 100)}
                  onChange={(e) => setSplit(Number(e.target.value) / 100)}
                  className="w-full accent-cyan-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* Projection */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Position size" value={`${fmtCompact(projection.qty, 4)} ${spec.symbol.replace(/USDT$/, '')}`} />
            <Stat label="Notional" value={`$${fmtCompact(projection.notional)}`} />
            <Stat label="Est. liq. price" value={fmtPrice(projection.liqPrice)} tone="down" />
            <Stat label="R:R" value={projection.rr ? projection.rr.toFixed(2) : '—'} />
          </div>

          <div className="rounded-lg border border-zinc-800 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Projected P&amp;L</div>
            <div className="flex flex-col gap-1.5 text-sm">
              {projection.legs.map((leg) => (
                <div key={leg.label} className="flex items-center justify-between">
                  <span className="text-zinc-400">
                    {leg.label} @ {fmtPrice(leg.tp)} · {fmtCompact(leg.qty, 4)}
                  </span>
                  <span className={pnlColor(leg.profit)}>+{fmtUsd(leg.profit)}</span>
                </div>
              ))}
              <div className="my-1 h-px bg-zinc-800" />
              <div className="flex items-center justify-between font-medium">
                <span className="text-zinc-300">Total at TP</span>
                <span className={pnlColor(projection.profitTotal)}>
                  +{fmtUsd(projection.profitTotal)} ({projection.profitRoiPct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center justify-between font-medium">
                <span className="text-zinc-300">At stop loss</span>
                <span className="text-rose-400">
                  {fmtUsd(projection.lossPnl)} ({projection.lossRoiPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>

          {projection.warnings.map((w, i) => (
            <p key={`w${i}`} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{w}</p>
          ))}
          {projection.notices.map((n, i) => (
            <p key={`n${i}`} className="rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">{n}</p>
          ))}

          {!hasKeys && (
            <p className="text-xs text-zinc-500">Connect your API key in Settings to enable trading.</p>
          )}
          {hasKeys && !liveTradingEnabled && (
            <p className="text-xs text-amber-300/80">
              Live trading is off. Enable it in Settings to place orders.
            </p>
          )}

          <p className="text-[11px] text-zinc-500">
            Orders open in Hedge mode (set automatically). For multiple same-direction positions per
            pair, enable <span className="text-zinc-300">Multi-Trade</span> once in the Bitunix app —
            it isn't available through the API.
          </p>

          <button
            onClick={() => setShowConfirm(true)}
            disabled={!canSubmit}
            className={clsx(
              'rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40',
              side === 'LONG' ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-rose-500 text-zinc-950 hover:bg-rose-400',
            )}
          >
            {submit.kind === 'submitting' ? submit.step : `Open ${side} on ${symbol}`}
          </button>

          {submit.kind === 'done' && (
            <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Order placed. {submit.orderIds.length ? `IDs: ${submit.orderIds.join(', ')}` : ''}
            </div>
          )}
          {submit.kind === 'error' && (
            <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {submit.message}
              {submit.orderIds.length ? ` (placed: ${submit.orderIds.join(', ')})` : ''}
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <ConfirmModal
          symbol={symbol}
          side={side}
          orderType={orderType}
          marginMode={marginMode}
          leverage={leverage}
          margin={toNum(margin)}
          marginCoin={marginCoin}
          projection={projection}
          onCancel={() => setShowConfirm(false)}
          onConfirm={doSubmit}
        />
      )}
    </Panel>
  )
}

function PriceInput({
  label,
  value,
  onChange,
  tone,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  tone?: 'up' | 'down'
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-sm tabular outline-none focus:border-cyan-500 disabled:opacity-60',
          tone === 'up' && 'text-emerald-300',
          tone === 'down' && 'text-rose-300',
          !tone && 'text-zinc-100',
        )}
      />
    </label>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-lg border border-zinc-800 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={clsx(
          'tabular text-sm font-medium',
          tone === 'up' && 'text-emerald-400',
          tone === 'down' && 'text-rose-400',
          !tone && 'text-zinc-100',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function ConfirmModal({
  symbol,
  side,
  orderType,
  marginMode,
  leverage,
  margin,
  marginCoin,
  projection,
  onCancel,
  onConfirm,
}: {
  symbol: string
  side: 'LONG' | 'SHORT'
  orderType: string
  marginMode: 'CROSS' | 'ISOLATION'
  leverage: number
  margin: number
  marginCoin: string
  projection: ReturnType<typeof projectOrder>
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">
          Confirm {side} · {symbol}
        </h3>
        <p className="mt-1 text-xs text-amber-300/80">
          This places a real {orderType.toLowerCase()} order on Bitunix futures ({marginMode === 'CROSS' ? 'cross' : 'isolated'} {leverage}x, hedge mode).
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Row label="Side" value={side} />
          <Row label="Type" value={orderType} />
          <Row label="Margin mode" value={marginMode === 'CROSS' ? 'Cross' : 'Isolated'} />
          <Row label="Leverage" value={`${leverage}x`} />
          <Row label="Margin" value={`${fmtUsd(margin)} ${marginCoin}`} />
          <Row label="Entry" value={fmtPrice(projection.entry)} />
          <Row label="Stop" value={fmtPrice(projection.stop)} />
          <Row label="Size" value={fmtCompact(projection.qty, 4)} />
          <Row label="Est. liq." value={fmtPrice(projection.liqPrice)} />
        </div>

        <div className="mt-3 rounded-lg border border-zinc-800 p-2 text-xs">
          {projection.legs.map((leg) => (
            <div key={leg.label} className="flex justify-between">
              <span className="text-zinc-400">
                {leg.label} @ {fmtPrice(leg.tp)} ({fmtCompact(leg.qty, 4)})
              </span>
              <span className="text-emerald-400">+{fmtUsd(leg.profit)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1 font-medium">
            <span className="text-zinc-300">Profit / Loss</span>
            <span>
              <span className="text-emerald-400">+{fmtUsd(projection.profitTotal)}</span>
              <span className="text-zinc-600"> / </span>
              <span className="text-rose-400">{fmtUsd(projection.lossPnl)}</span>
            </span>
          </div>
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
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-semibold text-zinc-950',
              side === 'LONG' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400',
            )}
          >
            Confirm {side}
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
