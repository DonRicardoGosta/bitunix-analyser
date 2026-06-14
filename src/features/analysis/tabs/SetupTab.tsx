import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMarket } from '../../../store/market'
import { useTickers } from '../../../store/tickers'
import { useCandles } from '../useCandles'
import { useOrderBook } from '../useOrderBook'
import { useOpenInterest, useLongShort, useTakerFlow } from '../useDerivatives'
import { useAccount } from '../../stats/useStats'
import { toBinancePeriod, higherTimeframe } from '../../../lib/bitunix/intervals'
import { getFundingRate, getKline } from '../../../lib/bitunix/rest'
import { parseKlines, type Candle } from '../../../lib/candles'
import {
  buildSetup,
  type SetupResult,
  type TradePlan,
  type RangeStraddlePlan,
  type RangeStraddleLeg,
  type DetectedPattern,
  type ReversalRisk,
  type ReversalLevel,
  type MarketContext,
} from '../setup/engine'
import { OrderTicket } from '../setup/OrderTicket'
import { SetupChart, type PriceLineDef, type ChartMarker } from '../../../components/charts/SetupChart'
import { Panel, Spinner, EmptyState, Badge } from '../../../components/ui/primitives'
import { BinanceNote } from '../controls'
import { useUiPrefs, type TradeMode } from '../../../store/uiPrefs'
import { ema } from '../../../lib/indicators'
import { fmtPrice, fmtCompact, fmtPct, toNum } from '../../../lib/format'

