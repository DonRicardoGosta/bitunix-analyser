import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TradePlan, RangeStraddlePlan, RangeStraddleLeg, BacktestStats, PositionBuilderPlan } from './engine'
import { evaluateEntry, type EntryQuality } from './entryQuality'
import {
  projectOrder,
  planBuilderRung,
  marginFromQty,
  qtyFromMargin,
  roundToPrecision,
  floorToPrecision,
  type OrderProjection,
  type BuilderRungSizing,
  type TpMode,
} from './order'
import {
  registerBuilderShedJobs,
  ensureBuilderShedPolling,
  clearFinishedBuilderShedJobs,
  type BuilderShedJobInput,
} from './builderShed'
import {
  registerBuilderTriggerJobs,
  ensureBuilderTriggerPolling,
  processBuilderTriggerJobs,
  getActiveBuilderTriggerJobs,
  clearFinishedBuilderTriggerJobs,
} from './builderTrigger'
import { builderLimitCanRest, builderUsesTriggerEntry } from './builderOrders'
import { fetchLivePrice } from './builderMarket'
import { useBuilderShedWatcher } from './useBuilderShedWatcher'
import { useSymbolSpecs } from '../useSymbolSpecs'
import { useCredentials } from '../../../store/credentials'
import { useUiPrefs, type TicketSizingMode, type TradeMode } from '../../../store/uiPrefs'
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
  straddle: RangeStraddlePlan
  builder: PositionBuilderPlan
  builderSide: 'LONG' | 'SHORT'
  onBuilderSideChange: (s: 'LONG' | 'SHORT') => void
  tradeMode: TradeMode
  onTradeModeChange: (m: TradeMode) => void
  currentPrice: number
  bias: number
  biasLabel: 'LONG' | 'SHORT' | 'NEUTRAL'
  backtest: BacktestStats | null
  positionMode?: string
  availableBalance?: number
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting'; step: string }
  | { kind: 'done'; orderIds: string[]; note?: string }
  | { kind: 'error'; message: string; orderIds: string[] }

