import clsx from 'clsx'
import { useMarket } from '../../../store/market'
import { useFavourites } from '../../../store/favourites'
import { useRecommended, type RecommendedItem } from '../recommend/useRecommended'
import { Panel, Spinner, EmptyState, ErrorNote, Badge } from '../../../components/ui/primitives'
import { fmtPrice, fmtPct, fmtCompact, pnlColor } from '../../../lib/format'

const POSITIVE_REASONS = new Set(['Clean trend', 'Trending', 'Healthy volatility', 'Liquid'])

export function RecommendedTab({ onAnalyze }: { onAnalyze: (symbol: string) => void }) {
  const interval = useMarket((s) => s.interval)
  const setSymbol = useMarket((s) => s.setSymbol)
  const current = useMarket((s) => s.symbol)
  const favourites = useFavourites((s) => s.symbols)
  const toggleFav = useFavourites((s) => s.toggle)

  const { data, isLoading, isFetching, error, refetch } = useRecommended(interval)
  const items = (data ?? []).slice(0, 12)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-zinc-500">
          Coins whose moves are currently the easiest to read on the{' '}
          <span className="text-zinc-300">{interval}</span> timeframe — ranked by trend cleanliness,
          low choppiness, healthy volatility and liquidity (Bitunix data). Not financial advice.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {isFetching ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {error ? <ErrorNote error={error} /> : null}

      {isLoading ? (
        <Panel>
          <Spinner label="Scanning the most liquid markets…" />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState title="No clear setups right now" hint="Try a different timeframe or refresh." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item, i) => (
            <RecCard
              key={item.symbol}
              rank={i + 1}
              item={item}
              active={item.symbol === current}
              isFav={favourites.includes(item.symbol)}
              onToggleFav={() => toggleFav(item.symbol)}
              onAnalyze={() => {
                setSymbol(item.symbol)
                onAnalyze(item.symbol)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500'
  if (score >= 50) return 'bg-cyan-500'
  if (score >= 35) return 'bg-amber-500'
  return 'bg-zinc-600'
}

function RecCard({
  rank,
  item,
  active,
  isFav,
  onToggleFav,
  onAnalyze,
}: {
  rank: number
  item: RecommendedItem
  active: boolean
  isFav: boolean
  onToggleFav: () => void
  onAnalyze: () => void
}) {
  const t = item.ticker
  return (
    <section className={clsx('panel p-3.5', active && 'ring-1 ring-cyan-500/40')}>
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">#{rank}</span>
          <button
            onClick={onToggleFav}
            title={isFav ? 'Remove favourite' : 'Add favourite'}
            className={clsx('text-base leading-none', isFav ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300')}
          >
            {isFav ? '★' : '☆'}
          </button>
          <span className="font-semibold text-zinc-100">{item.symbol}</span>
          <Badge tone={item.direction === 'LONG' ? 'up' : item.direction === 'SHORT' ? 'down' : 'neutral'}>
            {item.direction}
          </Badge>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Score</div>
          <div className="tabular text-sm font-semibold text-zinc-100">{item.score.toFixed(0)}</div>
        </div>
      </header>

      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={clsx('h-full', scoreColor(item.score))} style={{ width: `${item.score}%` }} />
      </div>

      <div className="mb-2 flex items-center gap-3 text-sm tabular">
        <span className="text-zinc-300">{fmtPrice(t.last)}</span>
        <span className={pnlColor(t.changePct)}>{fmtPct(t.changePct)}</span>
        <span className="text-zinc-600">Vol ${fmtCompact(t.quoteVol, 0)}</span>
        <span className="text-zinc-600">ER {(item.er * 100).toFixed(0)}%</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {item.reasons.map((r) => (
          <Badge key={r} tone={POSITIVE_REASONS.has(r) ? 'accent' : 'warn'}>
            {r}
          </Badge>
        ))}
      </div>

      <button
        onClick={onAnalyze}
        className="w-full rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25"
      >
        Analyze {item.symbol}
      </button>
    </section>
  )
}
