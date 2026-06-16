import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ModifyTpslOrderParams, PlaceTpslOrderParams, TpslOrderRaw } from '../../lib/bitunix/types'
import {
  cancelTpslOrder,
  flashClosePosition,
  modifyTpslOrder,
  placeTpslOrder,
} from '../../lib/bitunix/rest'
import { toNum } from '../../lib/format'
import { normalizeStopTypeExport } from './positionChart'

function invalidatePositionQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['pendingPositions'] })
  qc.invalidateQueries({ queryKey: ['positionTpsl'] })
  qc.invalidateQueries({ queryKey: ['account'] })
}

export function buildModifyTpslParams(
  order: TpslOrderRaw,
  kind: 'tp' | 'sl',
  price: string,
  qty: string,
): ModifyTpslOrderParams {
  const params: ModifyTpslOrderParams = { orderId: order.id }
  const tpPrice = toNum(order.tpPrice, NaN)
  const slPrice = toNum(order.slPrice, NaN)

  if (kind === 'tp') {
    params.tpPrice = price
    params.tpQty = qty
    params.tpStopType = normalizeStopTypeExport(order.tpStopType)
    if (Number.isFinite(slPrice) && slPrice > 0) {
      params.slPrice = order.slPrice
      params.slQty = order.slQty || qty
      params.slStopType = normalizeStopTypeExport(order.slStopType)
    }
  } else {
    params.slPrice = price
    params.slQty = qty
    params.slStopType = normalizeStopTypeExport(order.slStopType)
    if (Number.isFinite(tpPrice) && tpPrice > 0) {
      params.tpPrice = order.tpPrice
      params.tpQty = order.tpQty || qty
      params.tpStopType = normalizeStopTypeExport(order.tpStopType)
    }
  }

  return params
}

export function usePositionMutations() {
  const qc = useQueryClient()

  const closeMut = useMutation({
    mutationFn: (positionId: string) => flashClosePosition(positionId),
    onSuccess: () => invalidatePositionQueries(qc),
  })

  const addTpslMut = useMutation({
    mutationFn: (params: PlaceTpslOrderParams) => placeTpslOrder(params),
    onSuccess: () => invalidatePositionQueries(qc),
  })

  const modifyTpslMut = useMutation({
    mutationFn: (params: ModifyTpslOrderParams) => modifyTpslOrder(params),
    onSuccess: () => invalidatePositionQueries(qc),
  })

  const cancelTpslMut = useMutation({
    mutationFn: (params: { symbol: string; orderId: string }) => cancelTpslOrder(params),
    onSuccess: () => invalidatePositionQueries(qc),
  })

  return {
    closeMut,
    addTpslMut,
    modifyTpslMut,
    cancelTpslMut,
    isBusy:
      closeMut.isPending ||
      addTpslMut.isPending ||
      modifyTpslMut.isPending ||
      cancelTpslMut.isPending,
  }
}