export function OrderTicket({
  symbol,
  side,
  onSideChange,
  long,
  short,
  straddle,
  builder,
  builderSide,
  onBuilderSideChange,
  tradeMode,
  onTradeModeChange,
  currentPrice,
  biasLabel,
  backtest,
  positionMode,
  availableBalance,
}: Props) {
  const plan = side === 'LONG' ? long : short
  const both = tradeMode === 'both'
  const isBuilder = tradeMode === 'builder'
  const isSingle = tradeMode === 'single'
  const { spec } = useSymbolSpecs(symbol)
  const marginCoin = useCredentials((s) => s.marginCoin)
  const hasKeys = useCredentials((s) => s.hasKeys())
  const liveTradingEnabled = useCredentials((s) => s.liveTradingEnabled)
  const { activeCount: shedActiveCount, failedCount: shedFailedCount, triggerCount, triggerFailedCount } =
    useBuilderShedWatcher(symbol)

  // Persisted ticket settings (remembered across navigation/reloads).
  const leverage = useUiPrefs((s) => s.ticketLeverage)
  const margin = useUiPrefs((s) => s.ticketMargin)
  const sizingMode = useUiPrefs((s) => s.ticketSizingMode)
  const qty = useUiPrefs((s) => s.ticketQty)
  const orderType = useUiPrefs((s) => s.ticketOrderType)
  const marginMode = useUiPrefs((s) => s.ticketMarginMode)
  const tpMode = useUiPrefs((s) => s.ticketTpMode)
  const split = useUiPrefs((s) => s.ticketSplit)
  const straddleSplit = useUiPrefs((s) => s.ticketStraddleSplit)
  const builderBudget = useUiPrefs((s) => s.ticketBuilderBudget)
  const builderRungsCount = useUiPrefs((s) => s.ticketBuilderRungs)
  const setTicket = useUiPrefs((s) => s.setTicket)
  const setLeverage = (v: number) => setTicket({ ticketLeverage: v })
  const setMargin = (v: string) => setTicket({ ticketMargin: v })
  const setQty = (v: string) => setTicket({ ticketQty: v })
  const setOrderType = (v: 'LIMIT' | 'MARKET') => setTicket({ ticketOrderType: v })
  const setMarginMode = (v: 'CROSS' | 'ISOLATION') => setTicket({ ticketMarginMode: v })
  const setTpMode = (v: TpMode) => setTicket({ ticketTpMode: v })
  const setSplit = (v: number) => setTicket({ ticketSplit: v })
  const setStraddleSplit = (v: number) => setTicket({ ticketStraddleSplit: v })
  const setBuilderBudget = (v: string) => setTicket({ ticketBuilderBudget: v })
  const setBuilderRungs = (v: number) => setTicket({ ticketBuilderRungs: v })

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
  const sizingEntry = both ? currentPrice : effectiveEntry
  const baseSymbol = spec.symbol.replace(/USDT$/, '')

  const effectiveMargin = useMemo(() => {
    if (sizingMode === 'qty') {
      return marginFromQty(toNum(qty), sizingEntry, leverage, spec.quotePrecision)
    }
    return toNum(margin)
  }, [sizingMode, qty, margin, sizingEntry, leverage, spec.quotePrecision])

  const projection = useMemo(
    () =>
      projectOrder({
        side,
        entry: effectiveEntry,
        stop: toNum(stop),
        tp1: toNum(tp1),
        tp2: toNum(tp2),
        leverage,
        margin: effectiveMargin,
        tpMode,
        split,
        spec,
        marginMode,
        availableBalance,
      }),
    [side, effectiveEntry, stop, tp1, tp2, leverage, effectiveMargin, tpMode, split, spec, marginMode, availableBalance],
  )

  // Live entry-quality read for the single-direction trade: is *now* a good
  // point to enter at the effective fill price? Advisory only.
  const entryQuality = useMemo(
    () => evaluateEntry({ side, plan, effectiveEntry, biasLabel, backtest }),
    [side, plan, effectiveEntry, biasLabel, backtest],
  )

  // Straddle (both directions) projection: one MARKET leg per side, each sized
  // from its share of the entered margin, with its own TP/SL at the levels.
  const totalMargin = effectiveMargin
  const longProj = useMemo(
    () =>
      straddle.long
        ? projectOrder({
            side: 'LONG',
            entry: currentPrice,
            stop: straddle.long.stop,
            tp1: straddle.long.tp,
            tp2: straddle.long.tp,
            leverage,
            margin: totalMargin * straddleSplit,
            tpMode: 'TP1',
            split: 1,
            spec,
            marginMode,
            availableBalance,
          })
        : null,
    [straddle.long, currentPrice, leverage, totalMargin, straddleSplit, spec, marginMode, availableBalance],
  )
  const shortProj = useMemo(
    () =>
      straddle.short
        ? projectOrder({
            side: 'SHORT',
            entry: currentPrice,
            stop: straddle.short.stop,
            tp1: straddle.short.tp,
            tp2: straddle.short.tp,
            leverage,
            margin: totalMargin * (1 - straddleSplit),
            tpMode: 'TP1',
            split: 1,
            spec,
            marginMode,
            availableBalance,
          })
        : null,
    [straddle.short, currentPrice, leverage, totalMargin, straddleSplit, spec, marginMode, availableBalance],
  )

  // Combined straddle outcomes (in USDT): range holds (both TP) vs. breakout.
  const straddleBestCase = (longProj?.profitTotal ?? 0) + (shortProj?.profitTotal ?? 0)
  const breakoutUp = (longProj?.profitTotal ?? 0) + (shortProj?.lossPnl ?? 0) // through R: long TP, short stop
  const breakoutDown = (shortProj?.profitTotal ?? 0) + (longProj?.lossPnl ?? 0) // through S: short TP, long stop
  const straddleWorstCase = Math.min(breakoutUp, breakoutDown)
  const straddleWarnings = [...(longProj?.warnings ?? []), ...(shortProj?.warnings ?? [])]
  const straddleNotices = [...(longProj?.notices ?? []), ...(shortProj?.notices ?? [])]

  // ---- Position Builder sizing ----
  // Split the budget across rungs; each rung is sized from its share, applying
  // the open-then-shed trick when the target is below the exchange minimum.
  const builderRungSizings = useMemo<BuilderRungSizing[]>(() => {
    if (!isBuilder) return []
    const budget = toNum(builderBudget)
    if (budget <= 0) return []
    return builder.rungs.map((r) =>
      planBuilderRung({ price: r.price, targetMargin: budget * r.weight, leverage, spec }),
    )
  }, [isBuilder, builder, builderBudget, leverage, spec])

  const builderNetQty = builderRungSizings.reduce((a, s) => a + s.netQty, 0)
  const builderNetNotional = builderRungSizings.reduce((a, s) => a + s.netQty * s.price, 0)
  const builderNetMargin = leverage > 0 ? builderNetNotional / leverage : 0
  const builderAvgEntry = builderNetQty > 0 ? builderNetNotional / builderNetQty : builder.avgEntry
  const builderUsesTrick = builderRungSizings.some((s) => s.usesTrick)

  // Aggregate projection: avgEntry is qty-weighted, so P&L at the shared TP/stop
  // is exact; the liquidation estimate uses the same average entry.
  const builderProj = useMemo<OrderProjection | null>(() => {
    if (!isBuilder || builderNetQty <= 0) return null
    return projectOrder({
      side: builder.side,
      entry: builderAvgEntry,
      stop: builder.stop,
      tp1: builder.tp,
      tp2: builder.tp,
      leverage,
      margin: builderNetMargin,
      tpMode: 'TP1',
      split: 1,
      spec,
      marginMode,
      availableBalance,
    })
  }, [isBuilder, builder, builderAvgEntry, builderNetMargin, builderNetQty, leverage, spec, marginMode, availableBalance])

  const builderWarnings = useMemo<string[]>(() => {
    if (!isBuilder) return []
    const out: string[] = []
    if (toNum(builderBudget) <= 0) out.push('Set a budget above 0.')
    else if (builderRungSizings.length === 0 || builderNetQty <= 0)
      out.push('No rung is large enough to open at this budget/leverage — raise the budget or leverage, or use fewer rungs.')
    for (const s of builderRungSizings) if (s.warning && !out.includes(s.warning)) out.push(s.warning)
    if (availableBalance !== undefined && builderNetMargin > availableBalance)
      out.push(`Total margin ${fmtUsd(builderNetMargin)} exceeds your available balance.`)
    return out
  }, [isBuilder, builderBudget, builderRungSizings, builderNetQty, builderNetMargin, availableBalance])

  const builderNotices = useMemo<string[]>(() => {
    if (!isBuilder) return []
    const out: string[] = []
    if (builderUsesTriggerEntry(builder.entryStyle)) {
      out.push(
        'Momentum uses trigger entries: a market open fires when price reaches each rung (monitored while the app is open). Resting limits appear on Bitunix after each trigger.',
      )
    }
    if (builderUsesTrick) {
      out.push(
        'Some rungs are below the exchange minimum: each opens at the exchange minimum plus your target, then auto-sheds the excess via a market close when the limit fills (hedge mode requires positionId — shed orders cannot be pre-placed).',
      )
    }
    return out
  }, [isBuilder, builder.entryStyle, builderUsesTrick])

  const presets = LEVERAGE_PRESETS.filter((p) => p >= spec.minLeverage && p <= spec.maxLeverage)
  const canSubmit =
    hasKeys && liveTradingEnabled && projection.qty > 0 && projection.warnings.length === 0 && submit.kind !== 'submitting'
  // Note: `straddle.valid` is intentionally NOT required here — the user may
  // open the straddle even when it fails validation (we only warn). The real
  // blockers remain: keys, live trading, a sizeable position, and broker-level
  // warnings (size below minimum, etc.).
  const canSubmitStraddle =
    hasKeys &&
    liveTradingEnabled &&
    (longProj?.qty ?? 0) > 0 &&
    (shortProj?.qty ?? 0) > 0 &&
    straddleWarnings.length === 0 &&
    submit.kind !== 'submitting'
  const canSubmitBuilder =
    hasKeys && liveTradingEnabled && builderNetQty > 0 && builderWarnings.length === 0 && submit.kind !== 'submitting'

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

  // Opens BOTH legs of the range straddle (long + short) in hedge mode, each
  // with its TP at the opposite level and its stop just beyond its own level.
  async function doSubmitStraddle() {
    setShowConfirm(false)
    if (!straddle.long || !straddle.short || !longProj || !shortProj) return
    const orderIds: string[] = []
    try {
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
        // Margin mode can't change with an open position/order — ignore.
      }

      setSubmit({ kind: 'submitting', step: 'Setting leverage…' })
      await changeLeverage(symbol, leverage, marginCoin)

      const legs = [
        { leg: straddle.long, proj: longProj, orderSide: 'BUY' as const, label: 'LONG' },
        { leg: straddle.short, proj: shortProj, orderSide: 'SELL' as const, label: 'SHORT' },
      ]
      for (let i = 0; i < legs.length; i++) {
        const { leg, proj, orderSide, label } = legs[i]
        if (!leg || proj.qty <= 0) continue
        setSubmit({ kind: 'submitting', step: `Placing ${label} leg ${i + 1}/${legs.length}…` })
        const params: PlaceOrderParams = {
          symbol,
          side: orderSide,
          orderType: 'MARKET',
          effect: 'GTC',
          qty: String(proj.qty),
          tpPrice: String(roundToPrecision(leg.tp, spec.quotePrecision)),
          tpStopType: 'LAST_PRICE',
          tpOrderType: 'MARKET',
          slPrice: String(roundToPrecision(leg.stop, spec.quotePrecision)),
          slStopType: 'LAST_PRICE',
          slOrderType: 'MARKET',
        }
        if (hedge) params.tradeSide = 'OPEN'
        const res = await placeOrder(params)
        if (res?.orderId) orderIds.push(res.orderId)
      }
      setSubmit({ kind: 'done', orderIds })
    } catch (e) {
      setSubmit({ kind: 'error', message: e instanceof Error ? e.message : String(e), orderIds })
    }
  }

  // Pullback: resting POST_ONLY limits. Momentum: trigger entries (market open when price hits each rung).
  async function doSubmitBuilder() {
    setShowConfirm(false)
    const active = builderRungSizings.filter((r) => r.openQty > 0)
    if (active.length === 0) return
    const orderIds: string[] = []
    const shedInputs: BuilderShedJobInput[] = []
    const triggerInputs: Parameters<typeof registerBuilderTriggerJobs>[1] = []
    let skippedCross = 0
    let refPrice = currentPrice > 0 ? currentPrice : builder.avgEntry
    const useTriggers = builderUsesTriggerEntry(builder.entryStyle)
    // Clear stale finished jobs for this symbol so old notices (e.g. "auto-shed
    // failed on N rungs" from previous broken builds) don't carry over.
    clearFinishedBuilderShedJobs(symbol)
    clearFinishedBuilderTriggerJobs(symbol)
    try {
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
        // Margin mode can't change with an open position/order — ignore.
      }

      setSubmit({ kind: 'submitting', step: 'Setting leverage…' })
      await changeLeverage(symbol, leverage, marginCoin)

      setSubmit({ kind: 'submitting', step: 'Fetching live price…' })
      refPrice = (await fetchLivePrice(symbol)) || refPrice

      const isLong = builder.side === 'LONG'
      const tp = String(roundToPrecision(builder.tp, spec.quotePrecision))
      const sl = String(roundToPrecision(builder.stop, spec.quotePrecision))
      const total = active.length

      async function placeOpenRung(r: BuilderRungSizing, i: number, limitPrice: number): Promise<string | undefined> {
        const clientId = `builder-${symbol}-${i}-${Date.now()}`
        const base: PlaceOrderParams = {
          symbol,
          side: isLong ? 'BUY' : 'SELL',
          orderType: 'LIMIT',
          price: String(limitPrice),
          qty: String(floorToPrecision(r.openQty, spec.basePrecision)),
          clientId,
          tpPrice: tp,
          tpStopType: 'LAST_PRICE',
          tpOrderType: 'MARKET',
          slPrice: sl,
          slStopType: 'LAST_PRICE',
          slOrderType: 'MARKET',
        }
        if (hedge) base.tradeSide = 'OPEN'
        for (const effect of ['POST_ONLY', 'GTC'] as const) {
          try {
            const openRes = await placeOrder({ ...base, effect })
            if (openRes?.orderId) return openRes.orderId
          } catch {
            if (effect === 'GTC') throw new Error(`Rung ${i + 1} rejected by the exchange`)
          }
        }
        return undefined
      }

      for (let i = 0; i < active.length; i++) {
        const r = active[i]
        const limitPrice = roundToPrecision(r.price, spec.quotePrecision)

        if (useTriggers) {
          triggerInputs.push({
            symbol,
            side: builder.side,
            triggerPrice: limitPrice,
            openQty: r.openQty,
            shedQty: r.shedQty,
            usesTrick: r.usesTrick,
            rungIndex: i,
            tp,
            sl,
            leverage,
            marginMode,
            marginCoin,
            basePrecision: spec.basePrecision,
            quotePrecision: spec.quotePrecision,
          })
          continue
        }

        const canRest = builderLimitCanRest(builder.side, limitPrice, refPrice)
        if (!canRest) {
          skippedCross++
          continue
        }

        setSubmit({ kind: 'submitting', step: `Placing rung ${i + 1}/${total}…` })
        const orderId = await placeOpenRung(r, i, limitPrice)
        if (orderId) {
          orderIds.push(orderId)
          if (r.usesTrick && r.shedQty > 0) {
            shedInputs.push({
              orderId,
              clientId: `builder-${symbol}-${i}`,
              symbol,
              side: builder.side,
              shedQty: floorToPrecision(r.shedQty, spec.basePrecision),
              basePrecision: spec.basePrecision,
              rungIndex: i,
            })
          }
        }
      }

      let firedNow = 0
      if (triggerInputs.length) {
        registerBuilderTriggerJobs(symbol, triggerInputs)
        ensureBuilderTriggerPolling()
        setSubmit({ kind: 'submitting', step: 'Arming trigger rungs…' })
        const result = await processBuilderTriggerJobs({ [symbol]: refPrice })
        firedNow = result.fired
        orderIds.push(...result.orderIds)
      }

      if (shedInputs.length) {
        registerBuilderShedJobs(shedInputs)
        ensureBuilderShedPolling()
      }

      const notes: string[] = []
      if (useTriggers) {
        if (firedNow > 0) {
          notes.push(`${firedNow} trigger rung${firedNow === 1 ? '' : 's'} fired on Bitunix (market entry).`)
        }
        const pendingTriggers = getActiveBuilderTriggerJobs(symbol)
        if (pendingTriggers.length > 0) {
          const nearest = builder.side === 'LONG'
            ? Math.min(...pendingTriggers.map((d) => d.triggerPrice))
            : Math.max(...pendingTriggers.map((d) => d.triggerPrice))
          notes.push(
            `${pendingTriggers.length} trigger${pendingTriggers.length === 1 ? '' : 's'} armed — market open when price ${builder.side === 'LONG' ? 'rises to' : 'falls to'} ${fmtPrice(nearest)} (keep app open).`,
          )
        } else if (triggerInputs.length > 0 && firedNow === 0) {
          notes.push(`${triggerInputs.length} trigger rungs armed — waiting for price to reach each level.`)
        }
      } else if (orderIds.length > 0) {
        notes.push(`${orderIds.length} resting limit order${orderIds.length === 1 ? '' : 's'} on Bitunix now.`)
      }
      if (skippedCross > 0) {
        notes.push(`${skippedCross} rung${skippedCross === 1 ? '' : 's'} skipped — already at/past the limit price.`)
      }
      if (!useTriggers && orderIds.length === 0) {
        throw new Error('No resting limits could be placed at the current price.')
      }
      if (useTriggers && triggerInputs.length === 0) {
        throw new Error('No trigger rungs could be armed.')
      }
      if (shedInputs.length > 0) {
        notes.push(
          `Auto-shed queued for ${shedInputs.length} rung${shedInputs.length === 1 ? '' : 's'} — excess closes on fill.`,
        )
      }
      setSubmit({ kind: 'done', orderIds, note: notes.length ? notes.join(' ') : undefined })
    } catch (e) {
      if (shedInputs.length) {
        registerBuilderShedJobs(shedInputs)
        ensureBuilderShedPolling()
      }
      if (triggerInputs.length) {
        registerBuilderTriggerJobs(symbol, triggerInputs)
        ensureBuilderTriggerPolling()
        void processBuilderTriggerJobs({ [symbol]: refPrice })
      }
      const base = e instanceof Error ? e.message : String(e)
      const partial =
        orderIds.length > 0 || triggerInputs.length > 0
          ? ` ${orderIds.length} order${orderIds.length === 1 ? '' : 's'} placed${triggerInputs.length ? `; ${triggerInputs.length} trigger${triggerInputs.length === 1 ? '' : 's'} armed` : ''}${shedInputs.length ? `; auto-shed queued for ${shedInputs.length} rung${shedInputs.length === 1 ? '' : 's'}` : ''}.`
          : ''
      setSubmit({ kind: 'error', message: `${base}${partial}`, orderIds })
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

  function switchSizingMode(next: TicketSizingMode) {
    if (next === sizingMode) return
    if (next === 'qty') {
      const q = qtyFromMargin(toNum(margin), sizingEntry, leverage, spec.basePrecision)
      setTicket({
        ticketSizingMode: 'qty',
        ticketQty: q > 0 ? String(q) : '',
      })
    } else {
      const m = marginFromQty(toNum(qty), sizingEntry, leverage, spec.quotePrecision)
      setTicket({
        ticketSizingMode: 'margin',
        ticketMargin: m > 0 ? String(m) : margin,
      })
    }
  }

  function applyBalancePreset(fraction: number) {
    if (!availableBalance) return
    if (sizingMode === 'qty') {
      const q = qtyFromMargin(availableBalance * fraction, sizingEntry, leverage, spec.basePrecision)
      setQty(String(q))
    } else {
      setMargin(String(roundToPrecision(availableBalance * fraction, 2)))
    }
  }

  return (
    <Panel
      title="Order ticket"
      subtitle="Size the trade, project P&L, and open the position"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
            {([
              ['single', 'Single'],
              ['both', 'Both'],
              ['builder', 'Builder'],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => onTradeModeChange(m)}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-semibold',
                  tradeMode === m ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isSingle && (
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
          )}
          {isBuilder && (
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {(['LONG', 'SHORT'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onBuilderSideChange(s)}
                  className={clsx(
                    'rounded-md px-3 py-1 text-xs font-semibold',
                    builderSide === s
                      ? s === 'LONG'
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-rose-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  Build {s}
                </button>
              ))}
            </div>
          )}
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

          {/* Size: USDT margin or base qty (single / both) */}
          {!isBuilder && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">Size</span>
                <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
                  {([
                    ['margin', marginCoin],
                    ['qty', baseSymbol],
                  ] as const).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => switchSizingMode(m)}
                      className={clsx(
                        'rounded-md px-2 py-0.5 text-[10px] font-medium',
                        sizingMode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {availableBalance ? (
                <span className="text-[10px] text-zinc-600">avail {fmtUsd(availableBalance)}</span>
              ) : null}
            </div>
            {sizingMode === 'margin' ? (
              <input
                type="number"
                min={0}
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
              />
            ) : (
              <input
                type="number"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
              />
            )}
            {availableBalance ? (
              <div className="mt-1 flex gap-1">
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <button
                    key={f}
                    onClick={() => applyBalancePreset(f)}
                    className="rounded-md border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    {f * 100}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          )}

          {/* Position builder size: budget + rung count */}
          {isBuilder && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Budget · max margin ({marginCoin})
                  </span>
                  {availableBalance ? (
                    <span className="text-[10px] text-zinc-600">avail {fmtUsd(availableBalance)}</span>
                  ) : null}
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={builderBudget}
                  onChange={(e) => setBuilderBudget(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-zinc-500">
                  <span>Rungs</span>
                  <span className="tabular text-zinc-300">{builderRungsCount}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={builderRungsCount}
                  onChange={(e) => setBuilderRungs(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>
          )}

          {/* Order type (single mode) */}
          {isSingle && (
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
          )}

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

          {/* Prices (single mode) */}
          {isSingle && (
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
          )}

          {/* TP selector (single mode) */}
          {isSingle && (
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
          )}

          {/* Straddle legs (both mode) */}
          {both && (
            <StraddleInputs straddle={straddle} split={straddleSplit} onSplitChange={setStraddleSplit} />
          )}

          {/* Builder ladder summary (builder mode) */}
          {isBuilder && <BuilderInputs plan={builder} />}
        </div>

        {/* Projection */}
        <div className="flex flex-col gap-3">
          {isSingle && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {sizingMode === 'margin' ? (
                  <Stat label="Position size" value={`${fmtCompact(projection.qty, 4)} ${baseSymbol}`} />
                ) : (
                  <Stat label={`Margin (${marginCoin})`} value={fmtUsd(projection.margin)} />
                )}
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
            </>
          )}

          {both && (
            <StraddleProjection
              straddle={straddle}
              longProj={longProj}
              shortProj={shortProj}
              bestCase={straddleBestCase}
              worstCase={straddleWorstCase}
              breakoutUp={breakoutUp}
              breakoutDown={breakoutDown}
              baseSymbol={baseSymbol}
              sizingMode={sizingMode}
              marginCoin={marginCoin}
              totalMargin={totalMargin}
            />
          )}

          {isBuilder && (
            <BuilderProjection
              plan={builder}
              rungs={builderRungSizings}
              proj={builderProj}
              netQty={builderNetQty}
              netMargin={builderNetMargin}
              avgEntry={builderAvgEntry}
              baseSymbol={baseSymbol}
              marginCoin={marginCoin}
            />
          )}

          {(both ? straddleWarnings : isBuilder ? builderWarnings : projection.warnings).map((w, i) => (
            <p key={`w${i}`} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{w}</p>
          ))}
          {(both ? straddleNotices : isBuilder ? builderNotices : projection.notices).map((n, i) => (
            <p key={`n${i}`} className="rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">{n}</p>
          ))}
          {both && !straddle.valid && (
            <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              {straddle.note ?? 'This range straddle did not pass validation.'} You can still open it — higher risk.
            </p>
          )}
          {isBuilder && !builder.valid && (
            <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              {builder.note ?? 'This ladder did not pass validation.'} You can still place it — higher risk.
            </p>
          )}

          {!hasKeys && (
            <p className="text-xs text-zinc-500">Connect your API key in Settings to enable trading.</p>
          )}
          {hasKeys && !liveTradingEnabled && (
            <p className="text-xs text-amber-300/80">
              Live trading is off. Enable it in Settings to place orders.
            </p>
          )}

          <p className="text-[11px] text-zinc-500">
            Orders open in Hedge mode (set automatically).
            {both
              ? ' Both legs are MARKET orders opened at once; the long targets the resistance and the short targets the support.'
              : isBuilder
                ? ' Pullback: POST_ONLY limits on the book. Momentum: trigger entries — market open when price hits each rung (monitored while the app is open).'
                : ' For multiple same-direction positions per pair, enable '}
            {isSingle && <span className="text-zinc-300">Multi-Trade</span>}
            {isSingle && " once in the Bitunix app — it isn't available through the API."}
          </p>

          {isSingle && <EntryQualityCard quality={entryQuality} side={side} />}

          {isBuilder && triggerCount > 0 && (
            <p className="rounded-md bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">
              {triggerCount} momentum trigger{triggerCount === 1 ? '' : 's'} armed — market entry when price hits each rung.
            </p>
          )}
          {isBuilder && triggerFailedCount > 0 && (
            <p className="rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
              Trigger entry failed on {triggerFailedCount} rung{triggerFailedCount === 1 ? '' : 's'} — retry or place manually.
            </p>
          )}
          {isBuilder && shedActiveCount > 0 && (
            <p className="rounded-md bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">
              Auto-shed watching {shedActiveCount} rung{shedActiveCount === 1 ? '' : 's'} — excess closes via market when each limit fills.
            </p>
          )}
          {isBuilder && shedFailedCount > 0 && (
            <p className="rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
              Auto-shed failed on {shedFailedCount} rung{shedFailedCount === 1 ? '' : 's'} — trim positions manually if needed.
            </p>
          )}

          {both ? (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!canSubmitStraddle}
              className={clsx(
                'rounded-lg px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40',
                straddle.valid ? 'bg-cyan-500 hover:bg-cyan-400' : 'bg-amber-500 hover:bg-amber-400',
              )}
            >
              {submit.kind === 'submitting'
                ? submit.step
                : straddle.valid
                  ? `Open BOTH on ${symbol}`
                  : `Open BOTH anyway on ${symbol}`}
            </button>
          ) : isBuilder ? (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!canSubmitBuilder}
              className={clsx(
                'rounded-lg px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40',
                builder.valid ? 'bg-cyan-500 hover:bg-cyan-400' : 'bg-amber-500 hover:bg-amber-400',
              )}
            >
              {submit.kind === 'submitting'
                ? submit.step
                : builder.valid
                  ? `Build ${builder.side} on ${symbol}`
                  : `Build ${builder.side} anyway on ${symbol}`}
            </button>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!canSubmit}
              className={clsx(
                'rounded-lg px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40',
                entryQuality.verdict === 'poor'
                  ? 'bg-amber-500 hover:bg-amber-400'
                  : side === 'LONG'
                    ? 'bg-emerald-500 hover:bg-emerald-400'
                    : 'bg-rose-500 hover:bg-rose-400',
              )}
            >
              {submit.kind === 'submitting'
                ? submit.step
                : entryQuality.verdict === 'poor'
                  ? `Open ${side} anyway on ${symbol}`
                  : `Open ${side} on ${symbol}`}
            </button>
          )}

          {submit.kind === 'done' && (
            <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Order placed. {submit.orderIds.length ? `IDs: ${submit.orderIds.join(', ')}` : ''}
              {submit.note ? ` ${submit.note}` : ''}
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

      {showConfirm && isSingle && (
        <ConfirmModal
          symbol={symbol}
          side={side}
          orderType={orderType}
          marginMode={marginMode}
          leverage={leverage}
          margin={projection.margin}
          marginCoin={marginCoin}
          baseSymbol={baseSymbol}
          projection={projection}
          entryQuality={entryQuality}
          onCancel={() => setShowConfirm(false)}
          onConfirm={doSubmit}
        />
      )}
      {showConfirm && isBuilder && (
        <BuilderConfirmModal
          symbol={symbol}
          marginMode={marginMode}
          leverage={leverage}
          marginCoin={marginCoin}
          baseSymbol={baseSymbol}
          plan={builder}
          rungs={builderRungSizings}
          proj={builderProj}
          netQty={builderNetQty}
          netMargin={builderNetMargin}
          onCancel={() => setShowConfirm(false)}
          onConfirm={doSubmitBuilder}
        />
      )}
      {showConfirm && both && longProj && shortProj && (
        <StraddleConfirmModal
          symbol={symbol}
          marginMode={marginMode}
          leverage={leverage}
          margin={totalMargin}
          marginCoin={marginCoin}
          baseSymbol={baseSymbol}
          straddle={straddle}
          longProj={longProj}
          shortProj={shortProj}
          bestCase={straddleBestCase}
          worstCase={straddleWorstCase}
          onCancel={() => setShowConfirm(false)}
          onConfirm={doSubmitStraddle}
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

const ENTRY_TONES = {
  good: { box: 'border-emerald-500/40 bg-emerald-500/5', dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Good entry' },
  caution: { box: 'border-amber-500/40 bg-amber-500/5', dot: 'bg-amber-400', text: 'text-amber-300', label: 'Caution' },
  poor: { box: 'border-rose-500/40 bg-rose-500/5', dot: 'bg-rose-400', text: 'text-rose-300', label: 'Poor entry' },
} as const

function EntryQualityCard({ quality, side }: { quality: EntryQuality; side: 'LONG' | 'SHORT' }) {
  const tone = ENTRY_TONES[quality.verdict]
  return (
    <div className={clsx('rounded-lg border p-3', tone.box)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx('h-2 w-2 rounded-full', tone.dot)} />
          <span className={clsx('text-xs font-semibold', tone.text)}>Entry quality: {tone.label}</span>
        </div>
        <span className="text-[11px] text-zinc-500">
          {side} · score {quality.score.toFixed(0)}/100
        </span>
      </div>
      {quality.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-400">
          {quality.reasons.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-zinc-600">•</span>
              {r}
            </li>
          ))}
        </ul>
      )}
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
  baseSymbol,
  projection,
  entryQuality,
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
  baseSymbol: string
  projection: ReturnType<typeof projectOrder>
  entryQuality: EntryQuality
  onCancel: () => void
  onConfirm: () => void
}) {
  const poor = entryQuality.verdict === 'poor'
  const flagged = entryQuality.verdict !== 'good'
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

        {flagged && (
          <div
            className={clsx(
              'mt-3 rounded-md border px-3 py-2 text-xs',
              poor ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200',
            )}
          >
            <div className="font-semibold">
              {poor ? 'This is not a good entry — are you sure?' : 'Entry could be better — double-check before opening.'}
            </div>
            <ul className="mt-1 space-y-0.5">
              {entryQuality.reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="opacity-60">•</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Row label="Side" value={side} />
          <Row label="Type" value={orderType} />
          <Row label="Margin mode" value={marginMode === 'CROSS' ? 'Cross' : 'Isolated'} />
          <Row label="Leverage" value={`${leverage}x`} />
          <Row label="Margin" value={`${fmtUsd(margin)} ${marginCoin}`} />
          <Row label="Entry" value={fmtPrice(projection.entry)} />
          <Row label="Stop" value={fmtPrice(projection.stop)} />
          <Row label="Size" value={`${fmtCompact(projection.qty, 4)} ${baseSymbol}`} />
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
              poor
                ? 'bg-amber-500 hover:bg-amber-400'
                : side === 'LONG'
                  ? 'bg-emerald-500 hover:bg-emerald-400'
                  : 'bg-rose-500 hover:bg-rose-400',
            )}
          >
            {poor ? `Open ${side} anyway` : `Confirm ${side}`}
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

function LegCard({ label, tone, leg }: { label: string; tone: 'up' | 'down'; leg: RangeStraddleLeg | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-2.5">
      <div className={clsx('mb-1 text-xs font-semibold', tone === 'up' ? 'text-emerald-400' : 'text-rose-400')}>
        {label}
      </div>
      {leg ? (
        <div className="flex flex-col gap-0.5 text-[11px] text-zinc-400">
          <div className="flex justify-between">
            <span>Entry (mkt)</span>
            <span className="tabular text-zinc-200">{fmtPrice(leg.entry)}</span>
          </div>
          <div className="flex justify-between">
            <span>TP</span>
            <span className="tabular text-emerald-300">{fmtPrice(leg.tp)}</span>
          </div>
          <div className="flex justify-between">
            <span>Stop</span>
            <span className="tabular text-rose-300">{fmtPrice(leg.stop)}</span>
          </div>
          <div className="flex justify-between">
            <span>R:R</span>
            <span className="tabular text-zinc-200">{leg.rr.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600">n/a</div>
      )}
    </div>
  )
}

function StraddleInputs({
  straddle,
  split,
  onSplitChange,
}: {
  straddle: RangeStraddlePlan
  split: number
  onSplitChange: (v: number) => void
}) {
  const { support, resistance, long, short } = straddle
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
          Range straddle · both legs open at market
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Resistance</span>
            <span className="tabular text-rose-300">{resistance ? fmtPrice(resistance.price) : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Support</span>
            <span className="tabular text-emerald-300">{support ? fmtPrice(support.price) : '—'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LegCard label="LONG → resistance" tone="up" leg={long} />
        <LegCard label="SHORT → support" tone="down" leg={short} />
      </div>

      <div>
        <div className="mb-1 flex justify-between text-[10px] text-zinc-500">
          <span>LONG margin {Math.round(split * 100)}%</span>
          <span>SHORT margin {Math.round((1 - split) * 100)}%</span>
        </div>
        <input
          type="range"
          min={10}
          max={90}
          step={5}
          value={Math.round(split * 100)}
          onChange={(e) => onSplitChange(Number(e.target.value) / 100)}
          className="w-full accent-cyan-400"
        />
      </div>
    </div>
  )
}

function StraddleProjection({
  straddle,
  longProj,
  shortProj,
  bestCase,
  worstCase,
  breakoutUp,
  breakoutDown,
  baseSymbol,
  sizingMode,
  marginCoin,
  totalMargin,
}: {
  straddle: RangeStraddlePlan
  longProj: OrderProjection | null
  shortProj: OrderProjection | null
  bestCase: number
  worstCase: number
  breakoutUp: number
  breakoutDown: number
  baseSymbol: string
  sizingMode: TicketSizingMode
  marginCoin: string
  totalMargin: number
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {sizingMode === 'qty' && (
          <Stat label={`Margin (${marginCoin})`} value={fmtUsd(totalMargin)} />
        )}
        <Stat label="Long size" value={`${fmtCompact(longProj?.qty ?? 0, 4)} ${baseSymbol}`} tone="up" />
        <Stat label="Short size" value={`${fmtCompact(shortProj?.qty ?? 0, 4)} ${baseSymbol}`} tone="down" />
        <Stat label="Long liq." value={fmtPrice(longProj?.liqPrice ?? 0)} tone="down" />
        <Stat label="Short liq." value={fmtPrice(shortProj?.liqPrice ?? 0)} tone="down" />
      </div>

      <div className="rounded-lg border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Projected P&amp;L</div>
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">
              Range holds · both TP {straddle.bestCaseR ? `(${straddle.bestCaseR.toFixed(2)}R)` : ''}
            </span>
            <span className={pnlColor(bestCase)}>+{fmtUsd(bestCase)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Breaks up · long TP, short stop</span>
            <span className={pnlColor(breakoutUp)}>{fmtUsd(breakoutUp)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Breaks down · short TP, long stop</span>
            <span className={pnlColor(breakoutDown)}>{fmtUsd(breakoutDown)}</span>
          </div>
          <div className="my-1 h-px bg-zinc-800" />
          <div className="flex items-center justify-between font-medium">
            <span className="text-zinc-300">Worst-case breakout</span>
            <span className={pnlColor(worstCase)}>{fmtUsd(worstCase)}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function StraddleConfirmModal({
  symbol,
  marginMode,
  leverage,
  margin,
  marginCoin,
  baseSymbol,
  straddle,
  longProj,
  shortProj,
  bestCase,
  worstCase,
  onCancel,
  onConfirm,
}: {
  symbol: string
  marginMode: 'CROSS' | 'ISOLATION'
  leverage: number
  margin: number
  marginCoin: string
  baseSymbol: string
  straddle: RangeStraddlePlan
  longProj: OrderProjection
  shortProj: OrderProjection
  bestCase: number
  worstCase: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">Confirm range straddle · {symbol}</h3>
        <p className="mt-1 text-xs text-amber-300/80">
          This opens TWO real market positions on Bitunix futures ({marginMode === 'CROSS' ? 'cross' : 'isolated'}{' '}
          {leverage}x, hedge mode): a LONG targeting resistance and a SHORT targeting support.
        </p>
        {!straddle.valid && (
          <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
            Warning: {straddle.note ?? 'this setup did not pass validation'} — opening anyway is higher risk.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Row label="Margin mode" value={marginMode === 'CROSS' ? 'Cross' : 'Isolated'} />
          <Row label="Leverage" value={`${leverage}x`} />
          <Row label="Margin" value={`${fmtUsd(margin)} ${marginCoin}`} />
          <Row label="Total size" value={`${fmtCompact(longProj.qty + shortProj.qty, 4)} ${baseSymbol}`} />
          <Row label="Range R:R" value={straddle.bestCaseR ? straddle.bestCaseR.toFixed(2) : '—'} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-zinc-800 p-2">
            <div className="mb-1 font-semibold text-emerald-400">LONG</div>
            <div className="flex justify-between text-zinc-400">
              <span>Size</span>
              <span className="tabular text-zinc-200">{fmtCompact(longProj.qty, 4)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>TP</span>
              <span className="tabular text-emerald-300">{fmtPrice(straddle.long?.tp ?? 0)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Stop</span>
              <span className="tabular text-rose-300">{fmtPrice(straddle.long?.stop ?? 0)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 p-2">
            <div className="mb-1 font-semibold text-rose-400">SHORT</div>
            <div className="flex justify-between text-zinc-400">
              <span>Size</span>
              <span className="tabular text-zinc-200">{fmtCompact(shortProj.qty, 4)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>TP</span>
              <span className="tabular text-emerald-300">{fmtPrice(straddle.short?.tp ?? 0)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Stop</span>
              <span className="tabular text-rose-300">{fmtPrice(straddle.short?.stop ?? 0)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-zinc-800 p-2 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-400">If range holds (both TP)</span>
            <span className="text-emerald-400">+{fmtUsd(bestCase)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1 font-medium">
            <span className="text-zinc-300">Worst-case breakout</span>
            <span className={pnlColor(worstCase)}>{fmtUsd(worstCase)}</span>
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
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400"
          >
            Confirm both
          </button>
        </div>
      </div>
    </div>
  )
}

function BuilderInputs({ plan }: { plan: PositionBuilderPlan }) {
  const isLong = plan.side === 'LONG'
  const styleLabel = plan.entryStyle === 'momentum' ? 'Momentum' : 'Pullback'
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          Ladder · {plan.rungs.length} rungs · {styleLabel}
        </span>
        <span className={clsx('text-xs font-semibold', isLong ? 'text-emerald-400' : 'text-rose-400')}>
          Build {plan.side}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Avg entry</span>
          <span className="tabular text-zinc-200">{fmtPrice(plan.avgEntry)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Shared TP</span>
          <span className="tabular text-emerald-300">{fmtPrice(plan.tp)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Shared stop</span>
          <span className="tabular text-rose-300">{fmtPrice(plan.stop)}</span>
        </div>
      </div>
    </div>
  )
}

function BuilderProjection({
  plan,
  rungs,
  proj,
  netQty,
  netMargin,
  avgEntry,
  baseSymbol,
  marginCoin,
}: {
  plan: PositionBuilderPlan
  rungs: BuilderRungSizing[]
  proj: OrderProjection | null
  netQty: number
  netMargin: number
  avgEntry: number
  baseSymbol: string
  marginCoin: string
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={`Total margin (${marginCoin})`} value={fmtUsd(netMargin)} />
        <Stat label="Net size" value={`${fmtCompact(netQty, 4)} ${baseSymbol}`} />
        <Stat label="Avg entry" value={fmtPrice(avgEntry)} />
        <Stat label="Est. liq. price" value={fmtPrice(proj?.liqPrice ?? 0)} tone="down" />
      </div>

      <div className="rounded-lg border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Rungs · resting limit orders</div>
        <div className="max-h-44 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0c111b]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="py-1 pr-2">Price</th>
                <th className="py-1 pr-2 text-right">Open</th>
                <th className="py-1 pr-2 text-right">Auto-shed</th>
                <th className="py-1 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rungs.map((r, i) => (
                <tr key={i} className="border-t border-zinc-800/40">
                  <td className="py-1 pr-2 tabular text-zinc-300">{fmtPrice(r.price)}</td>
                  <td className="py-1 pr-2 text-right tabular text-zinc-300">{fmtCompact(r.openQty, 4)}</td>
                  <td className="py-1 pr-2 text-right tabular text-amber-300">
                    {r.shedQty > 0 ? fmtCompact(r.shedQty, 4) : '—'}
                  </td>
                  <td className="py-1 text-right tabular text-zinc-100">{fmtCompact(r.netQty, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Projected P&amp;L · if every rung fills</div>
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between font-medium">
            <span className="text-zinc-300">At shared TP {fmtPrice(plan.tp)}</span>
            <span className={pnlColor(proj?.profitTotal ?? 0)}>
              +{fmtUsd(proj?.profitTotal ?? 0)} ({(proj?.profitRoiPct ?? 0).toFixed(1)}%)
            </span>
          </div>
          <div className="flex items-center justify-between font-medium">
            <span className="text-zinc-300">At shared stop {fmtPrice(plan.stop)}</span>
            <span className="text-rose-400">
              {fmtUsd(proj?.lossPnl ?? 0)} ({(proj?.lossRoiPct ?? 0).toFixed(1)}%)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">R:R (avg entry)</span>
            <span className="tabular text-zinc-200">{plan.rr ? plan.rr.toFixed(2) : '—'}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function BuilderConfirmModal({
  symbol,
  marginMode,
  leverage,
  marginCoin,
  baseSymbol,
  plan,
  rungs,
  proj,
  netQty,
  netMargin,
  onCancel,
  onConfirm,
}: {
  symbol: string
  marginMode: 'CROSS' | 'ISOLATION'
  leverage: number
  marginCoin: string
  baseSymbol: string
  plan: PositionBuilderPlan
  rungs: BuilderRungSizing[]
  proj: OrderProjection | null
  netQty: number
  netMargin: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const isLong = plan.side === 'LONG'
  const active = rungs.filter((r) => r.openQty > 0)
  const trickCount = active.filter((r) => r.usesTrick && r.shedQty > 0).length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#0c111b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-100">Confirm position builder · {symbol}</h3>
        <p className="mt-1 text-xs text-amber-300/80">
          This places {active.length} resting limit order{active.length === 1 ? '' : 's'} on Bitunix futures (
          {marginMode === 'CROSS' ? 'cross' : 'isolated'} {leverage}x, hedge mode): a Build {plan.side} ladder, each
          with the shared TP and stop.
          {trickCount > 0
            ? ` ${trickCount} rung${trickCount === 1 ? '' : 's'} will auto-shed the exchange minimum on fill (not pre-placed).`
            : ''}
        </p>
        {!plan.valid && (
          <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
            Warning: {plan.note ?? 'this setup did not pass validation'} — placing anyway is higher risk.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Row label="Direction" value={`Build ${plan.side}`} />
          <Row label="Leverage" value={`${leverage}x`} />
          <Row label="Margin" value={`${fmtUsd(netMargin)} ${marginCoin}`} />
          <Row label="Net size" value={`${fmtCompact(netQty, 4)} ${baseSymbol}`} />
          <Row label="TP" value={fmtPrice(plan.tp)} />
          <Row label="Stop" value={fmtPrice(plan.stop)} />
        </div>

        <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-zinc-800 p-2 text-xs">
          {active.map((r, i) => (
            <div key={i} className="flex justify-between border-b border-zinc-800/40 py-0.5 last:border-0">
              <span className={clsx('tabular', isLong ? 'text-emerald-300' : 'text-rose-300')}>{fmtPrice(r.price)}</span>
              <span className="tabular text-zinc-400">
                open {fmtCompact(r.openQty, 4)}
                {r.usesTrick ? ` · auto-shed ${fmtCompact(r.shedQty, 4)} on fill` : ''} · net {fmtCompact(r.netQty, 4)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-zinc-800 p-2 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-400">If all rungs fill, at TP</span>
            <span className="text-emerald-400">+{fmtUsd(proj?.profitTotal ?? 0)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1 font-medium">
            <span className="text-zinc-300">At stop</span>
            <span className="text-rose-400">{fmtUsd(proj?.lossPnl ?? 0)}</span>
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
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400"
          >
            Confirm build
          </button>
        </div>
      </div>
    </div>
  )
}
