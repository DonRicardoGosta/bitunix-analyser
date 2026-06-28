import { randomUUID } from 'node:crypto'
import { config } from '../config'
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

// Virtual execution engine (item 10). No orders are sent to Bitunix. Balance,
// margin and PnL are computed from the live feed price; positions persist in the
// same SQLite tables (tagged by challenge) but are never reconciled with the
// exchange, so Paper and Live state stay isolated.
export class PaperExecutionEngine implements ExecutionEngine {
  readonly mode = 'paper' as const

  constructor(
    readonly challengeId: string,
    private readonly startBalance: number,
    private readonly ctx: ExecContext,
  ) {}

  private realizedPnl(): number {
    return positionsRepo
      .listByChallenge(this.challengeId)
      .filter((p) => p.status === 'closed')
      .reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
  }

  private usedMargin(): number {
    return positionsRepo.listOpenByChallenge(this.challengeId).reduce((s, p) => s + p.margin, 0)
  }

  async getAvailableBalance(): Promise<number> {
    return this.startBalance + this.realizedPnl() - this.usedMargin()
  }

  async openPosition(req: OpenRequest): Promise<OpenResult> {
    const slip = config.paperSlippagePct
    // Fills cross the spread against us.
    const fillPrice = req.side === 'LONG' ? req.price * (1 + slip) : req.price * (1 - slip)
    const margin = (req.qty * fillPrice) / req.leverage
    const available = await this.getAvailableBalance()
    if (margin > available + 1e-9) {
      const msg = `paper: insufficient virtual balance (need ${margin.toFixed(2)} USDT, have ${available.toFixed(2)})`
      this.ctx.emitError(req.symbol, msg)
      return { ok: false, error: msg }
    }
    const entryFee = req.qty * fillPrice * config.paperTakerFee
    const pos: StoredPosition = {
      id: randomUUID(),
      challengeId: this.challengeId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      entryPrice: fillPrice,
      leverage: req.leverage,
      margin,
      riskLevel: req.riskLevel,
      strategyId: req.strategyId,
      status: 'open',
      fee: entryFee,
      paramsSnapshot: req.paramsSnapshot,
      openedAt: Date.now(),
    }
    positionsRepo.insert(pos)
    this.ctx.emitApi(
      req.symbol,
      `paper open ${req.side} ${req.qty} @ ${fillPrice.toFixed(4)} (x${req.leverage})`,
      { margin: Number(margin.toFixed(2)), fee: Number(entryFee.toFixed(4)) },
    )
    return { ok: true, position: pos }
  }

  async closePosition(position: StoredPosition, price: number, reason: string): Promise<CloseResult> {
    const slip = config.paperSlippagePct
    const fillPrice = position.side === 'LONG' ? price * (1 - slip) : price * (1 + slip)
    const gross = grossPnl(position.side, position.qty, position.entryPrice, fillPrice)
    const exitFee = position.qty * fillPrice * config.paperTakerFee
    const realized = gross - position.fee - exitFee
    positionsRepo.close(position.id, {
      closePrice: fillPrice,
      realizedPnl: realized,
      fee: exitFee,
    })
    this.ctx.emitApi(
      position.symbol,
      `paper close ${position.side} @ ${fillPrice.toFixed(4)} (${reason})`,
      { realizedPnl: Number(realized.toFixed(2)) },
    )
    return { ok: true, realizedPnl: realized, closePrice: fillPrice }
  }
}
