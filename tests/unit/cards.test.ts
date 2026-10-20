import { describe, expect, it } from 'vitest'
import { createDeck, shuffle } from '../../src/game/cards'

describe('deck', () => {
  it('builds the complete 108-card deck', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(108)
    expect(deck.filter((card) => card.kind === 'wild')).toHaveLength(4)
    expect(deck.filter((card) => card.kind === 'wild4')).toHaveLength(4)
    expect(new Set(deck.map((card) => card.id)).size).toBe(108)
  })

  it('shuffles deterministically with an injected source', () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1])
  })
})
