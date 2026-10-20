import { createDeck, shuffle, type RandomSource } from './cards'
import {
  DEFAULT_RULES,
  type ActionRecord,
  type Card,
  type EngineResult,
  type GameAction,
  type GameEvent,
  type GameRules,
  type GameState,
  type NewGamePlayer,
} from './types'

export function createGame(
  players: NewGamePlayer[],
  options: { roomCode: string; hostId: string; rules?: Partial<GameRules>; random?: RandomSource; now?: number },
): GameState {
  if (players.length < 2 || players.length > 10) throw new Error('Une partie requiert entre 2 et 10 joueurs.')
  const rules = { ...DEFAULT_RULES, ...options.rules }
  const shuffled = shuffle(createDeck(), options.random)
  const gamePlayers = players.map((player) => ({ ...player, hand: [] as Card[], connected: true, ready: true, score: 0, declaredUno: false }))
  for (let cardIndex = 0; cardIndex < rules.startingHandSize; cardIndex += 1) {
    for (const player of gamePlayers) {
      const dealt = shuffled.pop()
      if (!dealt) throw new Error('La pioche est épuisée pendant la distribution.')
      player.hand.push(dealt)
    }
  }
  const numericIndex = shuffled.findLastIndex((candidate) => candidate.kind === 'number')
  const firstCard = shuffled.splice(numericIndex, 1)[0]
  if (!firstCard || firstCard.color === 'wild') throw new Error('Impossible de choisir la première carte.')

  return {
    sessionId: crypto.randomUUID(),
    roomCode: options.roomCode,
    hostId: options.hostId,
    players: gamePlayers,
    deck: shuffled,
    discard: [firstCard],
    activeColor: firstCard.color,
    currentPlayerIndex: 0,
    direction: 1,
    pendingDraw: 0,
    pendingDrawKind: null,
    status: 'playing',
    winnerId: null,
    version: 1,
    term: 1,
    rules,
    actionLog: [],
    updatedAt: options.now ?? Date.now(),
  }
}

export function applyAction(state: GameState, action: GameAction, actionId: string = crypto.randomUUID(), now = Date.now()): EngineResult {
  if (state.status !== 'playing' && action.type !== 'SET_CONNECTED') return failure(state, 'La partie n’est pas en cours.')
  const existing = state.actionLog.some((entry) => entry.id === actionId)
  if (existing) return { ok: true, state, events: [] }
  const playerIndex = state.players.findIndex((player) => player.id === action.playerId)
  if (playerIndex < 0) return failure(state, 'Joueur inconnu.')
  const next = structuredClone(state)
  const events: GameEvent[] = []

  if (action.type === 'SET_CONNECTED') {
    next.players[playerIndex]!.connected = action.connected
    return success(next, action, actionId, now, events)
  }
  if (action.type === 'SET_READY') {
    next.players[playerIndex]!.ready = action.ready
    return success(next, action, actionId, now, events)
  }
  if (action.type === 'DECLARE_UNO') {
    const player = next.players[playerIndex]!
    if (player.hand.length !== 1 && player.hand.length !== 2) return failure(state, 'UNO ne peut être annoncé qu’avec une ou deux cartes.')
    player.declaredUno = true
    events.push({ type: 'UNO', playerId: player.id })
    return success(next, action, actionId, now, events)
  }
  if (playerIndex !== state.currentPlayerIndex) return failure(state, 'Ce n’est pas votre tour.')
  if (!next.players[playerIndex]!.connected) return failure(state, 'Ce joueur est déconnecté.')

  if (action.type === 'DRAW_CARD') {
    const drawCount = Math.max(1, next.pendingDraw)
    drawCards(next, playerIndex, drawCount)
    next.pendingDraw = 0
    next.pendingDrawKind = null
    next.players[playerIndex]!.declaredUno = false
    events.push({ type: 'CARDS_DRAWN', playerId: action.playerId, count: drawCount })
    advanceTurn(next, 1)
    events.push(turnEvent(next))
    return success(next, action, actionId, now, events)
  }

  const player = next.players[playerIndex]!
  const cardIndex = player.hand.findIndex((candidate) => candidate.id === action.cardId)
  if (cardIndex < 0) return failure(state, 'Cette carte n’est pas dans votre main.')
  const played = player.hand[cardIndex]!
  const validity = canPlayCard(state, action.playerId, played)
  if (!validity.valid) return failure(state, validity.reason ?? 'Coup invalide.')
  if (played.color === 'wild' && !action.chosenColor) return failure(state, 'Choisissez une couleur.')

  player.hand.splice(cardIndex, 1)
  next.discard.push(played)
  next.activeColor = played.color === 'wild' ? action.chosenColor! : played.color
  player.declaredUno = Boolean(action.declaredUno || player.declaredUno)
  events.push({ type: 'CARD_PLAYED', playerId: action.playerId, card: played })

  let steps = 1
  if (played.kind === 'reverse') {
    next.direction = next.direction === 1 ? -1 : 1
    if (next.players.length === 2) steps = 2
  } else if (played.kind === 'skip') {
    steps = 2
  } else if (played.kind === 'draw2') {
    next.pendingDraw += 2
    next.pendingDrawKind = 'draw2'
  } else if (played.kind === 'wild4') {
    next.pendingDraw += 4
    next.pendingDrawKind = 'wild4'
  }

  if (player.hand.length === 0) {
    next.status = 'finished'
    next.winnerId = player.id
    player.score += scoreHands(next, player.id)
    events.push({ type: 'WINNER', playerId: player.id })
  } else {
    if (player.hand.length === 1 && !player.declaredUno) {
      drawCards(next, playerIndex, next.rules.unoPenalty)
      events.push({ type: 'UNO_PENALTY', playerId: player.id, count: next.rules.unoPenalty })
    }
    player.declaredUno = false
    advanceTurn(next, steps)
    events.push(turnEvent(next))
  }
  return success(next, action, actionId, now, events)
}

