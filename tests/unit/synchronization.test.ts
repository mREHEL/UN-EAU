import { describe, expect, it } from 'vitest'
import { createGame } from '../../src/game/engine'
import { createSnapshot, SnapshotStore, validateSnapshot } from '../../src/network/synchronization'

describe('snapshot synchronization', () => {
  it('creates and validates an integrity-protected snapshot', async () => {
    const state = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { roomCode: 'ABC234', hostId: 'a', random: () => .3 })
    const snapshot = await createSnapshot(state, ['a', 'b'])
    expect(await validateSnapshot(snapshot, state.sessionId)).toBe(true)
    snapshot.state.activeColor = 'green'
    expect(await validateSnapshot(snapshot, state.sessionId)).toBe(false)
  })

  it('rejects stale state and keeps the newest confirmed copy', async () => {
    const state = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { roomCode: 'ABC234', hostId: 'a', random: () => .3 })
    const oldSnapshot = await createSnapshot(state, ['a'])
    const newSnapshot = await createSnapshot({ ...state, version: state.version + 1 }, ['a', 'b'])
    const store = new SnapshotStore()
    expect(await store.offer(newSnapshot)).toBe(true)
    expect(await store.offer(oldSnapshot)).toBe(false)
    expect(store.get()?.state.version).toBe(newSnapshot.state.version)
  })

  it('rejects a malformed state without throwing', async () => {
    const malformed = { state: { version: 3 }, checksum: 'fake', confirmedBy: [] }
    expect(await validateSnapshot(malformed as never)).toBe(false)
  })
})
