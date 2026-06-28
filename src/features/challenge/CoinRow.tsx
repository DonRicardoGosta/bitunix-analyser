import type { CoinConfig, RiskLevel } from '@shared/challenge/types'
import { toNum, fmtUsd } from '../../lib/format'
import { Badge } from '../../components/ui/primitives'
import type { StrategyInfo } from '../../lib/challenge/api'
import { useMinMargin } from './useChallengeData'
import { INPUT, RISK_LEVELS, RISK_META } from './shared'

export function CoinRow({
  index,
  coin,
  strategies,
  onUpdate,
  onRemove,
  canRemove,
}: {
  index: number
  coin: CoinConfig
  strategies: StrategyInfo[] | undefined
  onUpdate: (patch: Partial<CoinConfig>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const mm = useMinMargin(coin.symbol, coin.leverage, true)
  const belowMin = Boolean(mm.data && mm.data.minMargin > 0 && coin.marginAllocated < mm.data.minMargin)
  const notional = coin.orderQty * (mm.data?.price ?? 0)
  const marginForQty = coin.leverage > 0 ? notional / coin.leverage : 0

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Symbol
          <input
            value={coin.symbol}
            onChange={(e) => onUpdate({ symbol: e.target.value.toUpperCase().trim() })}
            className={INPUT + ' w-28 uppercase'}
            placeholder="BTCUSDT"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Leverage
          <input
            type="number"
            min={1}
            value={coin.leverage}
            onChange={(e) => onUpdate({ leverage: toNum(e.target.value, 1) })}
            className={INPUT + ' w-20'}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Order size (qty)
          <input
            type="number"
            min={0}
            step="any"
            value={coin.orderQty}
            onChange={(e) => onUpdate({ orderQty: toNum(e.target.value) })}
            className={INPUT + ' w-28'}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Margin (USDT)
          <input
            type="number"
            min={0}
            step="any"
            value={coin.marginAllocated}
            onChange={(e) => onUpdate({ marginAllocated: toNum(e.target.value) })}
            className={INPUT + ' w-28' + (belowMin ? ' border-rose-500' : '')}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Risk level
          <select
            value={coin.riskLevel}
            onChange={(e) => onUpdate({ riskLevel: Number(e.target.value) as RiskLevel })}
            className={INPUT + ' w-32'}
          >
            {RISK_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {RISK_META[lvl].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Strategy
          <select
            value={coin.strategyId ?? ''}
            onChange={(e) => onUpdate({ strategyId: e.target.value || undefined })}
            className={INPUT + ' w-40'}
          >
            <option value="">Auto (by symbol)</option>
            {(strategies ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="ml-auto rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          title={canRemove ? 'Remove coin' : 'At least one coin is required'}
        >
          Remove
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <span>Coin #{index + 1}</span>
        {mm.data && (
          <span>
            Min margin <span className="text-zinc-300">{fmtUsd(mm.data.minMargin)}</span> · price{' '}
            <span className="text-zinc-300">{fmtUsd(mm.data.price)}</span>
          </span>
        )}
        {marginForQty > 0 && (
          <span>
            Order notional <span className="text-zinc-300">{fmtUsd(notional)}</span> (~
            {fmtUsd(marginForQty)} margin)
          </span>
        )}
        {belowMin && <Badge tone="down">Below minimum margin</Badge>}
      </div>
    </div>
  )
}
