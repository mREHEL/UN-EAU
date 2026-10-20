export const COLORS = ['red', 'blue', 'green', 'yellow'] as const
export type CardColor = (typeof COLORS)[number]
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'

export interface Card {
  id: string
  color: CardColor | 'wild'
  kind: CardKind
  value?: number
}

export interface Player {
  id: string
  name: string
  reconnectProof?: string
  hand: Card[]
  connected: boolean
  ready: boolean
  score: number
  declaredUno: boolean
}

export interface GameRules {
  startingHandSize: number
  stackDrawTwo: boolean
  stackDrawFour: boolean
  strictWildDrawFour: boolean
  unoPenalty: number
  turnSeconds: number
}

export const DEFAULT_RULES: GameRules = {
  startingHandSize: 7,
  stackDrawTwo: false,
  stackDrawFour: false,
  strictWildDrawFour: true,
  unoPenalty: 2,
  turnSeconds: 45,
}

export interface ActionRecord {
  id: string
  playerId: string
  type: GameAction['type']
  version: number
  timestamp: number
}

export interface GameState {
  sessionId: string
  roomCode: string
  hostId: string
  players: Player[]
  deck: Card[]
  discard: Card[]
  activeColor: CardColor
  currentPlayerIndex: number
  direction: 1 | -1
  pendingDraw: number
  pendingDrawKind: 'draw2' | 'wild4' | null
  status: 'lobby' | 'playing' | 'paused' | 'finished'
  winnerId: string | null
  version: number
  term: number
  rules: GameRules
  actionLog: ActionRecord[]
  updatedAt: number
}

export type GameAction =
  | { type: 'PLAY_CARD'; playerId: string; cardId: string; chosenColor?: CardColor; declaredUno?: boolean }
  | { type: 'DRAW_CARD'; playerId: string }
  | { type: 'DECLARE_UNO'; playerId: string }
  | { type: 'SET_READY'; playerId: string; ready: boolean }
  | { type: 'SET_CONNECTED'; playerId: string; connected: boolean }

export type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; reason: string }

export type GameEvent =
  | { type: 'CARD_PLAYED'; playerId: string; card: Card }
  | { type: 'CARDS_DRAWN'; playerId: string; count: number }
  | { type: 'UNO'; playerId: string }
  | { type: 'UNO_PENALTY'; playerId: string; count: number }
  | { type: 'TURN_CHANGED'; playerId: string }
  | { type: 'WINNER'; playerId: string }

export interface NewGamePlayer {
  id: string
  name: string
  reconnectProof?: string
}
