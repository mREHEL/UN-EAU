import { z } from 'zod'
import type { GameAction, GameState } from '../game/types'

export const PROTOCOL_VERSION = 1 as const

export const messageTypes = [
  'HELLO', 'WELCOME', 'INTENT', 'SNAPSHOT', 'SNAPSHOT_REQUEST', 'ACK', 'HEARTBEAT',
  'PEER_LIST', 'LEAVE', 'ELECTION_PROPOSAL', 'ELECTION_VOTE', 'HOST_COMMIT', 'ERROR',
] as const
export type MessageType = (typeof messageTypes)[number]

export interface PeerDescriptor {
  playerId: string
  peerId: string
  name: string
  connected: boolean
  snapshotVersion: number
}

export interface SnapshotPayload {
  state: GameState
  checksum: string
  confirmedBy: string[]
}

export interface PayloadMap {
  HELLO: { playerId: string; peerId: string; name: string; reconnectToken: string; roomCode: string }
  WELCOME: { playerId: string; hostId: string; peers: PeerDescriptor[]; snapshot: SnapshotPayload }
  INTENT: { action: GameAction }
  SNAPSHOT: SnapshotPayload
  SNAPSHOT_REQUEST: { fromVersion: number }
  ACK: { messageId: string; stateVersion: number }
  HEARTBEAT: { stateVersion: number; hostTime: number }
  PEER_LIST: { peers: PeerDescriptor[] }
  LEAVE: { voluntary: boolean }
  ELECTION_PROPOSAL: { candidateId: string; snapshotVersion: number; checksum: string }
  ELECTION_VOTE: { candidateId: string; voterId: string; snapshotVersion: number }
  HOST_COMMIT: { hostId: string; hostPeerId: string; term: number; snapshotVersion: number; voters: string[] }
  ERROR: { code: string; message: string }
}

export interface NetworkMessage<T extends MessageType = MessageType> {
  protocol: typeof PROTOCOL_VERSION
  id: string
  sessionId: string
  senderId: string
  sequence: number
  term: number
  type: T
  payload: PayloadMap[T]
  sentAt: number
}

const envelopeSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  id: z.string().min(8),
  sessionId: z.string().min(1),
  senderId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  term: z.number().int().positive(),
  type: z.enum(messageTypes),
  payload: z.unknown(),
  sentAt: z.number().finite(),
}).strict()

const playerAction = z.object({ playerId: z.string().min(1) })
const actionSchema = z.discriminatedUnion('type', [
  playerAction.extend({ type: z.literal('PLAY_CARD'), cardId: z.string().min(1), chosenColor: z.enum(['red', 'blue', 'green', 'yellow']).optional(), declaredUno: z.boolean().optional() }).strict(),
  playerAction.extend({ type: z.literal('DRAW_CARD') }).strict(),
  playerAction.extend({ type: z.literal('DECLARE_UNO') }).strict(),
  playerAction.extend({ type: z.literal('SET_READY'), ready: z.boolean() }).strict(),
  playerAction.extend({ type: z.literal('SET_CONNECTED'), connected: z.boolean() }).strict(),
])

const payloadSchemas: Record<MessageType, z.ZodType> = {
  HELLO: z.object({ playerId: z.string(), peerId: z.string(), name: z.string().min(1).max(24), reconnectToken: z.string().min(16), roomCode: z.string().length(6) }),
  WELCOME: z.object({ playerId: z.string(), hostId: z.string(), peers: z.array(z.unknown()), snapshot: z.unknown() }),
  INTENT: z.object({ action: actionSchema }).strict(),
  SNAPSHOT: z.object({ state: z.unknown(), checksum: z.string(), confirmedBy: z.array(z.string()) }),
  SNAPSHOT_REQUEST: z.object({ fromVersion: z.number().int().nonnegative() }),
  ACK: z.object({ messageId: z.string(), stateVersion: z.number().int().nonnegative() }),
  HEARTBEAT: z.object({ stateVersion: z.number().int().nonnegative(), hostTime: z.number() }),
  PEER_LIST: z.object({ peers: z.array(z.unknown()) }),
  LEAVE: z.object({ voluntary: z.boolean() }),
  ELECTION_PROPOSAL: z.object({ candidateId: z.string(), snapshotVersion: z.number().int(), checksum: z.string() }),
  ELECTION_VOTE: z.object({ candidateId: z.string(), voterId: z.string(), snapshotVersion: z.number().int() }),
  HOST_COMMIT: z.object({ hostId: z.string(), hostPeerId: z.string(), term: z.number().int().positive(), snapshotVersion: z.number().int(), voters: z.array(z.string()) }),
  ERROR: z.object({ code: z.string(), message: z.string() }),
}

export function parseMessage(value: unknown): NetworkMessage | null {
  const envelope = envelopeSchema.safeParse(value)
  if (!envelope.success) return null
  const payload = payloadSchemas[envelope.data.type].safeParse(envelope.data.payload)
  if (!payload.success) return null
  return { ...envelope.data, payload: payload.data } as NetworkMessage
}

export class MessageFactory {
  private sequence = 0

  constructor(private readonly senderId: string, private sessionId: string, private term = 1) {}

  create<T extends MessageType>(type: T, payload: PayloadMap[T]): NetworkMessage<T> {
    this.sequence += 1
    return {
      protocol: PROTOCOL_VERSION,
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      senderId: this.senderId,
      sequence: this.sequence,
      term: this.term,
      type,
      payload,
      sentAt: Date.now(),
    }
  }

  updateSession(sessionId: string, term: number): void {
    this.sessionId = sessionId
    this.term = term
  }
}

export class MessageDeduplicator {
  private readonly seen = new Map<string, number>()

  constructor(private readonly capacity = 1_000) {}

  accept(message: Pick<NetworkMessage, 'id' | 'sentAt'>): boolean {
    if (this.seen.has(message.id)) return false
    this.seen.set(message.id, message.sentAt)
    if (this.seen.size > this.capacity) {
      const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, this.seen.size - this.capacity)
      for (const [id] of oldest) this.seen.delete(id)
    }
    return true
  }
}
