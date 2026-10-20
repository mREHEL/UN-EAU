export interface ElectionCandidate {
  playerId: string
  peerId: string
  snapshotVersion: number
  checksum: string
  connected: boolean
}

export interface ElectionResult {
  status: 'elected' | 'no-quorum'
  winner: ElectionCandidate | null
  quorum: number
  voters: string[]
}

export function quorumSize(totalPlayers: number): number {
  return Math.floor(totalPlayers / 2) + 1
}

export function rankCandidates(candidates: ElectionCandidate[]): ElectionCandidate[] {
  return candidates.filter((candidate) => candidate.connected).sort((left, right) => {
    if (left.snapshotVersion !== right.snapshotVersion) return right.snapshotVersion - left.snapshotVersion
    const checksumOrder = left.checksum.localeCompare(right.checksum)
    if (checksumOrder !== 0) return checksumOrder
    return left.playerId.localeCompare(right.playerId)
  })
}

export function electHost(candidates: ElectionCandidate[], totalPlayers: number): ElectionResult {
  const ranked = rankCandidates(candidates)
  const quorum = quorumSize(totalPlayers)
  if (ranked.length < quorum) return { status: 'no-quorum', winner: null, quorum, voters: ranked.map((candidate) => candidate.playerId) }
  const winner = ranked[0] ?? null
  if (!winner) return { status: 'no-quorum', winner: null, quorum, voters: [] }
  const compatible = ranked.filter((candidate) => candidate.snapshotVersion === winner.snapshotVersion && candidate.checksum === winner.checksum)
  if (compatible.length < quorum) return { status: 'no-quorum', winner: null, quorum, voters: compatible.map((candidate) => candidate.playerId) }
  return { status: 'elected', winner, quorum, voters: compatible.map((candidate) => candidate.playerId) }
}

export type MigrationPhase = 'stable' | 'grace' | 'electing' | 'reconnecting' | 'paused-no-quorum'

export interface MigrationState {
  phase: MigrationPhase
  term: number
  hostId: string
  lostAt: number | null
  winnerId: string | null
  message: string | null
}

export class MigrationCoordinator {
  readonly graceMs: number
  private stateValue: MigrationState

  constructor(hostId: string, term = 1, graceMs = 8_000) {
    this.graceMs = graceMs
    this.stateValue = { phase: 'stable', term, hostId, lostAt: null, winnerId: null, message: null }
  }

  get state(): Readonly<MigrationState> { return this.stateValue }

  hostConnectionLost(now: number): void {
    if (this.stateValue.phase !== 'stable') return
    this.stateValue = { ...this.stateValue, phase: 'grace', lostAt: now, message: 'Connexion à l’hôte perdue. Recherche d’un nouvel hôte…' }
  }

  hostConnectionRestored(): void {
    if (this.stateValue.phase !== 'grace') return
    this.stateValue = { ...this.stateValue, phase: 'stable', lostAt: null, message: null }
  }

  tick(now: number, candidates: ElectionCandidate[], totalPlayers: number): ElectionResult | null {
    if (this.stateValue.phase !== 'grace' || this.stateValue.lostAt === null || now - this.stateValue.lostAt < this.graceMs) return null
    this.stateValue = { ...this.stateValue, phase: 'electing', term: this.stateValue.term + 1 }
    const result = electHost(candidates, totalPlayers)
    if (result.status === 'no-quorum') {
      this.stateValue = { ...this.stateValue, phase: 'paused-no-quorum', message: `Partie suspendue : quorum de ${result.quorum} joueurs introuvable.` }
    } else {
      this.stateValue = { ...this.stateValue, phase: 'reconnecting', winnerId: result.winner!.playerId }
    }
    return result
  }

  commitHost(hostId: string, term: number, name: string): boolean {
    if (term < this.stateValue.term) return false
    this.stateValue = { phase: 'stable', term, hostId, lostAt: null, winnerId: hostId, message: `Nouvel hôte : ${name}. Reprise de la partie.` }
    return true
  }

  acceptAction(term: number, senderIsHost: boolean): boolean {
    return this.stateValue.phase === 'stable' && senderIsHost && term === this.stateValue.term
  }
}
