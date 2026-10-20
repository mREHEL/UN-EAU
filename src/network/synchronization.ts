import type { GameState } from '../game/types'
import type { SnapshotPayload } from './protocol'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function checksumState(state: GameState): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(state))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSnapshot(state: GameState, confirmedBy: string[]): Promise<SnapshotPayload> {
  return { state: structuredClone(state), checksum: await checksumState(state), confirmedBy: [...new Set(confirmedBy)].sort() }
}

export async function validateSnapshot(snapshot: SnapshotPayload, expectedSessionId?: string): Promise<boolean> {
  try {
    if (!isGameStateShape(snapshot.state)) return false
    if (expectedSessionId && snapshot.state.sessionId !== expectedSessionId) return false
    if (snapshot.state.version < 1 || snapshot.state.term < 1) return false
    return snapshot.checksum === await checksumState(snapshot.state)
  } catch {
    return false
  }
}

export class SnapshotStore {
  private current: SnapshotPayload | null = null

  async offer(snapshot: SnapshotPayload, expectedSessionId?: string): Promise<boolean> {
    if (!(await validateSnapshot(snapshot, expectedSessionId))) return false
    if (this.current && compareSnapshots(snapshot, this.current) <= 0) return false
    this.current = structuredClone(snapshot)
    return true
  }

  get(): SnapshotPayload | null {
    return this.current ? structuredClone(this.current) : null
  }
}

export function compareSnapshots(left: SnapshotPayload, right: SnapshotPayload): number {
  if (left.state.term !== right.state.term) return left.state.term - right.state.term
  if (left.state.version !== right.state.version) return left.state.version - right.state.version
  if (left.confirmedBy.length !== right.confirmedBy.length) return left.confirmedBy.length - right.confirmedBy.length
  return left.checksum.localeCompare(right.checksum)
}

function isGameStateShape(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<GameState>
  if (typeof state.sessionId !== 'string' || typeof state.roomCode !== 'string' || typeof state.hostId !== 'string') return false
  if (!Array.isArray(state.players) || state.players.length < 1 || !Array.isArray(state.deck) || !Array.isArray(state.discard)) return false
  if (!state.players.every((player) => player && typeof player.id === 'string' && typeof player.name === 'string' && Array.isArray(player.hand))) return false
  if (![...state.deck, ...state.discard, ...state.players.flatMap((player) => player.hand)].every((card) => card && typeof card.id === 'string' && typeof card.kind === 'string')) return false
  if (!['red', 'blue', 'green', 'yellow'].includes(state.activeColor ?? '')) return false
  if (typeof state.currentPlayerIndex !== 'number' || state.currentPlayerIndex < 0 || state.currentPlayerIndex >= state.players.length) return false
  if (state.direction !== 1 && state.direction !== -1) return false
  if (!['lobby', 'playing', 'paused', 'finished'].includes(state.status ?? '')) return false
  return typeof state.version === 'number' && Number.isInteger(state.version)
    && typeof state.term === 'number' && Number.isInteger(state.term)
    && Boolean(state.rules) && Array.isArray(state.actionLog)
}
