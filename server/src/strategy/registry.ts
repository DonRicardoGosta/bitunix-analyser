import { defaultStrategy } from './default'
import type { Strategy } from './types'

// Strategy registry (item 7): symbol -> strategy with a default fallback. New
// per-coin modules self-register via registerStrategy, so adding a strategy is
// a single import + register call (see ./coins).

const bySymbol = new Map<string, Strategy>()
const all = new Set<Strategy>([defaultStrategy])
let fallback: Strategy = defaultStrategy

export function registerStrategy(strategy: Strategy): void {
  all.add(strategy)
  for (const sym of strategy.symbols ?? []) {
    bySymbol.set(sym.toUpperCase(), strategy)
  }
}

export function setDefaultStrategy(strategy: Strategy): void {
  fallback = strategy
  all.add(strategy)
}

export function resolveStrategy(symbol: string, strategyId?: string): Strategy {
  if (strategyId) {
    for (const s of all) if (s.id === strategyId) return s
  }
  return bySymbol.get(symbol.toUpperCase()) ?? fallback
}

export function allStrategies(): Strategy[] {
  return [...all]
}
