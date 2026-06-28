import { z } from 'zod'

// Zod schemas for the REST surface. Parsed at the edge so route handlers and
// the manager work with already-validated, well-typed inputs.

const riskLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const coinConfigSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  leverage: z.number().positive(),
  orderQty: z.number().positive(),
  marginAllocated: z.number().positive(),
  riskLevel: riskLevelSchema,
  strategyId: z.string().min(1).optional(),
})

export const challengeConfigInputSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(['live', 'paper']),
  startBalance: z.number().positive(),
  maxAccountUsagePct: z.number().min(0).max(100),
  profitTargetPct: z.number().positive(),
  maxLossPct: z.number().positive(),
  coins: z.array(coinConfigSchema).min(1),
})

export const credentialsSchema = z.object({
  apiKey: z.string().min(1),
  secretKey: z.string().min(1),
  marginCoin: z.string().min(1).optional(),
})

export const riskUpdateSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  riskLevel: riskLevelSchema,
})

export const minMarginQuerySchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  leverage: z.coerce.number().positive(),
})
