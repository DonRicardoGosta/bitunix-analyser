import { challengeManager } from './challenge/manager'
import { config } from './config'
import { logger } from './logger'
import { registerRoutes } from './routes'
import { buildServer } from './server'
import { registerWsHub } from './ws/hub'

async function main(): Promise<void> {
  const app = await buildServer()
  registerRoutes(app)
  registerWsHub(app)

  // Load credentials, register strategies, and resume any running challenges.
  challengeManager.init()

  await app.listen({ port: config.port, host: config.host })
  logger.info(`Challenge backend listening on http://${config.host}:${config.port}`)

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`)
    try {
      await app.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error('fatal startup error', err)
  process.exit(1)
})
