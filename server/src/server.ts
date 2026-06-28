import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { logger } from './logger'

/**
 * Builds the Fastify application. Routes and the WebSocket hub are registered by
 * later wiring (see src/index.ts); this keeps the HTTP surface composable.
 *
 * All routes live under the `/api` prefix so the nginx / Vite proxy can forward
 * the path verbatim (no prefix stripping).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 })

  // Permit the SPA origin in dev (prod is same-origin via nginx).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', req.headers.origin ?? '*')
    reply.header('access-control-allow-headers', 'content-type')
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') reply.code(204).send()
  })

  await app.register(websocket)

  // Tolerate empty JSON bodies (e.g. POST /stop) instead of returning 400.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = typeof body === 'string' ? body.trim() : ''
      if (!text) {
        done(null, undefined)
        return
      }
      try {
        done(null, JSON.parse(text))
      } catch (err) {
        const e = err as Error & { statusCode?: number }
        e.statusCode = 400
        done(e, undefined)
      }
    },
  )

  app.get('/api/health', async () => ({ status: 'ok', ts: Date.now() }))

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    logger.error(`request error: ${err.message}`, err)
    reply.code(err.statusCode ?? 500).send({ error: err.message })
  })

  return app
}
