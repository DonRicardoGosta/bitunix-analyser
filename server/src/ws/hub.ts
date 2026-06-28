import type { FastifyInstance } from 'fastify'
import type { RawData, WebSocket } from 'ws'
import type {
  ChallengeEvent,
  ClientWsMessage,
  ServerWsMessage,
} from '@shared/challenge/types'
import { challengeManager } from '../challenge/manager'
import { challengesRepo } from '../db/repos/challenges'
import { eventBus } from '../events/log'

// WebSocket hub (items 8 + 10): streams the event log and periodic live state
// snapshots to subscribed frontends. Subscription is per-challenge (or all).

interface Client {
  socket: WebSocket
  /** true = receive every challenge; otherwise only `ids`. */
  all: boolean
  ids: Set<string>
}

const clients = new Set<Client>()

function wants(c: Client, challengeId: string): boolean {
  return c.all || c.ids.has(challengeId)
}

function send(socket: WebSocket, msg: ServerWsMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
}

function decode(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return (raw as Buffer).toString('utf8')
}

// Forward every logged event to interested clients (module-level: attached once).
eventBus.on('event', (event: ChallengeEvent) => {
  for (const c of clients) if (wants(c, event.challengeId)) send(c.socket, { type: 'event', event })
})

export function registerWsHub(app: FastifyInstance): void {
  // Per-second live state for running challenges.
  const stateTimer = setInterval(() => {
    if (clients.size === 0) return
    for (const summary of challengeManager.getSummaries()) {
      for (const c of clients) {
        if (wants(c, summary.run.id)) send(c.socket, { type: 'state', summary })
      }
    }
  }, 1000)

  // Periodic full run list so dashboards pick up terminal transitions.
  const runsTimer = setInterval(() => {
    if (clients.size === 0) return
    const runs = challengesRepo.list()
    for (const c of clients) send(c.socket, { type: 'runs', runs })
  }, 4000)

  app.addHook('onClose', async () => {
    clearInterval(stateTimer)
    clearInterval(runsTimer)
  })

  app.get('/api/ws', { websocket: true }, (socket: WebSocket) => {
    const client: Client = { socket, all: false, ids: new Set() }
    clients.add(client)

    send(socket, { type: 'hello', ts: Date.now() })
    send(socket, { type: 'runs', runs: challengesRepo.list() })

    socket.on('message', (raw: RawData) => {
      let msg: ClientWsMessage
      try {
        msg = JSON.parse(decode(raw)) as ClientWsMessage
      } catch {
        return
      }
      if (msg.op === 'ping') {
        send(socket, { type: 'pong' })
        return
      }
      if (msg.op === 'subscribe') {
        if (msg.challengeId) {
          client.ids.add(msg.challengeId)
          const s = challengeManager.getSummary(msg.challengeId)
          if (s) send(socket, { type: 'state', summary: s })
        } else {
          client.all = true
          for (const s of challengeManager.getSummaries()) send(socket, { type: 'state', summary: s })
        }
        return
      }
      if (msg.op === 'unsubscribe') {
        if (msg.challengeId) client.ids.delete(msg.challengeId)
        else client.all = false
      }
    })

    socket.on('close', () => clients.delete(client))
    socket.on('error', () => clients.delete(client))
  })
}
