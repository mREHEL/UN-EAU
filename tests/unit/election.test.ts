import { describe, expect, it } from 'vitest'
import { electHost, MigrationCoordinator, rankCandidates, type ElectionCandidate } from '../../src/network/election'

describe('host election', () => {
  for (const size of [3, 4, 6]) {
    it(`migrates deterministically with ${size} players`, () => {
      const candidates = makeCandidates(size, 12)
      const result = electHost(candidates, size)
      expect(result.status).toBe('elected')
      expect(result.winner?.playerId).toBe('p-0')
      expect(result.voters).toHaveLength(size)
    })
  }

  it('prefers the newest snapshot, then the stable player id', () => {
    const candidates = makeCandidates(4, 8)
    candidates[2]!.snapshotVersion = 9
    candidates[2]!.checksum = 'new'
    candidates[3]!.snapshotVersion = 9
    candidates[3]!.checksum = 'new'
    expect(rankCandidates(candidates)[0]?.playerId).toBe('p-2')
  })

  it('pauses instead of electing without a quorum', () => {
    const candidates = makeCandidates(4, 5)
    candidates[2]!.connected = false
    candidates[3]!.connected = false
    const result = electHost(candidates, 4)
    expect(result.status).toBe('no-quorum')
    expect(result.quorum).toBe(3)
  })

  it('does not migrate during the grace period and blocks actions while migrating', () => {
    const coordinator = new MigrationCoordinator('old', 3, 5_000)
    coordinator.hostConnectionLost(1_000)
    expect(coordinator.acceptAction(3, true)).toBe(false)
    expect(coordinator.tick(5_999, makeCandidates(3, 7), 3)).toBeNull()
    expect(coordinator.tick(6_000, makeCandidates(3, 7), 3)?.status).toBe('elected')
  })

  it('rejects the returning former host and duplicate older commits', () => {
    const coordinator = new MigrationCoordinator('old', 2, 0)
    coordinator.hostConnectionLost(0)
    coordinator.tick(1, makeCandidates(3, 4), 3)
    expect(coordinator.commitHost('p-0', 3, 'Nova')).toBe(true)
    expect(coordinator.commitHost('old', 2, 'Old')).toBe(false)
    expect(coordinator.acceptAction(2, true)).toBe(false)
    expect(coordinator.acceptAction(3, true)).toBe(true)
  })
})

function makeCandidates(size: number, version: number): ElectionCandidate[] {
  return Array.from({ length: size }, (_, index) => ({ playerId: `p-${index}`, peerId: `peer-${index}`, snapshotVersion: version, checksum: 'same', connected: true }))
}
