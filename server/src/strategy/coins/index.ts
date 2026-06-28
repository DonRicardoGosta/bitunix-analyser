import { registerStrategy } from '../registry'
import { btcStrategy } from './btcusdt'
import { ethStrategy } from './ethusdt'
import { solStrategy } from './solusdt'

// Register every per-coin module. Importing this file wires them into the
// registry; add new coin strategies here.
export function registerCoinStrategies(): void {
  registerStrategy(btcStrategy)
  registerStrategy(ethStrategy)
  registerStrategy(solStrategy)
}