export function SetupTab() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)
  const priceType = useMarket((s) => s.priceType)
  const period = toBinancePeriod(interval)

  const { candles, status } = useCandles(symbol, interval, priceType)
  const { book, error: bookError } = useOrderBook(symbol)
  const oi = useOpenInterest(symbol, period)
  const ls = useLongShort(symbol, period)
  const taker = useTakerFlow(symbol, period)
  const htfInterval = higherTimeframe(interval)
  const htf = useQuery({
    queryKey: ['htf-candles', symbol, htfInterval, priceType],
    queryFn: async () => parseKlines(await getKline({ symbol, interval: htfInterval, limit: 200, type: priceType })),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 0,
  })
  const funding = useQuery({
    queryKey: ['funding', symbol],
    queryFn: () => getFundingRate(symbol),
    refetchInterval: 30_000,
    retry: 0,
  })
  // BTC market context (volatility) — shared across symbols, lightly amplifies
  // the reversal-risk score for alts when BTC itself is volatile.
  const btc = useQuery({
    queryKey: ['btc-context', priceType],
    queryFn: async () => parseKlines(await getKline({ symbol: 'BTCUSDT', interval: '1h', limit: 200, type: priceType })),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 0,
  })
  const marketContext = useMemo<MarketContext>(() => btcMarketContext(btc.data), [btc.data])
  const account = useAccount()
  const lastPrice = useTickers((s) => s.map[symbol]?.last ?? 0)

  const [tradeSide, setTradeSideState] = useState<'LONG' | 'SHORT'>('LONG')
  const [showLevels, setShowLevels] = useState(true)
  const tradeMode = useUiPrefs((s) => s.ticketTradeMode)
  const setTradeMode = (m: TradeMode) => useUiPrefs.getState().setTicket({ ticketTradeMode: m })
  const userPickedRef = useRef(false)
  const chooseSide = (s: 'LONG' | 'SHORT') => {
    userPickedRef.current = true
    setTradeSideState(s)
  }

  const setup = useMemo<SetupResult | null>(() => {
    if (candles.length < 30) return null
    return buildSetup({
      candles,
      book,
      htfCandles: htf.data,
      derivatives: {
        oi: oi.data,
        longShort: ls.data?.global,
        taker: taker.data,
        fundingRate: funding.data ? toNum(funding.data.fundingRate) : undefined,
      },
      marketContext,
    })
  }, [candles, book, htf.data, oi.data, ls.data, taker.data, funding.data, marketContext])

  // Follow the bias-preferred side until the user explicitly picks one.
  const preferred: 'LONG' | 'SHORT' = setup ? (setup.bias >= 0 ? 'LONG' : 'SHORT') : 'LONG'
  useEffect(() => {
    userPickedRef.current = false
  }, [symbol])
  useEffect(() => {
    if (!userPickedRef.current) setTradeSideState(preferred)
  }, [preferred, symbol])

  const lines = useMemo<PriceLineDef[]>(() => {
    if (!setup) return []
    const out: PriceLineDef[] = []

    if (tradeMode === 'both' && setup.straddle.long && setup.straddle.short) {
      const s = setup.straddle
      out.push(
        { price: s.long!.entry, color: '#94a3b8', title: 'Entry (both)', width: 2 },
        { price: s.long!.tp, color: '#22c55e', title: 'LONG TP · resistance', width: 2 },
        { price: s.short!.tp, color: '#ef4444', title: 'SHORT TP · support', width: 2 },
        { price: s.long!.stop, color: '#f43f5e', title: 'LONG stop', dashed: true },
        { price: s.short!.stop, color: '#f43f5e', title: 'SHORT stop', dashed: true },
      )
      return out
    }

    const plan = tradeSide === 'LONG' ? setup.long : setup.short
    const isLong = tradeSide === 'LONG'
    out.push(
      { price: plan.entry, color: isLong ? '#22c55e' : '#ef4444', title: `${tradeSide} entry`, width: 2 },
      { price: plan.stop, color: '#f43f5e', title: 'Stop', dashed: true },
      { price: plan.tp1, color: '#22d3ee', title: 'TP1' },
      { price: plan.tp2, color: '#14b8a6', title: 'TP2' },
    )
    if (showLevels) {
      const top = [...setup.levels].sort((a, b) => b.strength - a.strength).slice(0, 6)
      for (const l of top) {
        out.push({
          price: l.price,
          color: 'rgba(148,163,184,0.45)',
          title: l.sources[0],
          dashed: true,
        })
      }
    }
    return out
  }, [setup, tradeSide, showLevels, tradeMode])

  const markers = useMemo<ChartMarker[]>(() => {
    if (!setup) return []
    return setup.patterns.map((p) => ({
      time: p.time,
      position: p.direction === 'bullish' ? 'belowBar' : p.direction === 'bearish' ? 'aboveBar' : 'inBar',
      color: p.direction === 'bullish' ? '#22c55e' : p.direction === 'bearish' ? '#ef4444' : '#f59e0b',
      shape: p.direction === 'bullish' ? 'arrowUp' : p.direction === 'bearish' ? 'arrowDown' : 'circle',
      text: p.short,
    }))
  }, [setup])

  if (status === 'loading' || (!setup && status !== 'error')) {
    return (
      <Panel>
        <Spinner label="Analyzing market…" />
      </Panel>
    )
  }
  if (!setup) {
    return (
      <Panel>
        <EmptyState title="Not enough data to build a setup" hint="Try another symbol or timeframe." />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {bookError ? (
        <BinanceNote error={bookError} />
      ) : null}
      {!setup.hasLiquidity && !bookError ? (
        <p className="text-xs text-zinc-500">Loading order-book liquidity…</p>
      ) : null}

      <BiasMeter setup={setup} htfInterval={htfInterval} />

      <PatternsCard patterns={setup.patterns} candles={candles} />

      <ReversalRiskCard
        risk={
          tradeMode === 'both'
            ? setup.reversalRisk.long.score >= setup.reversalRisk.short.score
              ? setup.reversalRisk.long
              : setup.reversalRisk.short
            : tradeSide === 'LONG'
              ? setup.reversalRisk.long
              : setup.reversalRisk.short
        }
        symbol={symbol}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {tradeMode === 'both'
            ? 'Both directions: open a LONG and a SHORT at once, each targeting the opposite strong level. Profits when price oscillates in the range.'
            : 'Single: one-sided LONG or SHORT plan.'}
        </p>
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
          {([
            ['single', 'Single'],
            ['both', 'Both directions'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setTradeMode(m)}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium',
                tradeMode === m ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tradeMode === 'both' ? (
        <StraddleCard straddle={setup.straddle} interval={interval} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PlanCard
            plan={setup.long}
            preferred={preferred === 'LONG'}
            biasLabel={setup.biasLabel}
            active={tradeSide === 'LONG'}
            onTrade={() => chooseSide('LONG')}
          />
          <PlanCard
            plan={setup.short}
            preferred={preferred === 'SHORT'}
            biasLabel={setup.biasLabel}
            active={tradeSide === 'SHORT'}
            onTrade={() => chooseSide('SHORT')}
          />
        </div>
      )}

      <OrderTicket
        symbol={symbol}
        side={tradeSide}
        onSideChange={chooseSide}
        long={setup.long}
        short={setup.short}
        straddle={setup.straddle}
        tradeMode={tradeMode}
        onTradeModeChange={setTradeMode}
        currentPrice={setup.price || lastPrice}
        bias={setup.bias}
        biasLabel={setup.biasLabel}
        backtest={setup.backtest}
        positionMode={account.data?.positionMode}
        availableBalance={account.data ? toNum(account.data.available) : undefined}
      />

      <Panel
        title="Setup map"
        subtitle="Entry / stop / targets plotted with key support & resistance"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {(['LONG', 'SHORT'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => chooseSide(s)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    tradeSide === s
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
            <button
              onClick={() => setShowLevels((v) => !v)}
              className={clsx(
                'rounded-md px-2 py-1 text-[11px] font-medium',
                showLevels ? 'bg-cyan-500/15 text-cyan-300' : 'border border-zinc-800 text-zinc-500',
              )}
            >
              Key levels
            </button>
          </div>
        }
      >
        <SetupChart candles={candles} lines={lines} markers={markers} height={460} />
      </Panel>

      <SignalQuality setup={setup} interval={interval} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Key levels" subtitle="Confluence of liquidity, volume profile, swings & indicators">
          <LevelsTable setup={setup} />
        </Panel>
        <Panel title="Bias factors" subtitle="What drives the directional read">
          <FactorList setup={setup} />
        </Panel>
      </div>
    </div>
  )
}

/** BTC volatility/trend context for the reversal-risk model (from BTC candles). */
function btcMarketContext(candles?: Candle[]): MarketContext {
  if (!candles || candles.length < 30) return {}
  const n = candles.length
  const p = 14
  let trSum = 0
  for (let i = n - p; i < n; i++) {
    const c = candles[i]
    const prev = candles[i - 1]
    if (!c || !prev) continue
    trSum += Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
  }
  const atr = trSum / p
  const last = candles[n - 1].close
  const btcAtrPct = last > 0 ? (atr / last) * 100 : undefined
  const eSeries = ema(candles.map((c) => c.close), 50)
  let e: number | null = null
  for (let i = eSeries.length - 1; i >= 0; i--) {
    const v = eSeries[i]
    if (v !== null && Number.isFinite(v)) {
      e = v
      break
    }
  }
  const btcTrend = e !== null && atr > 0 ? Math.max(-1, Math.min(1, (last - e) / (atr * 5))) : undefined
  return { btcAtrPct, btcTrend }
}

function SignalQuality({ setup, interval }: { setup: SetupResult; interval: string }) {
  const bt = setup.backtest
  return (
    <Panel
      title="Signal quality (backtest)"
      subtitle={`Candle-only replay of the bias on recent ${interval} history — order-book & derivatives factors are not replayable`}
    >
      {!bt ? (
        <EmptyState title="Not enough history to validate" hint="Load more candles or pick a busier timeframe." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Win rate" value={`${(bt.winRate * 100).toFixed(0)}%`} tone={bt.winRate >= 0.5 ? 'up' : 'down'} />
            <Metric
              label="Expectancy"
              value={`${bt.expectancy >= 0 ? '+' : ''}${bt.expectancy.toFixed(2)}R`}
              tone={bt.expectancy >= 0 ? 'up' : 'down'}
            />
            <Metric
              label="Profit factor"
              value={Number.isFinite(bt.profitFactor) ? bt.profitFactor.toFixed(2) : '∞'}
              tone={bt.profitFactor >= 1 ? 'up' : 'down'}
            />
            <Metric label="Signals" value={`${bt.samples}`} />
          </div>
          <p className="text-[11px] text-zinc-500">
            {bt.wins}W / {bt.losses}L over {bt.lookbackBars} bars · {bt.longSamples} long / {bt.shortSamples} short ·
            fixed-RR exits.
            {bt.samples < 8 ? ' Small sample — treat with caution.' : ''}
          </p>
        </div>
      )}
    </Panel>
  )
}

function PatternsCard({ patterns, candles }: { patterns: DetectedPattern[]; candles: Candle[] }) {
  return (
    <Panel
      title="Entry patterns detected"
      subtitle="Each recognized pattern with a focused view of the surrounding price action (about 60 candles each side)"
    >
      {/* Fixed height + internal scroll so the layout doesn't jump as the number
          of detected patterns changes between refreshes. */}
      <div className="h-[460px] overflow-y-auto pr-1">
        {patterns.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-zinc-500">
              No clear entry pattern on this timeframe right now — waiting for a candlestick or price-action signal.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {patterns.map((p, i) => {
          const tone = p.direction === 'bullish' ? 'up' : p.direction === 'bearish' ? 'down' : 'warn'
          const arrow = p.direction === 'bullish' ? '▲' : p.direction === 'bearish' ? '▼' : '◆'
          const lo = Math.max(0, p.barIndex - 60)
          const hi = Math.min(candles.length, p.barIndex + 61) // +61 keeps up to 60 candles after the pattern
          const windowCandles = candles.slice(lo, hi)
          const marker: ChartMarker = {
            time: p.time,
            position: p.direction === 'bullish' ? 'belowBar' : p.direction === 'bearish' ? 'aboveBar' : 'inBar',
            color: p.direction === 'bullish' ? '#22c55e' : p.direction === 'bearish' ? '#ef4444' : '#f59e0b',
            shape: p.direction === 'bullish' ? 'arrowUp' : p.direction === 'bearish' ? 'arrowDown' : 'circle',
            text: p.short,
          }
          return (
            <div
              key={i}
              className={clsx(
                'grid items-stretch gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]',
                p.direction === 'bullish'
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : p.direction === 'bearish'
                    ? 'border-rose-500/30 bg-rose-500/5'
                    : 'border-amber-500/30 bg-amber-500/5',
              )}
            >
              <div className="min-w-0">
                <Badge tone={tone}>
                  {arrow} {p.name}
                </Badge>
                <div className="mt-1.5 text-xs text-zinc-300">{p.description}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
                  {p.kind === 'candlestick' ? 'Candlestick' : 'Price action'} · confidence{' '}
                  {(p.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="min-h-[200px] overflow-hidden rounded-md border border-zinc-800/60 bg-zinc-950/30">
                {windowCandles.length > 0 ? (
                  <SetupChart candles={windowCandles} lines={[]} markers={[marker]} height={200} interactive={false} />
                ) : null}
              </div>
            </div>
          )
        })}
          </div>
        )}
      </div>
    </Panel>
  )
}

const RISK_TONES: Record<ReversalLevel, { label: string; ring: string; pill: string; bar: string; text: string }> = {
  low: { label: 'Low', ring: 'ring-1 ring-zinc-700/60', pill: 'bg-emerald-500/15 text-emerald-300', bar: 'bg-emerald-500', text: 'text-emerald-400' },
  elevated: { label: 'Elevated', ring: 'ring-1 ring-amber-500/50', pill: 'bg-amber-500/15 text-amber-300', bar: 'bg-amber-500', text: 'text-amber-400' },
  high: { label: 'High', ring: 'ring-2 ring-orange-500/60', pill: 'bg-orange-500/15 text-orange-300', bar: 'bg-orange-500', text: 'text-orange-400' },
  extreme: { label: 'Extreme', ring: 'ring-2 ring-rose-500/70', pill: 'bg-rose-500/20 text-rose-300', bar: 'bg-rose-500', text: 'text-rose-400' },
}

function ReversalRiskCard({ risk, symbol }: { risk: ReversalRisk; symbol: string }) {
  const base = symbol.replace(/USD[TC]?$/i, '') || symbol
  const tone = RISK_TONES[risk.level]

  if (!risk.available) {
    return (
      <section className="panel p-4 ring-1 ring-zinc-700/60">
        <header className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="neutral">Reversal fuel · squeeze danger</Badge>
          </div>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">n/a</span>
        </header>
        <p className="text-xs text-zinc-500">
          {risk.dataNote ?? 'Open-interest, positioning and order-book data are unavailable for this symbol.'}
        </p>
      </section>
    )
  }

  const dirText =
    risk.direction === 'flush-down'
      ? 'Downside reversal vs a LONG — longs getting hunted / liquidated could flip price down.'
      : 'Upside reversal vs a SHORT — shorts getting squeezed could flip price up.'
  const dirArrow = risk.direction === 'flush-down' ? '▼' : '▲'
  const lsText = risk.longAccount > 0
    ? `${(risk.longAccount * 100).toFixed(0)}% long / ${(risk.shortAccount * 100).toFixed(0)}% short`
    : `L/S ${risk.longShortRatio.toFixed(2)}`
  const fuelSide = risk.side === 'LONG' ? 'longs' : 'shorts'

  return (
    <section className={clsx('panel p-4', tone.ring)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">Reversal fuel · squeeze danger</span>
            <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              vs {risk.side}
            </span>
            <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tone.pill)}>
              {tone.label} · {risk.score.toFixed(0)}
            </span>
          </div>
          <p className={clsx('mt-1 text-xs', tone.text)}>
            {dirArrow} {dirText}
          </p>
        </div>
        {risk.btcMult !== 1 ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
            BTC vol ×{risk.btcMult.toFixed(2)}
          </span>
        ) : null}
      </header>

      <div className="relative mb-3 h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div className={clsx('absolute left-0 top-0 h-full rounded-full', tone.bar)} style={{ width: `${Math.min(100, risk.score)}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Fuel (est.)" value={`${fmtCompact(risk.fuelCoin)} ${base}`} accent />
        <Metric label="Fuel notional" value={`$${fmtCompact(risk.fuelNotional)}`} accent />
        <Metric label="Open interest" value={risk.oiNotional > 0 ? `$${fmtCompact(risk.oiNotional)}` : '—'} />
        <Metric
          label="OI change"
          value={fmtPct(risk.oiChangePct * 100, 1)}
          tone={risk.oiChangePct >= 0 ? 'up' : 'down'}
        />
        <Metric label="Crowd" value={lsText} />
        <Metric label="Funding" value={risk.funding !== null ? `${(risk.funding * 100).toFixed(4)}%` : '—'} />
        <Metric
          label="Trigger level"
          value={
            risk.triggerLevel !== null
              ? `${fmtPrice(risk.triggerLevel)}${risk.triggerDistanceAtr !== null ? ` · ${risk.triggerDistanceAtr.toFixed(1)} ATR` : ''}`
              : '—'
          }
        />
        <Metric label="Book to break" value={risk.triggerCostNotional !== null ? `$${fmtCompact(risk.triggerCostNotional)}` : '—'} />
      </div>

      {risk.components.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {risk.components.map((c, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <div className="w-36 shrink-0">
                <div className="text-zinc-300">{c.label}</div>
                <div className="text-[10px] text-zinc-600">{c.detail}</div>
              </div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className={clsx('absolute left-0 top-0 h-full rounded-full', tone.bar)} style={{ width: `${Math.round(c.value * 100)}%` }} />
              </div>
              <div className="w-8 shrink-0 text-right tabular text-zinc-400">{Math.round(c.value * 100)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-[10px] text-zinc-600">
        Estimated "ammo" to flip price {risk.direction === 'flush-down' ? 'down' : 'up'} against a {risk.side}: the {fuelSide}'
        open interest ({fmtCompact(risk.fuelCoin)} {base}), normalized to this coin's turnover and amplified by BTC volatility.
        Switches with the LONG / SHORT selection. An estimate, not exact position counts.
        {risk.dataNote ? ` ${risk.dataNote}` : ''}
      </p>
    </section>
  )
}

function BiasMeter({ setup, htfInterval }: { setup: SetupResult; htfInterval: string }) {
  const pct = ((setup.bias + 1) / 2) * 100
  const tone =
    setup.biasLabel === 'LONG' ? 'text-emerald-400' : setup.biasLabel === 'SHORT' ? 'text-rose-400' : 'text-zinc-300'
  const htf = setup.htfTrend
  const htfLabel = htf === null ? 'n/a' : htf > 0.1 ? 'Up' : htf < -0.1 ? 'Down' : 'Flat'
  const htfTone: 'up' | 'down' | 'neutral' = htf === null ? 'neutral' : htf > 0.1 ? 'up' : htf < -0.1 ? 'down' : 'neutral'
  const regimeTone: 'accent' | 'warn' | 'neutral' =
    setup.regime.type === 'TREND' ? 'accent' : setup.regime.type === 'RANGE' ? 'warn' : 'neutral'
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Directional bias</div>
          <div className={clsx('text-2xl font-bold', tone)}>{setup.biasLabel}</div>
          <div className="text-xs text-zinc-500">
            score {(setup.bias * 100).toFixed(0)} · confidence {setup.biasConfidence.toFixed(0)}%
          </div>
        </div>
        <div className="min-w-[260px] flex-1">
          <div className="relative h-3 overflow-hidden rounded-full bg-gradient-to-r from-rose-500/30 via-zinc-700/40 to-emerald-500/30">
            <div
              className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-white shadow"
              style={{ left: `calc(${pct}% - 3px)` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-3">
        <Badge tone={regimeTone}>
          Regime: {setup.regime.type} · ER {(setup.regime.er * 100).toFixed(0)}% · chop {setup.regime.chop.toFixed(0)}
        </Badge>
        <Badge tone={htfTone}>
          HTF trend ({htfInterval}): {htfLabel}
        </Badge>
        {htf !== null && setup.biasLabel !== 'NEUTRAL' && Math.sign(htf) !== (setup.biasLabel === 'LONG' ? 1 : -1) ? (
          <Badge tone="warn">Bias fights HTF trend</Badge>
        ) : null}
      </div>
    </Panel>
  )
}

function PlanCard({
  plan,
  preferred,
  biasLabel,
  active,
  onTrade,
}: {
  plan: TradePlan
  preferred: boolean
  biasLabel: string
  active: boolean
  onTrade: () => void
}) {
  const isLong = plan.side === 'LONG'
  return (
    <section
      className={clsx(
        'panel p-4',
        active
          ? isLong
            ? 'ring-2 ring-emerald-500/60'
            : 'ring-2 ring-rose-500/60'
          : preferred && (isLong ? 'ring-1 ring-emerald-500/40' : 'ring-1 ring-rose-500/40'),
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isLong ? 'up' : 'down'}>{plan.side}</Badge>
          {preferred && <Badge tone="accent">Preferred · bias {biasLabel}</Badge>}
          {plan.counterTrend && <Badge tone="down">Counter-trend</Badge>}
          {!plan.valid && !plan.counterTrend && <Badge tone="warn">Weak</Badge>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Quality</div>
            <div className="tabular text-sm font-semibold text-zinc-100">{plan.quality.toFixed(0)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Confidence</div>
            <div className="tabular text-sm font-semibold text-zinc-100">{plan.confidence.toFixed(0)}%</div>
          </div>
          <button
            onClick={onTrade}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-semibold',
              isLong ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-rose-500 text-zinc-950 hover:bg-rose-400',
            )}
          >
            Trade {plan.side}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Entry zone" value={`${fmtPrice(plan.entryLow)} – ${fmtPrice(plan.entryHigh)}`} accent />
        <Metric label="Stop" value={fmtPrice(plan.stop)} tone="down" />
        <Metric label="R:R (TP1)" value={plan.rr ? `${plan.rr.toFixed(2)}` : '—'} />
        <Metric label="TP1" value={fmtPrice(plan.tp1)} tone="up" />
        <Metric label="TP2" value={fmtPrice(plan.tp2)} tone="up" />
        <Metric label="Entry" value={fmtPrice(plan.entry)} />
      </div>

      {plan.note && <p className="mt-3 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{plan.note}</p>}

      {plan.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">
          {plan.reasons.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-zinc-600">•</span>
              {r}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StraddleCard({ straddle, interval }: { straddle: RangeStraddlePlan; interval: string }) {
  const { support, resistance, long, short, backtest } = straddle
  return (
    <section
      className={clsx('panel p-4', straddle.valid ? 'ring-2 ring-cyan-500/60' : 'ring-1 ring-zinc-700/60')}
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Both directions · range straddle</Badge>
          {straddle.valid ? <Badge tone="up">Valid setup</Badge> : <Badge tone="warn">Not valid here</Badge>}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Quality</div>
          <div className="tabular text-sm font-semibold text-zinc-100">{straddle.quality.toFixed(0)}</div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Resistance (LONG TP)" value={resistance ? fmtPrice(resistance.price) : '—'} tone="down" />
        <Metric label="Support (SHORT TP)" value={support ? fmtPrice(support.price) : '—'} tone="up" />
        <Metric label="Range width" value={`${(straddle.rangePct * 100).toFixed(2)}%`} />
        <Metric label="Both-TP R:R" value={straddle.bestCaseR ? straddle.bestCaseR.toFixed(2) : '—'} accent />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LegBox label="LONG → resistance" tone="up" leg={long} />
        <LegBox label="SHORT → support" tone="down" leg={short} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {resistance && (
          <Badge tone="neutral">
            Resistance strength {(resistance.strength * 100).toFixed(0)}% · {resistance.sources.join(', ')}
          </Badge>
        )}
        {support && (
          <Badge tone="neutral">
            Support strength {(support.strength * 100).toFixed(0)}% · {support.sources.join(', ')}
          </Badge>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
          Range-reversal backtest ({interval}) — do these levels actually reverse price?
        </div>
        {backtest ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label="Both-TP rate"
                value={`${(backtest.bounceRate * 100).toFixed(0)}%`}
                tone={backtest.bounceRate >= 0.5 ? 'up' : 'down'}
              />
              <Metric
                label="Win rate"
                value={`${(backtest.winRate * 100).toFixed(0)}%`}
                tone={backtest.winRate >= 0.5 ? 'up' : 'down'}
              />
              <Metric
                label="Expectancy"
                value={`${backtest.expectancy >= 0 ? '+' : ''}${backtest.expectancy.toFixed(2)}R`}
                tone={backtest.expectancy >= 0 ? 'up' : 'down'}
              />
              <Metric label="Samples" value={`${backtest.samples}`} />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {backtest.bothTp}/{backtest.samples} straddles saw both legs take profit (the range held and price
              reversed to the far side) over {backtest.lookbackBars} bars.
              {backtest.samples < 8 ? ' Small sample — treat with caution.' : ''}
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-500">Not enough history to validate range reversals.</p>
        )}
      </div>

      {straddle.note && (
        <p className="mt-3 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{straddle.note}</p>
      )}

      {straddle.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-400">
          {straddle.reasons.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-zinc-600">•</span>
              {r}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LegBox({ label, tone, leg }: { label: string; tone: 'up' | 'down'; leg: RangeStraddleLeg | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-2.5">
      <div className={clsx('mb-1.5 text-xs font-semibold', tone === 'up' ? 'text-emerald-400' : 'text-rose-400')}>
        {label}
      </div>
      {leg ? (
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          <div>
            <div className="text-zinc-600">Entry (mkt)</div>
            <div className="tabular text-zinc-200">{fmtPrice(leg.entry)}</div>
          </div>
          <div>
            <div className="text-zinc-600">TP</div>
            <div className="tabular text-emerald-300">{fmtPrice(leg.tp)}</div>
          </div>
          <div>
            <div className="text-zinc-600">Stop</div>
            <div className="tabular text-rose-300">{fmtPrice(leg.stop)}</div>
          </div>
          <div className="col-span-3 mt-0.5 text-zinc-600">R:R {leg.rr.toFixed(2)}</div>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-600">n/a</div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
  accent,
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
  accent?: boolean
}) {
  return (
    <div className={clsx('rounded-lg border border-zinc-800 px-2.5 py-2', accent && 'bg-zinc-800/30')}>
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

function LevelsTable({ setup }: { setup: SetupResult }) {
  const rows = [...setup.levels]
    .sort((a, b) => b.price - a.price)
    .filter((l) => l.strength >= 0.3)
  if (rows.length === 0) return <EmptyState title="No significant levels" />
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#0c111b]">
          <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-1">Price</th>
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Strength</th>
            <th className="px-2 py-1">Sources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i} className="border-b border-zinc-800/40">
              <td className="px-2 py-1 tabular text-zinc-200">{fmtPrice(l.price)}</td>
              <td className={'px-2 py-1 font-medium ' + (l.side === 'support' ? 'text-emerald-400' : 'text-rose-400')}>
                {l.side === 'support' ? 'Support' : 'Resistance'}
              </td>
              <td className="px-2 py-1">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={l.side === 'support' ? 'h-full bg-emerald-500' : 'h-full bg-rose-500'}
                    style={{ width: `${Math.round(l.strength * 100)}%` }}
                  />
                </div>
              </td>
              <td className="px-2 py-1 text-zinc-500">{l.sources.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FactorList({ setup }: { setup: SetupResult }) {
  if (setup.factors.length === 0) return <EmptyState title="No factors available" />
  return (
    <div className="flex flex-col gap-2">
      {setup.factors.map((f, i) => {
        const pct = Math.round(((f.value + 1) / 2) * 100)
        return (
          <div key={i} className="flex items-center gap-3 text-xs">
            <div className="w-32 shrink-0">
              <div className="text-zinc-300">{f.label}</div>
              <div className="text-[10px] text-zinc-600">{f.detail}</div>
            </div>
            <div className="relative h-2 flex-1 rounded-full bg-zinc-800">
              <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-600" />
              <div
                className={clsx(
                  'absolute top-0 h-full rounded-full',
                  f.value >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/70',
                )}
                style={
                  f.value >= 0
                    ? { left: '50%', width: `${(pct - 50)}%` }
                    : { right: '50%', width: `${(50 - pct)}%` }
                }
              />
            </div>
            <div className="w-10 shrink-0 text-right tabular text-zinc-400">
              {f.value >= 0 ? '+' : ''}
              {(f.value * 100).toFixed(0)}
            </div>
          </div>
        )
      })}
      <p className="mt-1 text-[10px] text-zinc-600">
        Weighted by reliability; only available signals are counted{setup.hasLiquidity ? '' : ' (liquidity & derivatives unavailable here)'}.
      </p>
    </div>
  )
}
