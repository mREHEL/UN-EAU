import { COLORS, type Card, type CardColor } from './types'

export type RandomSource = () => number

export function createDeck(): Card[] {
  const cards: Card[] = []
  for (const color of COLORS) {
    cards.push(card(color, 'number', 0, cards.length))
    for (let value = 1; value <= 9; value += 1) {
      cards.push(card(color, 'number', value, cards.length))
      cards.push(card(color, 'number', value, cards.length))
    }
    for (const kind of ['skip', 'reverse', 'draw2'] as const) {
      cards.push(card(color, kind, undefined, cards.length))
      cards.push(card(color, kind, undefined, cards.length))
    }
  }
  for (let index = 0; index < 4; index += 1) {
    cards.push(card('wild', 'wild', undefined, cards.length))
    cards.push(card('wild', 'wild4', undefined, cards.length))
  }
  return cards
}

function card(color: CardColor | 'wild', kind: Card['kind'], value: number | undefined, index: number): Card {
  return { id: `${color}-${kind}-${value ?? 'x'}-${index}`, color, kind, ...(value === undefined ? {} : { value }) }
}

export function shuffle<T>(values: readonly T[], random: RandomSource = Math.random): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const previous = copy[index]
    copy[index] = copy[swapIndex] as T
    copy[swapIndex] = previous as T
  }
  return copy
}

export function cardLabel(cardValue: Card): string {
  if (cardValue.kind === 'number') return String(cardValue.value)
  return ({ skip: '⊘', reverse: '↻', draw2: '+2', wild: '★', wild4: '+4' } as const)[cardValue.kind]
}

export function cardName(cardValue: Card): string {
  const color = cardValue.color === 'wild' ? '' : `${cardValue.color} `
  const kind = cardValue.kind === 'number' ? cardValue.value : cardValue.kind
  return `${color}${kind}`
}
