import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { ChallengeConfigInput, TradingMode } from '@shared/challenge/types'
import { useChallengeDraft } from '../../store/challenge'
import { useCredentials, getCredentials } from '../../store/credentials'
import { toNum } from '../../lib/format'
import { Panel, Badge, ErrorNote } from '../../components/ui/primitives'
import { CoinRow } from './CoinRow'
import { CapitalSummary } from './CapitalSummary'
import { INPUT, MODE_META } from './shared'
import {
  useBackendHealth,
  useCredentialsStatus,
  useCreateChallenge,
  useSetCredentials,
  useStrategies,
  useValidation,
} from './useChallengeData'

export function ChallengeBuilder() {
  const draft = useChallengeDraft()
  const liveTradingEnabled = useCredentials((s) => s.liveTradingEnabled)
  const hasKeys = useCredentials((s) => s.hasKeys())

  const health = useBackendHealth()
  const backendOnline = health.isSuccess
  const credStatus = useCredentialsStatus()
  const strategies = useStrategies()
  const setCredentials = useSetCredentials()
  const create = useCreateChallenge()

  const config: ChallengeConfigInput = useMemo(
    () => ({
      name: draft.name,
      mode: draft.mode,
      startBalance: draft.startBalance,
      maxAccountUsagePct: draft.maxAccountUsagePct,
      profitTargetPct: draft.profitTargetPct,
      maxLossPct: draft.maxLossPct,
      coins: draft.coins,
    }),
    [
      draft.name,
      draft.mode,
      draft.startBalance,
      draft.maxAccountUsagePct,
      draft.profitTargetPct,
      draft.maxLossPct,
      draft.coins,
    ],
  )

  const liveReady = draft.mode === 'live' ? liveTradingEnabled && hasKeys : true

  // Forward stored API keys to the backend once when entering Live mode so that
  // validation (which reads the live account balance) and execution can work.
  useEffect(() => {
    if (
      draft.mode === 'live' &&
      hasKeys &&
      liveTradingEnabled &&
      credStatus.data &&
      !credStatus.data.hasCredentials &&
      !setCredentials.isPending
    ) {
      setCredentials.mutate(getCredentials())
    }
  }, [draft.mode, hasKeys, liveTradingEnabled, credStatus.data, setCredentials])

  const validationEnabled = backendOnline && config.coins.length > 0 && liveReady
  const validation = useValidation(config, validationEnabled)
  const canStart =
    backendOnline && liveReady && validation.data?.ok === true && !create.isPending

  const onStart = async () => {
    if (draft.mode === 'live' && hasKeys) {
      try {
        await setCredentials.mutateAsync(getCredentials())
      } catch {
        // surfaced via create error path below if it matters
      }
    }
    create.mutate(config)
  }

  return (
    <Panel
      title="New challenge"
      subtitle="Multi-coin automated run executed by the backend engine"
      actions={
        <Badge tone={MODE_META[draft.mode].tone}>{MODE_META[draft.mode].label} MODE</Badge>
      }
    >
      {!backendOnline && (
        <div className="mb-3">
          <ErrorNote
            error={
              health.isLoading
                ? 'Connecting to challenge backend…'
                : 'Challenge backend is offline. Start the backend service to create challenges.'
            }
          />
        </div>
      )}

      {/* Mode toggle (item 10) */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-700">
          {(['paper', 'live'] as TradingMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => draft.setField('mode', m)}
              className={
                'px-3 py-1.5 text-xs font-medium transition ' +
                (draft.mode === m
                  ? m === 'live'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-cyan-500/20 text-cyan-300'
                  : 'text-zinc-400 hover:bg-zinc-800')
              }
            >
              {m === 'live' ? 'Live trading' : 'Paper trading'}
            </button>
          ))}
        </div>
        {draft.mode === 'live' && !liveTradingEnabled && (
          <span className="text-xs text-amber-400">
            Live trading is disabled.{' '}
            <Link to="/settings" className="underline hover:text-amber-300">
              Enable it in Settings
            </Link>{' '}
            and add API keys.
          </span>
        )}
        {draft.mode === 'live' && liveTradingEnabled && !hasKeys && (
          <span className="text-xs text-amber-400">
            Add Bitunix API keys in{' '}
            <Link to="/settings" className="underline hover:text-amber-300">
              Settings
            </Link>
            .
          </span>
        )}
        {draft.mode === 'paper' && (
          <span className="text-xs text-zinc-500">
            Simulated balance &amp; positions — same strategy and risk logic as live.
          </span>
        )}
      </div>

      {/* Top-level config */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Name
          <input
            value={draft.name}
            onChange={(e) => draft.setField('name', e.target.value)}
            className={INPUT + ' w-48'}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Start balance (USDT)
          <input
            type="number"
            min={0}
            value={draft.startBalance}
            onChange={(e) => draft.setField('startBalance', toNum(e.target.value))}
            className={INPUT + ' w-32'}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Max account usage (%)
          <input
            type="number"
            min={1}
            max={100}
            value={draft.maxAccountUsagePct}
            onChange={(e) => draft.setField('maxAccountUsagePct', toNum(e.target.value))}
            className={INPUT + ' w-32'}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Profit target (%)
          <input
            type="number"
            min={1}
            value={draft.profitTargetPct}
            onChange={(e) => draft.setField('profitTargetPct', toNum(e.target.value))}
            className={INPUT + ' w-28'}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Max loss (%)
          <input
            type="number"
            min={1}
            max={100}
            value={draft.maxLossPct}
            onChange={(e) => draft.setField('maxLossPct', toNum(e.target.value))}
            className={INPUT + ' w-28'}
          />
        </label>
      </div>

      {/* Coins (item 3) */}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Coins ({draft.coins.length})
        </h4>
        <button
          type="button"
          onClick={() => draft.addCoin()}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          + Add coin
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {draft.coins.map((coin, i) => (
          <CoinRow
            key={i}
            index={i}
            coin={coin}
            strategies={strategies.data}
            onUpdate={(patch) => draft.updateCoin(i, patch)}
            onRemove={() => draft.removeCoin(i)}
            canRemove={draft.coins.length > 1}
          />
        ))}
      </div>

      {/* Capital validation (item 3) */}
      <div className="mt-4">
        <CapitalSummary
          result={validation.data}
          loading={validation.isFetching}
          error={validation.error}
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onStart()}
          disabled={!canStart}
          className={
            'rounded-lg px-4 py-2 text-sm font-medium transition ' +
            (canStart
              ? draft.mode === 'live'
                ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                : 'bg-cyan-500 text-zinc-950 hover:bg-cyan-400'
              : 'cursor-not-allowed bg-zinc-800 text-zinc-500')
          }
        >
          {create.isPending
            ? 'Starting…'
            : draft.mode === 'live'
              ? 'Start live challenge'
              : 'Start paper challenge'}
        </button>
        <button
          type="button"
          onClick={() => draft.reset()}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Reset form
        </button>
        {create.isError && <ErrorNote error={create.error} />}
        {create.isSuccess && <span className="text-xs text-emerald-400">Challenge started.</span>}
      </div>
    </Panel>
  )
}
