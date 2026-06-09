import { useState } from 'react'
import { useCredentials } from '../../store/credentials'
import { testConnection } from '../../lib/bitunix/rest'
import type { AccountRaw } from '../../lib/bitunix/types'
import { Panel, Badge } from '../../components/ui/primitives'
import { fmtUsd } from '../../lib/format'

export function SettingsPage() {
  const { apiKey, secretKey, marginCoin, setCredentials, clear } = useCredentials()
  const liveTradingEnabled = useCredentials((s) => s.liveTradingEnabled)
  const setLiveTradingEnabled = useCredentials((s) => s.setLiveTradingEnabled)
  const [localKey, setLocalKey] = useState(apiKey)
  const [localSecret, setLocalSecret] = useState(secretKey)
  const [localCoin, setLocalCoin] = useState(marginCoin || 'USDT')
  const [showSecret, setShowSecret] = useState(false)
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')
  const [account, setAccount] = useState<AccountRaw | null>(null)

  function save() {
    setCredentials({ apiKey: localKey.trim(), secretKey: localSecret.trim(), marginCoin: localCoin.trim() || 'USDT' })
    setStatus('idle')
    setMessage('Saved to this browser (localStorage).')
  }

  async function test() {
    setCredentials({ apiKey: localKey.trim(), secretKey: localSecret.trim(), marginCoin: localCoin.trim() || 'USDT' })
    setStatus('testing')
    setMessage('')
    setAccount(null)
    try {
      const acct = await testConnection(localCoin.trim() || 'USDT')
      setAccount(acct)
      setStatus('ok')
      setMessage('Connection successful.')
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  function reset() {
    clear()
    setLocalKey('')
    setLocalSecret('')
    setLocalCoin('USDT')
    setStatus('idle')
    setMessage('Credentials cleared.')
    setAccount(null)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Connect your Bitunix account</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Create a futures API key in your Bitunix account and paste it below. Keys are stored only in
          this browser and used to sign requests locally.
        </p>
      </div>

      <Panel title="API credentials">
        <div className="flex flex-col gap-4">
          <Field label="API Key">
            <input
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              placeholder="api-key"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
            />
          </Field>

          <Field label="API Secret">
            <div className="flex gap-2">
              <input
                value={localSecret}
                onChange={(e) => setLocalSecret(e.target.value)}
                placeholder="secret-key"
                type={showSecret ? 'text' : 'password'}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
              />
              <button
                onClick={() => setShowSecret((v) => !v)}
                className="rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="Margin coin">
            <input
              value={localCoin}
              onChange={(e) => setLocalCoin(e.target.value.toUpperCase())}
              placeholder="USDT"
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={test}
              disabled={status === 'testing' || !localKey || !localSecret}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400 disabled:opacity-40"
            >
              {status === 'testing' ? 'Testing…' : 'Test & Save'}
            </button>
            <button
              onClick={save}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Save
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
            >
              Clear
            </button>

            {status === 'ok' && <Badge tone="up">Connected</Badge>}
            {status === 'error' && <Badge tone="down">Failed</Badge>}
          </div>

          {message && (
            <p className={status === 'error' ? 'text-sm text-rose-300' : 'text-sm text-zinc-400'}>{message}</p>
          )}

          {account && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:grid-cols-4">
              <Mini label="Available" value={fmtUsd(account.available)} />
              <Mini label="Margin" value={fmtUsd(account.margin)} />
              <Mini label="Frozen" value={fmtUsd(account.frozen)} />
              <Mini label="Mode" value={account.positionMode} />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Live trading" subtitle="Allow this app to place real orders on your account">
        <div className="flex items-start justify-between gap-4">
          <div className="text-sm text-zinc-400">
            <p>
              When enabled, the Setup tab can open real futures positions (with leverage, margin and
              attached TP/SL) on your Bitunix account. Every order still requires a confirmation.
            </p>
            <p className="mt-2 text-amber-300/80">
              This uses real funds and can result in losses or liquidation. Keep it off unless you
              intend to trade from here.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={liveTradingEnabled}
            onClick={() => setLiveTradingEnabled(!liveTradingEnabled)}
            className={
              'relative h-7 w-12 shrink-0 rounded-full transition ' +
              (liveTradingEnabled ? 'bg-emerald-500' : 'bg-zinc-700')
            }
          >
            <span
              className={
                'absolute top-1 h-5 w-5 rounded-full bg-white transition ' +
                (liveTradingEnabled ? 'left-6' : 'left-1')
              }
            />
          </button>
        </div>
        <div className="mt-3">
          <Badge tone={liveTradingEnabled ? 'up' : 'neutral'}>
            {liveTradingEnabled ? 'Live trading ENABLED' : 'Live trading disabled'}
          </Badge>
        </div>
      </Panel>

      <Panel title="How it works" subtitle="Architecture & privacy">
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            This is a frontend-only app. There is no database. A thin reverse-proxy (nginx) in the same
            container only forwards REST calls to Bitunix/Binance to bypass browser CORS.
          </li>
          <li>
            Requests are signed in your browser using the Bitunix double SHA-256 scheme via the Web
            Crypto API. The secret stays in <code className="text-zinc-300">localStorage</code> on this
            device.
          </li>
          <li>
            Account &amp; trade history come from Bitunix. Deep order-book liquidity, liquidations, open
            interest and long/short ratios come from Binance public data (no key required).
          </li>
          <li className="text-amber-300/80">
            Use an API key with read-only / no-withdrawal permissions for safety.
          </li>
        </ul>
      </Panel>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular text-zinc-100">{value}</div>
    </div>
  )
}
