import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { applyAction, createGame } from '../game/engine'
import { DEFAULT_RULES, type Card, type CardColor, type GameAction, type GameRules, type GameState, type Player } from '../game/types'
import { MigrationCoordinator, type ElectionCandidate } from '../network/election'
import { PeerNetwork } from '../network/peerNetwork'
import type { NetworkMessage, PeerDescriptor, SnapshotPayload } from '../network/protocol'
import { createSnapshot, SnapshotStore, validateSnapshot } from '../network/synchronization'
import { generateRoomCode, getLocalIdentity, getSavedName, reconnectProof, roomPeerId, saveName } from '../utils/identity'

type Screen = 'home' | 'lobby' | 'game'
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'migrating' | 'offline'

export const useGameStore = defineStore('game', () => {
  const identity = getLocalIdentity()
  const screen = ref<Screen>('home')
  const connectionState = ref<ConnectionState>('idle')
  const playerName = ref(getSavedName())
  const roomCode = ref(new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const maxPlayers = ref(6)
  const rules = ref<GameRules>({ ...DEFAULT_RULES })
  const game = shallowRef<GameState | null>(null)
  const peerDescriptors = ref<PeerDescriptor[]>([])
  const isHost = ref(false)
  const localPeerId = ref('')
  const notice = ref<string | null>(null)
  const error = ref<string | null>(null)
  const soundEnabled = ref(localStorage.getItem('uneau.sound') !== 'off')
  const selectedWild = ref<Card | null>(null)
  const migrationMessage = ref<string | null>(null)
  const inviteCopied = ref(false)

  let network: PeerNetwork | null = null
  let coordinator: MigrationCoordinator | null = null
  let snapshotStore = new SnapshotStore()
  let monitorTimer: number | null = null
  let lastHeartbeat = 0
  let reconnectTokens = new Map<string, string>()
  let electionVotes = new Map<string, Set<string>>()
  let pendingElectionWinner: string | null = null
  let operation = Promise.resolve()

  const self = computed(() => game.value?.players.find((player) => player.id === identity.playerId) ?? null)
  const currentPlayer = computed(() => game.value?.players[game.value.currentPlayerIndex] ?? null)
  const opponents = computed(() => game.value?.players.filter((player) => player.id !== identity.playerId) ?? [])
  const canStart = computed(() => Boolean(isHost.value && game.value && game.value.players.length >= 2 && game.value.players.every((player) => player.ready)))
  const inviteUrl = computed(() => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('room', roomCode.value)
    return url.toString()
  })

  function setName(name: string): void {
    playerName.value = name.trim().slice(0, 24)
    saveName(playerName.value)
  }

  async function createRoom(): Promise<void> {
    clearMessages()
    if (!playerName.value.trim()) return fail('Choisissez un pseudonyme avant de créer une partie.')
    connectionState.value = 'connecting'
    roomCode.value = generateRoomCode()
    const sessionId = crypto.randomUUID()
    const proof = await reconnectProof(identity.reconnectToken)
    game.value = createLobbyState(sessionId, roomCode.value, identity.playerId, playerName.value, proof, rules.value)
    isHost.value = true
    coordinator = new MigrationCoordinator(identity.playerId)
    reconnectTokens.set(identity.playerId, identity.reconnectToken)
    try {
      network = new PeerNetwork(identity.playerId, sessionId)
      attachNetwork(network)
      localPeerId.value = await network.open(roomPeerId(roomCode.value))
      peerDescriptors.value = [descriptorForSelf()]
      connectionState.value = 'connected'
      screen.value = 'lobby'
      setRoomQuery(roomCode.value)
      notice.value = 'Salon créé. Partagez le code avec vos amis.'
    } catch (caught) {
      teardown()
      fail(toFriendlyError(caught))
    }
  }

  async function joinRoom(code = roomCode.value): Promise<void> {
    clearMessages()
    const normalized = code.trim().toUpperCase()
    if (!playerName.value.trim()) return fail('Choisissez un pseudonyme avant de rejoindre une partie.')
    if (!/^[A-Z2-9]{6}$/.test(normalized)) return fail('Le code du salon doit contenir 6 caractères.')
    roomCode.value = normalized
    connectionState.value = 'connecting'
    const temporarySession = `joining-${normalized}`
    try {
      network = new PeerNetwork(identity.playerId, temporarySession)
      attachNetwork(network)
      localPeerId.value = await network.open(`uneau-player-${identity.playerId}`)
      await network.connect(roomPeerId(normalized))
      network.send(roomPeerId(normalized), 'HELLO', {
        playerId: identity.playerId,
        peerId: localPeerId.value,
        name: playerName.value,
        reconnectToken: identity.reconnectToken,
        roomCode: normalized,
      })
      window.setTimeout(() => {
        if (connectionState.value === 'connecting') fail('Le salon ne répond pas. Vérifiez le code et réessayez.')
      }, 12_000)
    } catch (caught) {
      teardown()
      fail(toFriendlyError(caught))
    }
  }

  async function toggleReady(): Promise<void> {
    if (!game.value || connectionState.value !== 'connected') return
    const action: GameAction = { type: 'SET_READY', playerId: identity.playerId, ready: !self.value?.ready }
    await sendIntent(action)
  }

  async function startGame(): Promise<void> {
    if (!canStart.value || !game.value) return fail('Tous les joueurs doivent être prêts.')
    const roomSessionId = game.value.sessionId
    const roomTerm = game.value.term
    const roomVersion = game.value.version
    const players = game.value.players.map(({ id, name, reconnectProof: proof }) => ({ id, name, reconnectProof: proof }))
    game.value = { ...createGame(players, { roomCode: roomCode.value, hostId: identity.playerId, rules: rules.value }), sessionId: roomSessionId, term: roomTerm, version: roomVersion + 1 }
    coordinator = new MigrationCoordinator(identity.playerId, game.value.term)
    screen.value = 'game'
    network?.updateSession(game.value.sessionId, game.value.term)
    await replicateState()
    network?.startHeartbeat(() => game.value?.version ?? 0)
  }

  async function replay(): Promise<void> {
    if (!isHost.value || !game.value || game.value.status !== 'finished') return
    const roomSessionId = game.value.sessionId
    const roomTerm = game.value.term
    const roomVersion = game.value.version
    const previousScores = new Map(game.value.players.map((player) => [player.id, player.score]))
    const players = game.value.players.filter((player) => player.connected).map(({ id, name, reconnectProof: proof }) => ({ id, name, reconnectProof: proof }))
    const next = { ...createGame(players, { roomCode: roomCode.value, hostId: identity.playerId, rules: rules.value }), sessionId: roomSessionId, term: roomTerm, version: roomVersion + 1 }
    for (const player of next.players) player.score = previousScores.get(player.id) ?? 0
    game.value = next
    network?.updateSession(next.sessionId, next.term)
    coordinator = new MigrationCoordinator(identity.playerId, next.term)
    await replicateState()
  }

  async function syncLobby(): Promise<void> {
    if (!isHost.value || !game.value || game.value.status !== 'lobby') return
    game.value = { ...game.value, rules: { ...rules.value }, version: game.value.version + 1, updatedAt: Date.now() }
    await replicateState()
  }

  async function kickPlayer(playerId: string): Promise<void> {
    if (!isHost.value || !game.value || game.value.status !== 'lobby' || playerId === identity.playerId) return
    const peer = peerDescriptors.value.find((candidate) => candidate.playerId === playerId)
    if (peer) network?.send(peer.peerId, 'ERROR', { code: 'KICKED', message: 'L’hôte vous a retiré du salon.' })
    game.value = { ...game.value, players: game.value.players.filter((player) => player.id !== playerId), version: game.value.version + 1 }
    peerDescriptors.value = peerDescriptors.value.filter((candidate) => candidate.playerId !== playerId)
    await replicateState()
  }

  async function playCard(card: Card, color?: CardColor): Promise<void> {
    if (card.color === 'wild' && !color) {
      selectedWild.value = card
      return
    }
    selectedWild.value = null
    await sendIntent({ type: 'PLAY_CARD', playerId: identity.playerId, cardId: card.id, ...(color ? { chosenColor: color } : {}), declaredUno: self.value?.declaredUno })
  }

  async function drawCard(): Promise<void> {
    await sendIntent({ type: 'DRAW_CARD', playerId: identity.playerId })
  }

  async function declareUno(): Promise<void> {
    await sendIntent({ type: 'DECLARE_UNO', playerId: identity.playerId })
  }

  async function sendIntent(action: GameAction): Promise<void> {
    clearMessages()
    if (!game.value || connectionState.value === 'migrating') return fail('Les actions sont suspendues pendant la migration.')
    if (isHost.value) {
      handleAuthoritativeAction(action)
      return
    }
    const host = peerDescriptors.value.find((peer) => peer.playerId === game.value?.hostId)
    if (!host || !network?.send(host.peerId, 'INTENT', { action })) fail('L’hôte est momentanément inaccessible.')
  }

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl.value)
      inviteCopied.value = true
      window.setTimeout(() => { inviteCopied.value = false }, 1800)
    } catch { fail('Impossible de copier automatiquement le lien.') }
  }

  function toggleSound(): void {
    soundEnabled.value = !soundEnabled.value
    localStorage.setItem('uneau.sound', soundEnabled.value ? 'on' : 'off')
  }

  function leave(): void {
    teardown()
    game.value = null
    peerDescriptors.value = []
    screen.value = 'home'
    connectionState.value = 'idle'
    isHost.value = false
    history.replaceState({}, '', location.pathname)
  }

  function attachNetwork(instance: PeerNetwork): void {
    instance.on('message', (message) => queue(() => handleMessage(message)))
    instance.on('disconnected', ({ peerId }) => handleDisconnect(peerId))
    instance.on('error', ({ message }) => { error.value = message })
  }

  async function handleMessage(message: NetworkMessage): Promise<void> {
    if (message.type === 'HELLO' && isHost.value) {
      const payload = message.payload as NetworkMessage<'HELLO'>['payload']
      if (!game.value || payload.roomCode !== roomCode.value) return
      let player = game.value.players.find((candidate) => candidate.id === payload.playerId)
      const proof = await reconnectProof(payload.reconnectToken)
      if (player) {
        const proofMatches = player.reconnectProof ? player.reconnectProof === proof : reconnectTokens.get(player.id) === payload.reconnectToken
        if (!proofMatches) {
          network?.send(payload.peerId, 'ERROR', { code: 'IDENTITY_MISMATCH', message: 'Cette identité de joueur ne peut pas être récupérée.' })
          return
        }
        player.connected = true
      } else {
        if (game.value.players.length >= maxPlayers.value || game.value.status !== 'lobby') {
          network?.send(payload.peerId, 'ERROR', { code: 'ROOM_UNAVAILABLE', message: game.value.status !== 'lobby' ? 'La partie a déjà commencé.' : 'Le salon est complet.' })
          return
        }
        player = { id: payload.playerId, name: payload.name, reconnectProof: proof, hand: [], ready: false, connected: true, score: 0, declaredUno: false }
        game.value.players.push(player)
        game.value.version += 1
        reconnectTokens.set(player.id, payload.reconnectToken)
      }
      game.value = { ...game.value, players: [...game.value.players], updatedAt: Date.now() }
      upsertPeer({ playerId: payload.playerId, peerId: payload.peerId, name: payload.name, connected: true, snapshotVersion: game.value.version })
      const snapshot = await createSnapshot(game.value, [identity.playerId])
      network?.send(payload.peerId, 'WELCOME', { playerId: payload.playerId, hostId: identity.playerId, peers: peerDescriptors.value, snapshot })
      network?.broadcast('PEER_LIST', { peers: peerDescriptors.value })
      await replicateState()
      return
    }

    if (message.type === 'WELCOME') {
      const payload = message.payload as NetworkMessage<'WELCOME'>['payload']
      const snapshot = payload.snapshot as SnapshotPayload
      if (!(await validateSnapshot(snapshot))) return fail('L’état reçu du salon est invalide.')
      game.value = snapshot.state
      peerDescriptors.value = payload.peers
      upsertPeer(descriptorForSelf())
      isHost.value = payload.hostId === identity.playerId
      coordinator = new MigrationCoordinator(payload.hostId, game.value.term)
      snapshotStore = new SnapshotStore()
      await snapshotStore.offer(snapshot)
      network?.updateSession(game.value.sessionId, game.value.term)
      connectionState.value = 'connected'
      screen.value = game.value.status === 'lobby' ? 'lobby' : 'game'
      lastHeartbeat = Date.now()
      setRoomQuery(roomCode.value)
      startMonitor()
      for (const peer of payload.peers) {
        if (peer.playerId !== identity.playerId && peer.peerId !== roomPeerId(roomCode.value)) {
          void network?.connect(peer.peerId).then(() => network?.send(peer.peerId, 'HELLO', {
            playerId: identity.playerId, peerId: localPeerId.value, name: playerName.value,
            reconnectToken: identity.reconnectToken, roomCode: roomCode.value,
          })).catch(() => undefined)
        }
      }
      return
    }

    if (!game.value || message.sessionId !== game.value.sessionId || message.term < game.value.term) return
    if (message.type === 'INTENT' && isHost.value) {
      handleAuthoritativeAction((message.payload as NetworkMessage<'INTENT'>['payload']).action)
    } else if (message.type === 'SNAPSHOT') {
      const snapshot = message.payload as SnapshotPayload
      if (await snapshotStore.offer(snapshot, game.value.sessionId)) {
        game.value = snapshot.state
        screen.value = game.value.status === 'lobby' ? 'lobby' : 'game'
        updatePeerVersions(game.value.version)
      }
    } else if (message.type === 'PEER_LIST') {
      peerDescriptors.value = (message.payload as NetworkMessage<'PEER_LIST'>['payload']).peers
      upsertPeer(descriptorForSelf())
    } else if (message.type === 'HEARTBEAT' && message.senderId === game.value.hostId) {
      const payload = message.payload as NetworkMessage<'HEARTBEAT'>['payload']
      lastHeartbeat = Date.now()
      coordinator?.hostConnectionRestored()
      if (connectionState.value === 'migrating') connectionState.value = 'connected'
      if (payload.stateVersion > game.value.version) {
        const host = peerDescriptors.value.find((peer) => peer.playerId === game.value?.hostId)
        if (host) network?.send(host.peerId, 'SNAPSHOT_REQUEST', { fromVersion: game.value.version })
      }
    } else if (message.type === 'SNAPSHOT_REQUEST' && isHost.value) {
      void replicateState()
    } else if (message.type === 'ELECTION_VOTE' && connectionState.value === 'migrating') {
      const payload = message.payload as NetworkMessage<'ELECTION_VOTE'>['payload']
      const voterExists = game.value.players.some((player) => player.id === payload.voterId)
      if (voterExists && payload.snapshotVersion === game.value.version) {
        registerElectionVote(payload.candidateId, payload.voterId)
        tryCommitElection()
      }
    } else if (message.type === 'HOST_COMMIT') {
      const payload = message.payload as NetworkMessage<'HOST_COMMIT'>['payload']
      const quorum = Math.floor(game.value.players.length / 2) + 1
      const uniqueKnownVoters = new Set(payload.voters.filter((voter) => game.value?.players.some((player) => player.id === voter)))
      if (uniqueKnownVoters.size < quorum || payload.term <= game.value.term) return
      game.value = { ...game.value, hostId: payload.hostId, term: payload.term, status: game.value.status === 'paused' ? 'playing' : game.value.status }
      isHost.value = payload.hostId === identity.playerId
      coordinator?.commitHost(payload.hostId, payload.term, playerNameFor(payload.hostId))
      network?.updateSession(game.value.sessionId, game.value.term)
      migrationMessage.value = `Nouvel hôte : ${playerNameFor(payload.hostId)}. Reprise de la partie.`
      connectionState.value = 'connected'
      lastHeartbeat = Date.now()
      window.setTimeout(() => { migrationMessage.value = null }, 4000)
    } else if (message.type === 'LEAVE') {
      const departing = game.value.players.find((player) => player.id === message.senderId)
      if (departing) departing.connected = false
      if (message.senderId === game.value.hostId && !isHost.value) beginMigration(true)
      else if (isHost.value) {
        game.value = { ...game.value, version: game.value.version + 1, updatedAt: Date.now() }
        void replicateState()
      }
    } else if (message.type === 'ERROR') {
      const payload = message.payload as NetworkMessage<'ERROR'>['payload']
      if (payload.code === 'KICKED') leave()
      else if (payload.code === 'ROOM_UNAVAILABLE' || payload.code === 'IDENTITY_MISMATCH') teardown()
      fail(payload.message)
    }
  }

  function handleAuthoritativeAction(action: GameAction): void {
    if (!game.value) return
    if (game.value.status === 'lobby') {
      if (action.type !== 'SET_READY') return
      const player = game.value.players.find((candidate) => candidate.id === action.playerId)
      if (player) player.ready = action.ready
      game.value = { ...game.value, version: game.value.version + 1, updatedAt: Date.now() }
      void replicateState()
      return
    }
    const result = applyAction(game.value, action)
    if (!result.ok) {
      if (action.playerId === identity.playerId) fail(result.reason)
      else {
        const peer = peerDescriptors.value.find((candidate) => candidate.playerId === action.playerId)
        if (peer) network?.send(peer.peerId, 'ERROR', { code: 'ILLEGAL_ACTION', message: result.reason })
      }
      return
    }
    game.value = result.state
    notice.value = eventNotice(result.events)
    void replicateState()
  }

  async function replicateState(): Promise<void> {
    if (!network || !game.value || !isHost.value) return
    const connectedIds = peerDescriptors.value.filter((peer) => peer.connected).map((peer) => peer.playerId)
    const snapshot = await createSnapshot(game.value, connectedIds)
    await snapshotStore.offer(snapshot)
    network.broadcast('SNAPSHOT', snapshot)
    updatePeerVersions(game.value.version)
  }

  function handleDisconnect(peerId: string): void {
    const peer = peerDescriptors.value.find((candidate) => candidate.peerId === peerId)
    if (peer) peer.connected = false
    if (!game.value) return
    const hostPeer = peerDescriptors.value.find((candidate) => candidate.playerId === game.value?.hostId)
    if (!isHost.value && hostPeer?.peerId === peerId) beginMigration()
    else if (isHost.value && peer) {
      const player = game.value.players.find((candidate) => candidate.id === peer.playerId)
      if (player?.connected) {
        player.connected = false
        game.value = { ...game.value, players: [...game.value.players], version: game.value.version + 1, updatedAt: Date.now() }
        void replicateState()
      }
    }
  }

  function beginMigration(immediate = false): void {
    if (!game.value || !coordinator || connectionState.value === 'migrating') return
    connectionState.value = 'migrating'
    migrationMessage.value = 'Connexion à l’hôte perdue. Recherche d’un nouvel hôte…'
    electionVotes.clear()
    pendingElectionWinner = null
    coordinator.hostConnectionLost(Date.now() - (immediate ? coordinator.graceMs : 0))
    startMonitor()
  }

  function startMonitor(): void {
    if (monitorTimer !== null) return
    monitorTimer = window.setInterval(() => {
      if (!game.value || isHost.value) return
      if (connectionState.value === 'connected' && Date.now() - lastHeartbeat > 7_000) beginMigration()
      if (connectionState.value !== 'migrating' || !coordinator) return
      const candidates = buildCandidates()
      const result = coordinator.tick(Date.now(), candidates, game.value.players.length)
      if (!result) {
        if (pendingElectionWinner) broadcastElectionVote(pendingElectionWinner)
        return
      }
      if (result.status === 'no-quorum') {
        game.value = { ...game.value, status: 'paused' }
        migrationMessage.value = coordinator.state.message
        connectionState.value = 'offline'
        return
      }
      pendingElectionWinner = result.winner?.playerId ?? null
      if (pendingElectionWinner) {
        registerElectionVote(pendingElectionWinner, identity.playerId)
        broadcastElectionVote(pendingElectionWinner)
        tryCommitElection()
      }
    }, 1_000)
  }

  function promoteToHost(voters: string[]): void {
    if (!game.value || !coordinator) return
    const term = coordinator.state.term
    game.value = { ...game.value, hostId: identity.playerId, term, status: game.value.status === 'paused' ? 'playing' : game.value.status, version: game.value.version + 1 }
    isHost.value = true
    coordinator.commitHost(identity.playerId, term, playerName.value)
    network?.updateSession(game.value.sessionId, term)
    network?.broadcast('HOST_COMMIT', { hostId: identity.playerId, hostPeerId: localPeerId.value, term, snapshotVersion: game.value.version, voters })
    network?.startHeartbeat(() => game.value?.version ?? 0)
    connectionState.value = 'connected'
    pendingElectionWinner = null
    electionVotes.clear()
    migrationMessage.value = `Nouvel hôte : ${playerName.value}. Reprise de la partie.`
    void replicateState()
  }

  function registerElectionVote(candidateId: string, voterId: string): void {
    const votes = electionVotes.get(candidateId) ?? new Set<string>()
    votes.add(voterId)
    electionVotes.set(candidateId, votes)
  }

  function broadcastElectionVote(candidateId: string): void {
    if (!game.value) return
    network?.broadcast('ELECTION_VOTE', { candidateId, voterId: identity.playerId, snapshotVersion: game.value.version })
  }

  function tryCommitElection(): void {
    if (!game.value || pendingElectionWinner !== identity.playerId) return
    const votes = [...(electionVotes.get(identity.playerId) ?? [])]
    const quorum = Math.floor(game.value.players.length / 2) + 1
    if (votes.length >= quorum) promoteToHost(votes)
  }

  function buildCandidates(): ElectionCandidate[] {
    const connectedPeerIds = new Set(network?.connectedPeerIds ?? [])
    return peerDescriptors.value.map((peer) => ({
      playerId: peer.playerId,
      peerId: peer.peerId,
      snapshotVersion: peer.playerId === identity.playerId ? (game.value?.version ?? 0) : peer.snapshotVersion,
      checksum: snapshotStore.get()?.checksum ?? '',
      connected: peer.playerId === identity.playerId || connectedPeerIds.has(peer.peerId),
    }))
  }

  function descriptorForSelf(): PeerDescriptor {
    return { playerId: identity.playerId, peerId: localPeerId.value, name: playerName.value, connected: true, snapshotVersion: game.value?.version ?? 0 }
  }

  function upsertPeer(peer: PeerDescriptor): void {
    const index = peerDescriptors.value.findIndex((candidate) => candidate.playerId === peer.playerId)
    if (index >= 0) peerDescriptors.value[index] = peer
    else peerDescriptors.value.push(peer)
  }

  function updatePeerVersions(version: number): void {
    for (const peer of peerDescriptors.value) {
      if (peer.connected) peer.snapshotVersion = version
    }
  }

  function teardown(): void {
    network?.close(true)
    network = null
    if (monitorTimer !== null) window.clearInterval(monitorTimer)
    monitorTimer = null
    coordinator = null
    electionVotes.clear()
    pendingElectionWinner = null
    migrationMessage.value = null
    snapshotStore = new SnapshotStore()
  }

  function queue(task: () => Promise<void>): void {
    operation = operation.then(task).catch((caught) => fail(toFriendlyError(caught)))
  }

  function playerNameFor(id: string): string {
    return game.value?.players.find((player) => player.id === id)?.name ?? 'un joueur'
  }

  function clearMessages(): void { error.value = null; notice.value = null }
  function fail(message: string): void { error.value = message; connectionState.value = connectionState.value === 'connecting' ? 'idle' : connectionState.value }

  return {
    screen, connectionState, playerName, roomCode, maxPlayers, rules, game, isHost, notice, error,
    soundEnabled, selectedWild, migrationMessage, inviteCopied, self, currentPlayer, opponents, canStart,
    inviteUrl, setName, createRoom, joinRoom, toggleReady, startGame, replay, syncLobby, kickPlayer,
    playCard, drawCard, declareUno, copyInvite, toggleSound, leave,
  }
})

function createLobbyState(sessionId: string, roomCode: string, hostId: string, name: string, proof: string, rules: GameRules): GameState {
  const host: Player = { id: hostId, name, reconnectProof: proof, hand: [], connected: true, ready: true, score: 0, declaredUno: false }
  return {
    sessionId, roomCode, hostId, players: [host], deck: [], discard: [], activeColor: 'red', currentPlayerIndex: 0,
    direction: 1, pendingDraw: 0, pendingDrawKind: null, status: 'lobby', winnerId: null, version: 1,
    term: 1, rules: { ...rules }, actionLog: [], updatedAt: Date.now(),
  }
}

function setRoomQuery(code: string): void {
  const url = new URL(location.href)
  url.searchParams.set('room', code)
  history.replaceState({}, '', url)
}

function eventNotice(events: { type: string; playerId?: string; count?: number }[]): string | null {
  const penalty = events.find((event) => event.type === 'UNO_PENALTY')
  if (penalty) return `UNO oublié : ${penalty.count} cartes de pénalité.`
  if (events.some((event) => event.type === 'WINNER')) return 'La manche est terminée !'
  return null
}

function toFriendlyError(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message
  return 'Une erreur inattendue empêche la connexion.'
}
