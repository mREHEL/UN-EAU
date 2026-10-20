import Peer, { type DataConnection, type PeerOptions } from 'peerjs'
import { MessageDeduplicator, MessageFactory, parseMessage, type MessageType, type NetworkMessage, type PayloadMap } from './protocol'

export interface NetworkEventMap {
  message: NetworkMessage
  connected: { peerId: string }
  disconnected: { peerId: string; voluntary: boolean }
  error: { message: string }
}

type EventName = keyof NetworkEventMap
type EventHandler<K extends EventName> = (payload: NetworkEventMap[K]) => void

export class PeerNetwork {
  private peer: Peer | null = null
  private readonly connections = new Map<string, DataConnection>()
  private readonly handlers = new Map<EventName, Set<(payload: never) => void>>()
  private readonly deduplicator = new MessageDeduplicator()
  private readonly lastSequence = new Map<string, number>()
  private factory: MessageFactory
  private heartbeatTimer: number | null = null
  private closedVoluntarily = false

  constructor(readonly playerId: string, sessionId: string, term = 1) {
    this.factory = new MessageFactory(playerId, sessionId, term)
  }

  async open(peerId?: string): Promise<string> {
    if (this.peer) throw new Error('Le réseau est déjà initialisé.')
    const options = peerOptions()
    this.peer = peerId ? new Peer(peerId, options) : new Peer(options)
    this.peer.on('connection', (connection) => this.registerConnection(connection))
    this.peer.on('error', (error) => this.emit('error', { message: friendlyPeerError(error.type) }))
    this.peer.on('disconnected', () => {
      if (!this.closedVoluntarily) this.emit('error', { message: 'Connexion au service de mise en relation interrompue.' })
    })
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Le service de mise en relation ne répond pas.')), 12_000)
      this.peer!.once('open', (id) => { window.clearTimeout(timeout); resolve(id) })
      this.peer!.once('error', (error) => { window.clearTimeout(timeout); reject(error) })
    })
  }

  async connect(peerId: string): Promise<void> {
    if (!this.peer) throw new Error('Le réseau n’est pas initialisé.')
    if (this.connections.get(peerId)?.open) return
    const connection = this.peer.connect(peerId, { reliable: true, serialization: 'json', metadata: { playerId: this.playerId } })
    this.registerConnection(connection)
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Pair inaccessible.')), 10_000)
      connection.once('open', () => { window.clearTimeout(timeout); resolve() })
      connection.once('error', (error) => { window.clearTimeout(timeout); reject(error) })
    })
  }

  updateSession(sessionId: string, term: number): void {
    this.factory.updateSession(sessionId, term)
  }

  send<T extends MessageType>(peerId: string, type: T, payload: PayloadMap[T]): NetworkMessage<T> | null {
    const message = this.factory.create(type, payload)
    const connection = this.connections.get(peerId)
    if (!connection?.open) return null
    connection.send(message)
    return message
  }

  broadcast<T extends MessageType>(type: T, payload: PayloadMap[T]): NetworkMessage<T> {
    const message = this.factory.create(type, payload)
    for (const connection of this.connections.values()) if (connection.open) connection.send(message)
    return message
  }

  startHeartbeat(getVersion: () => number, intervalMs = 2_500): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      this.broadcast('HEARTBEAT', { stateVersion: getVersion(), hostTime: Date.now() })
    }, intervalMs)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  on<K extends EventName>(name: K, handler: EventHandler<K>): () => void {
    const handlers = this.handlers.get(name) ?? new Set()
    handlers.add(handler as (payload: never) => void)
    this.handlers.set(name, handlers)
    return () => handlers.delete(handler as (payload: never) => void)
  }

  close(voluntary = true): void {
    this.closedVoluntarily = voluntary
    this.stopHeartbeat()
    if (voluntary) this.broadcast('LEAVE', { voluntary: true })
    for (const connection of this.connections.values()) connection.close()
    this.connections.clear()
    this.peer?.destroy()
    this.peer = null
  }

  get connectedPeerIds(): string[] {
    return [...this.connections.entries()].filter(([, connection]) => connection.open).map(([id]) => id)
  }

  private registerConnection(connection: DataConnection): void {
    const old = this.connections.get(connection.peer)
    if (old && old !== connection) old.close()
    this.connections.set(connection.peer, connection)
    connection.on('open', () => this.emit('connected', { peerId: connection.peer }))
    connection.on('data', (data) => this.receive(data, connection))
    connection.on('close', () => {
      if (this.connections.get(connection.peer) === connection) this.connections.delete(connection.peer)
      this.emit('disconnected', { peerId: connection.peer, voluntary: false })
    })
    connection.on('error', () => this.emit('error', { message: 'Une connexion directe entre joueurs a échoué.' }))
  }

  private receive(data: unknown, connection: DataConnection): void {
    const message = parseMessage(data)
    if (!message || !this.deduplicator.accept(message)) return
    const previousSequence = this.lastSequence.get(message.senderId) ?? 0
    if (message.sequence <= previousSequence) return
    this.lastSequence.set(message.senderId, message.sequence)
    if (message.type !== 'ACK') {
      const ack = this.factory.create('ACK', { messageId: message.id, stateVersion: 0 })
      if (connection.open) connection.send(ack)
    }
    this.emit('message', message)
  }

  private emit<K extends EventName>(name: K, payload: NetworkEventMap[K]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(payload as never)
  }
}

function peerOptions(): PeerOptions {
  const iceServers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
  if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
    iceServers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL })
  }
  const configured = import.meta.env.VITE_PEER_HOST
  return {
    ...(configured ? {
      host: configured,
      port: Number(import.meta.env.VITE_PEER_PORT ?? 443),
      path: import.meta.env.VITE_PEER_PATH ?? '/',
      secure: !['localhost', '127.0.0.1'].includes(configured),
    } : {}),
    config: { iceServers },
    debug: 1,
  }
}

function friendlyPeerError(type: string): string {
  const messages: Record<string, string> = {
    'peer-unavailable': 'Ce salon est introuvable ou inaccessible.',
    'unavailable-id': 'Ce code de salon est déjà utilisé.',
    'network': 'Le réseau empêche momentanément la connexion.',
    'server-error': 'Le service de mise en relation est indisponible.',
  }
  return messages[type] ?? 'La connexion entre joueurs a rencontré un problème.'
}
