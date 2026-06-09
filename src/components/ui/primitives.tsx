import type { ReactNode } from 'react'
import clsx from 'clsx'

export function Panel({
  children,
  className,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className={clsx('panel p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'up' | 'down'
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={clsx(
          'mt-1 text-xl font-semibold tabular',
          tone === 'up' && 'text-emerald-400',
          tone === 'down' && 'text-rose-400',
          tone === 'default' && 'text-zinc-100',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500 tabular">{sub}</div>}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'up' | 'down' | 'accent' | 'warn'
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-zinc-800 text-zinc-300',
        tone === 'up' && 'bg-emerald-500/15 text-emerald-400',
        tone === 'down' && 'bg-rose-500/15 text-rose-400',
        tone === 'accent' && 'bg-cyan-500/15 text-cyan-300',
        tone === 'warn' && 'bg-amber-500/15 text-amber-300',
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
      {label ?? 'Loading…'}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 py-8 text-center">
      <p className="text-sm text-zinc-400">{title}</p>
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
      {msg}
    </div>
  )
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span
        className={clsx(
          'h-2 w-2 rounded-full',
          connected ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70' : 'bg-zinc-600',
        )}
      />
      {connected ? 'Live' : 'Offline'}
    </span>
  )
}