export function canPlayCard(state: GameState, playerId: string, card: Card): { valid: boolean; reason?: string } {
  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player) return { valid: false, reason: 'Joueur inconnu.' }
  if (state.pendingDraw > 0) {
    const canStack = (card.kind === 'draw2' && state.pendingDrawKind === 'draw2' && state.rules.stackDrawTwo)
      || (card.kind === 'wild4' && state.pendingDrawKind === 'wild4' && state.rules.stackDrawFour)
    return canStack ? { valid: true } : { valid: false, reason: `Vous devez piocher ${state.pendingDraw} cartes.` }
  }
  if (card.kind === 'wild4' && state.rules.strictWildDrawFour) {
    const hasMatchingColor = player.hand.some((candidate) => candidate.id !== card.id && candidate.color === state.activeColor)
    if (hasMatchingColor) return { valid: false, reason: 'Le +4 est interdit si vous possédez la couleur active.' }
  }
  if (card.color === 'wild') return { valid: true }
  const top = state.discard.at(-1)
  if (!top) return { valid: true }
  const sameSymbol = card.kind === top.kind && (card.kind !== 'number' || card.value === top.value)
  return card.color === state.activeColor || sameSymbol
    ? { valid: true }
    : { valid: false, reason: 'Cette carte ne correspond ni à la couleur ni au symbole.' }
}

function drawCards(state: GameState, playerIndex: number, count: number): void {
  for (let index = 0; index < count; index += 1) {
    if (state.deck.length === 0) replenishDeck(state)
    const drawn = state.deck.pop()
    if (drawn) state.players[playerIndex]!.hand.push(drawn)
  }
}

function replenishDeck(state: GameState): void {
  const top = state.discard.pop()
  state.deck = shuffle(state.discard)
  state.discard = top ? [top] : []
}

function advanceTurn(state: GameState, steps: number): void {
  let remaining = steps
  do {
    state.currentPlayerIndex = modulo(state.currentPlayerIndex + state.direction, state.players.length)
    if (state.players[state.currentPlayerIndex]!.connected) remaining -= 1
  } while (remaining > 0)
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function scoreHands(state: GameState, winnerId: string): number {
  return state.players.filter((player) => player.id !== winnerId).flatMap((player) => player.hand).reduce((total, card) => {
    if (card.kind === 'number') return total + (card.value ?? 0)
    if (card.kind === 'wild' || card.kind === 'wild4') return total + 50
    return total + 20
  }, 0)
}

function turnEvent(state: GameState): GameEvent {
  return { type: 'TURN_CHANGED', playerId: state.players[state.currentPlayerIndex]!.id }
}

function success(state: GameState, action: GameAction, id: string, now: number, events: GameEvent[]): EngineResult {
  state.version += 1
  state.updatedAt = now
  const record: ActionRecord = { id, playerId: action.playerId, type: action.type, version: state.version, timestamp: now }
  state.actionLog = [...state.actionLog.slice(-49), record]
  return { ok: true, state, events }
}

function failure(state: GameState, reason: string): EngineResult {
  return { ok: false, state, reason }
}

export function publicStateFor(state: GameState, viewerId: string): GameState {
  const copy = structuredClone(state)
  for (const player of copy.players) {
    if (player.id !== viewerId) player.hand = player.hand.map((_, index) => ({ id: `hidden-${index}`, color: 'wild', kind: 'wild' }))
  }
  copy.deck = copy.deck.map((_, index) => ({ id: `deck-${index}`, color: 'wild', kind: 'wild' }))
  return copy
}

export function activePlayer(state: GameState) {
  return state.players[state.currentPlayerIndex]
}
