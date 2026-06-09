import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMarket } from '../../../store/market'
import { useCandles } from '../useCandles'
import { useOrderBook } from '../useOrderBook'
import { useOpenInterest, useLongShort, useTakerFlow } from '../useDerivatives'
import { useAccount } from '../../stats/useStats'
import { toBinancePeriod } from '../../../lib/bitunix/intervals'
import { getFundingRate } from '../../../lib/bitunix/rest'
import { buildSetup, type SetupResult, type TradePlan } from '../setup/engine'
import { SetupChart, type PriceLineDef } from '../../../components/charts/SetupChart'
import { Panel, Spinner, EmptyState, Badge } from '../../../components/ui/primitives'
import { BinanceNote } from '../controls'
import { fmtPrice, fmtUsd, fmtCompact, toNum } from '../../../lib/format'

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
  const funding = useQuery({
    queryKey: ['funding', symbol],
    queryFn: () => getFundingRate(symbol),
    refetchInterval: 30_000,
    retry: 0,
  })
  const account = useAccount()

  const [overlaySide, setOverlaySide] = useState<'LONG' | 'SHORT'>('LONG')
  const [showLevels, setShowLevels] = useState(true)
  const [riskPct, setRiskPct] = useState(1)

  const setup = useMemo<SetupResult | null>(() => {
    if (candles.length < 30) return null
    return buildSetup({
      candles,
      book,
      derivatives: {
        oi: oi.data,
        longShort: ls.data?.global,
        taker: taker.data,
        fundingRate: funding.data ? toNum(funding.data.fundingRate) : undefined,
      },
    })
  }, [candles, book, oi.data, ls.data, taker.data, funding.data])

  // Default the chart overlay to the bias-preferred side once computed.
  const preferred = setup ? (setup.bias >= 0 ? 'LONG' : 'SHORT') : 'LONG'

  const lines = useMemo<PriceLineDef[]>(() => {
    if (!setup) return []
    const plan = overlaySide === 'LONG' ? setup.long : setup.short
    const isLong = overlaySide === 'LONG'
    const out: PriceLineDef[] = [
      { price: plan.entry, color: isLong ? '#22c55e' : '#ef4444', title: `${overlaySide} entry`, width: 2 },
      { price: plan.stop, color: '#f43f5e', title: 'Stop', dashed: true },
      { price: plan.tp1, color: '#22d3ee', title: 'TP1' },
      { price: plan.tp2, color: '#14b8a6', title: 'TP2' },
    ]
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
  }, [setup, overlaySide, showLevels])

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

      <BiasMeter setup={setup} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlanCard plan={setup.long} preferred={preferred === 'LONG'} biasLabel={setup.biasLabel} />
        <PlanCard plan={setup.short} preferred={preferred === 'SHORT'} biasLabel={setup.biasLabel} />
      </div>

      <Panel
        title="Setup map"
        subtitle="Entry / stop / targets plotted with key support & resistance"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
              {(['LONG', 'SHORT'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setOverlaySide(s)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    overlaySide === s
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
        <SetupChart candles={candles} lines={lines} height={460} />
      </Panel>

      {account.data ? (
        <RiskSizer
          plan={overlaySide === 'LONG' ? setup.long : setup.short}
          equity={toNum(account.data.available) + toNum(account.data.margin)}
          riskPct={riskPct}
          setRiskPct={setRiskPct}
        />
      ) : null}

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

function BiasMeter({ setup }: { setup: SetupResult }) {
  const pct = ((setup.bias + 1) / 2) * 100
  const tone =
    setup.biasLabel === 'LONG' ? 'text-emerald-400' : setup.biasLabel === 'SHORT' ? 'text-rose-400' : 'text-zinc-300'
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
    </Panel>
  )
}

function PlanCard({
  plan,
  preferred,
  biasLabel,
}: {
  plan: TradePlan
  preferred: boolean
  biasLabel: string
}) {
  const isLong = plan.side === 'LONG'
  return (
    <section
      className={clsx(
        'panel p-4',
        preferred && (isLong ? 'ring-1 ring-emerald-500/40' : 'ring-1 ring-rose-500/40'),
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={isLong ? 'up' : 'down'}>{plan.side}</Badge>
          {preferred && <Badge tone="accent">Preferred · bias {biasLabel}</Badge>}
          {!plan.valid && <Badge tone="warn">Weak</Badge>}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Confidence</div>
          <div className="tabular text-sm font-semibold text-zinc-100">{plan.confidence.toFixed(0)}%</div>
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

function RiskSizer({
  plan,
  equity,
  riskPct,
  setRiskPct,
}: {
  plan: TradePlan
  equity: number
  riskPct: number
  setRiskPct: (v: number) => void
}) {
  const riskAmount = (equity * riskPct) / 100
  const perUnitRisk = Math.abs(plan.entry - plan.stop)
  const qty = perUnitRisk > 0 ? riskAmount / perUnitRisk : 0
  const notional = qty * plan.entry
  return (
    <Panel title="Position sizing" subtitle={`Based on your available balance (${fmtUsd(equity)}) and ${plan.side} stop`}>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Risk
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={riskPct}
            onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value) || 0.1))}
            className="w-20 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-cyan-500"
          />
          %
        </label>
        <Metric label="Risk amount" value={fmtUsd(riskAmount)} tone="down" />
        <Metric label="Position size" value={`${fmtCompact(qty, 3)} ${''}`} />
        <Metric label="Notional" value={`$${fmtCompact(notional)}`} />
      </div>
    </Panel>
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
