import { beforeEach, describe, expect, it } from 'vitest'
import { applyAction, canPlayCard, createGame } from '../../src/game/engine'
import type { Card, GameState } from '../../src/game/types'

const players = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cam' }]
let state: GameState

beforeEach(() => {
  state = createGame(players, { roomCode: 'ABC234', hostId: 'a', random: () => 0.42, now: 1 })
})

describe('game engine', () => {
  it('deals seven cards to each player and starts with a numeric discard', () => {
    expect(state.players.every((player) => player.hand.length === 7)).toBe(true)
    expect(state.deck).toHaveLength(86)
    expect(state.discard[0]?.kind).toBe('number')
  })

  it('accepts matching colors and symbols, rejects an unrelated card', () => {
    state.activeColor = 'red'
    state.discard = [makeCard('top', 'blue', 'number', 5)]
    state.players[0]!.hand = [makeCard('red', 'red', 'number', 2), makeCard('five', 'green', 'number', 5), makeCard('no', 'yellow', 'skip')]
    expect(canPlayCard(state, 'a', state.players[0]!.hand[0]!)).toEqual({ valid: true })
    expect(canPlayCard(state, 'a', state.players[0]!.hand[1]!)).toEqual({ valid: true })
    expect(canPlayCard(state, 'a', state.players[0]!.hand[2]!).valid).toBe(false)
  })

  it('changes turns and skips the next player', () => {
    state.activeColor = 'red'
    const skip = makeCard('skip', 'red', 'skip')
    state.players[0]!.hand = [skip, makeCard('other', 'blue', 'number', 1)]
    const result = applyAction(state, { type: 'PLAY_CARD', playerId: 'a', cardId: skip.id })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.currentPlayerIndex).toBe(2)
  })

  it('reverses direction', () => {
    state.activeColor = 'green'
    const reverse = makeCard('reverse', 'green', 'reverse')
    state.players[0]!.hand = [reverse, makeCard('other', 'blue', 'number', 1)]
    const result = applyAction(state, { type: 'PLAY_CARD', playerId: 'a', cardId: reverse.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.direction).toBe(-1)
      expect(result.state.currentPlayerIndex).toBe(2)
    }
  })

  it('forces the next player to draw two', () => {
    state.activeColor = 'yellow'
    const draw2 = makeCard('draw2', 'yellow', 'draw2')
    state.players[0]!.hand = [draw2, makeCard('other', 'blue', 'number', 1)]
    const played = applyAction(state, { type: 'PLAY_CARD', playerId: 'a', cardId: draw2.id })
    expect(played.ok).toBe(true)
    if (!played.ok) return
    expect(played.state.pendingDraw).toBe(2)
    const before = played.state.players[1]!.hand.length
    const drawn = applyAction(played.state, { type: 'DRAW_CARD', playerId: 'b' })
    expect(drawn.ok).toBe(true)
    if (drawn.ok) expect(drawn.state.players[1]!.hand).toHaveLength(before + 2)
  })

  it('enforces the official wild +4 restriction', () => {
    state.activeColor = 'red'
    const wild4 = makeCard('wild4', 'wild', 'wild4')
    state.players[0]!.hand = [wild4, makeCard('match', 'red', 'number', 8)]
    expect(canPlayCard(state, 'a', wild4).valid).toBe(false)
  })

  it('penalizes a missing UNO declaration', () => {
    state.activeColor = 'blue'
    const playable = makeCard('play', 'blue', 'number', 3)
    state.players[0]!.hand = [playable, makeCard('last', 'yellow', 'number', 9)]
    const result = applyAction(state, { type: 'PLAY_CARD', playerId: 'a', cardId: playable.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players[0]!.hand).toHaveLength(3)
      expect(result.events.some((event) => event.type === 'UNO_PENALTY')).toBe(true)
    }
  })

  it('detects a winner and blocks later actions', () => {
    state.activeColor = 'blue'
    const last = makeCard('last', 'blue', 'number', 3)
    state.players[0]!.hand = [last]
    const result = applyAction(state, { type: 'PLAY_CARD', playerId: 'a', cardId: last.id, declaredUno: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.status).toBe('finished')
    expect(result.state.winnerId).toBe('a')
    expect(applyAction(result.state, { type: 'DRAW_CARD', playerId: 'b' }).ok).toBe(false)
  })

  it('deduplicates an action id', () => {
    const first = applyAction(state, { type: 'DRAW_CARD', playerId: 'a' }, 'same-action')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyAction(first.state, { type: 'DRAW_CARD', playerId: 'b' }, 'same-action')
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.state.version).toBe(first.state.version)
  })
})

function makeCard(id: string, color: Card['color'], kind: Card['kind'], value?: number): Card {
  return { id, color, kind, ...(value === undefined ? {} : { value }) }
}
