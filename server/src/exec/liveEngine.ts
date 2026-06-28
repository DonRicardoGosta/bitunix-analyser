import { randomUUID } from 'node:crypto'
import { toNum } from '@shared/num'
import { BitunixError, BitunixRest, getTradingPairs } from '../bitunix/rest'
import type { TradingPairRaw } from '../bitunix/types'
import { positionsRepo } from '../db/repos/positions'
import type { StoredPosition } from '../db/types'
import {
  grossPnl,
  type CloseResult,
  type ExecContext,
  type ExecutionEngine,
  type OpenRequest,
  type OpenResult,
} from './types'

// Live execution engine: sets leverage/margin mode then places market orders on
// Bitunix. Positions are tagged with the challenge so a failing challenge only
// closes its own positions (item 4). Leverage/margin settings are best-effort
// (ignored if the exchange rejects, e.g. an existing position on the symbol).
export class LiveExecutionEngine implements ExecutionEngine {
  readonly mode = 'live' as const
  private specs: Map<string, TradingPairRaw> | null = null

  constructor(
    readonly challengeId: string,
    private readonly rest: BitunixRest,
    private readonly ctx: ExecContext,
  ) {}

  private async spec(symbol: string): Promise<TradingPairRaw | undefined> {
    if (!this.specs) {
      const pairs = await getTradingPairs()
      this.specs = new Map(pairs.map((p) => [p.symbol, p]))
    }
    return this.specs.get(symbol)
  }

  private async roundQty(symbol: string, qty: number): Promise<number> {
    const s = await this.spec(symbol)
    const decimals = s?.basePrecision ?? 3
    const f = Math.pow(10, decimals)
    return Math.floor(qty * f) / f
  }

  async getAvailableBalance(): Promise<number> {
    const accts = await this.rest.getAccount()
    const a = Array.isArray(accts) ? accts[0] : accts
    return toNum(a?.available)
  }

  async openPosition(req: OpenRequest): Promise<OpenResult> {
    const qty = await this.roundQty(req.symbol, req.qty)
    if (qty <= 0) return { ok: false, error: 'qty rounds to 0 at the symbol precision' }
    try {
      try {
        await this.rest.changeMarginMode(req.symbol, 'ISOLATION')
      } catch {
        /* already set or has positions */
      }
      try {
        await this.rest.changeLeverage(req.symbol, req.leverage)
      } catch {
        /* already set or has positions */
      }

      const clientId = `ch${this.challengeId.slice(0, 8)}${Date.now().toString(36)}`
      this.ctx.emitApi(req.symbol, `placeOrder MARKET ${req.side} ${qty}`, { leverage: req.leverage })
      await this.rest.placeOrder({
        symbol: req.symbol,
        qty: String(qty),
        side: req.side === 'LONG' ? 'BUY' : 'SELL',
        orderType: 'MARKET',
        effect: 'GTC',
        reduceOnly: false,
        clientId,
      })

      let exchangePositionId: string | undefined
      let entryPrice = req.price
      try {
        const pendings = await this.rest.getPendingPositions(req.symbol)
        const match = pendings.find((p) => p.symbol === req.symbol)
        if (match) {
          exchangePositionId = match.positionId
          entryPrice = toNum(match.avgOpenPrice, req.price)
        }
      } catch {
        /* position lookup is best-effort */
      }

      const margin = (qty * entryPrice) / req.leverage
      const pos: StoredPosition = {
        id: randomUUID(),
        challengeId: this.challengeId,
        symbol: req.symbol,
        side: req.side,
        qty,
        entryPrice,
        leverage: req.leverage,
        margin,
        riskLevel: req.riskLevel,
        strategyId: req.strategyId,
        exchangePositionId,
        status: 'open',
        fee: 0,
        paramsSnapshot: req.paramsSnapshot,
        openedAt: Date.now(),
      }
      positionsRepo.insert(pos)
      return { ok: true, position: pos }
    } catch (err) {
      const msg = err instanceof BitunixError ? err.message : String(err)
      this.ctx.emitError(req.symbol, `live open failed: ${msg}`)
      return { ok: false, error: msg }
    }
  }

  async closePosition(position: StoredPosition, price: number, reason: string): Promise<CloseResult> {
    try {
      let realized = grossPnl(position.side, position.qty, position.entryPrice, price)
      if (position.exchangePositionId) {
        try {
          const pendings = await this.rest.getPendingPositions(position.symbol)
          const match = pendings.find((p) => p.positionId === position.exchangePositionId)
          if (match) realized = toNum(match.unrealizedPNL, realized) + toNum(match.realizedPNL, 0)
        } catch {
          /* fall back to computed PnL */
        }
        this.ctx.emitApi(position.symbol, `flashClose (${reason})`, {
          positionId: position.exchangePositionId,
        })
        await this.rest.flashClosePosition(position.exchangePositionId)
      } else {
        this.ctx.emitApi(position.symbol, `close via reduceOnly market (${reason})`)
        await this.rest.placeOrder({
          symbol: position.symbol,
          qty: String(position.qty),
          side: position.side === 'LONG' ? 'SELL' : 'BUY',
          orderType: 'MARKET',
          reduceOnly: true,
        })
      }
      positionsRepo.close(position.id, { closePrice: price, realizedPnl: realized })
      return { ok: true, realizedPnl: realized, closePrice: price }
    } catch (err) {
      const msg = err instanceof BitunixError ? err.message : String(err)
      this.ctx.emitError(position.symbol, `live close failed: ${msg}`)
      return { ok: false, error: msg }
    }
  }
}
