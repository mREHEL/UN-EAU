import { describe, expect, it } from 'vitest'
import { DeterministicNetwork } from '../../src/network/simulator'
import { MessageDeduplicator, MessageFactory, parseMessage } from '../../src/network/protocol'

describe('network safeguards', () => {
  it('validates typed envelopes at runtime', () => {
    const factory = new MessageFactory('alice', 'session', 1)
    const valid = factory.create('HEARTBEAT', { stateVersion: 4, hostTime: 10 })
    expect(parseMessage(valid)?.type).toBe('HEARTBEAT')
    expect(parseMessage({ ...valid, protocol: 99 })).toBeNull()
    expect(parseMessage({ ...valid, payload: { stateVersion: 'bad' } })).toBeNull()
    const invalidIntent = factory.create('INTENT', { action: { type: 'DRAW_CARD', playerId: 'alice' } })
    expect(parseMessage({ ...invalidIntent, payload: { action: { type: 'CHEAT', playerId: 'alice' } } })).toBeNull()
  })

  it('deduplicates messages', () => {
    const dedupe = new MessageDeduplicator()
    expect(dedupe.accept({ id: 'message-1', sentAt: 1 })).toBe(true)
    expect(dedupe.accept({ id: 'message-1', sentAt: 2 })).toBe(false)
  })

  it('keeps sequences monotonic across a new election term', () => {
    const factory = new MessageFactory('alice', 'session', 1)
    const first = factory.create('HEARTBEAT', { stateVersion: 1, hostTime: 1 })
    factory.updateSession('session', 2)
    const second = factory.create('HEARTBEAT', { stateVersion: 1, hostTime: 2 })
    expect(second.sequence).toBeGreaterThan(first.sequence)
    expect(second.term).toBe(2)
  })

  it('simulates delayed delivery in a deterministic order', () => {
    const network = new DeterministicNetwork<string>()
    const received: string[] = []
    network.connect('b', (_from, payload) => received.push(payload))
    network.send('a', 'b', 'late', 100)
    network.send('a', 'b', 'first', 20)
    network.advance(20)
    expect(received).toEqual(['first'])
    network.advance(80)
    expect(received).toEqual(['first', 'late'])
  })

  it('simulates packet loss and network partitions', () => {
    const network = new DeterministicNetwork<string>()
    const received: string[] = []
    network.connect('b', (_from, payload) => received.push(payload))
    network.drop(network.send('a', 'b', 'lost'))
    network.partition('a', 'b')
    network.send('a', 'b', 'partitioned')
    network.advance(0)
    expect(received).toEqual([])
    network.heal('a', 'b')
    network.send('a', 'b', 'restored')
    network.advance(0)
    expect(received).toEqual(['restored'])
  })
})
