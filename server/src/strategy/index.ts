import { registerCoinStrategies } from './coins'

export { defaultStrategy } from './default'
export { allStrategies, registerStrategy, resolveStrategy, setDefaultStrategy } from './registry'
export type { Decision, DecisionAction, RiskParams, Strategy, StrategyContext } from './types'

let initialized = false

/** Register all built-in per-coin strategies (idempotent). */
export function initStrategies(): void {
  if (initialized) return
  initialized = true
  registerCoinStrategies()
}
