<script setup lang="ts">
import { computed } from 'vue'
import BrandLogo from '../components/BrandLogo.vue'
import GameCard from '../components/GameCard.vue'
import { canPlayCard } from '../game/engine'
import { COLORS, type CardColor } from '../game/types'
import { useGameStore } from '../stores/gameStore'

const store = useGameStore()
const isMyTurn = computed(() => store.currentPlayer?.id === store.self?.id && store.game?.status === 'playing')
const winner = computed(() => store.game?.players.find((player) => player.id === store.game?.winnerId))

function playable(cardId: string): boolean {
  const state = store.game
  const card = store.self?.hand.find((candidate) => candidate.id === cardId)
  return Boolean(state && card && isMyTurn.value && canPlayCard(state, store.self!.id, card).valid)
}

function colorName(color: CardColor): string {
  return ({ red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune' } as const)[color]
}
</script>

<template>
  <section v-if="store.game" class="game-view">
    <header class="game-topbar">
      <BrandLogo compact />
      <div class="turn-status" :class="{ yours: isMyTurn }"><span /> {{ isMyTurn ? 'À VOUS DE JOUER' : `TOUR DE ${store.currentPlayer?.name?.toUpperCase()}` }}</div>
      <div class="game-actions">
        <span class="host-chip">♛ Hôte : {{ store.game.players.find(p => p.id === store.game?.hostId)?.name }}</span>
        <button class="icon-btn small" :aria-label="store.soundEnabled ? 'Couper le son' : 'Activer le son'" @click="store.toggleSound">{{ store.soundEnabled ? '♪' : '×♪' }}</button>
        <button class="ghost-btn danger-text" @click="store.leave">Quitter</button>
      </div>
    </header>

    <div class="table-area">
      <div class="table-felt">
        <div class="table-rings" />
        <div class="opponents" :class="`count-${Math.min(store.opponents.length, 9)}`">
          <article v-for="(player, index) in store.opponents" :key="player.id" class="opponent" :class="{ active: store.currentPlayer?.id === player.id, offline: !player.connected }" :style="{ '--seat': index, '--total': store.opponents.length }">
            <div class="opponent-avatar">{{ player.name.charAt(0).toUpperCase() }}<span v-if="store.game.hostId === player.id" class="crown">♛</span></div>
            <strong>{{ player.name }}</strong>
            <div class="mini-stack"><i /><i /><span>{{ player.hand.length }}</span></div>
          </article>
        </div>

        <div class="center-play">
          <div class="direction" :class="{ reverse: store.game.direction === -1 }">↻ <span>{{ store.game.direction === 1 ? 'SENS HORAIRE' : 'SENS INVERSÉ' }}</span></div>
          <button class="deck-button" :disabled="!isMyTurn" aria-label="Piocher une carte" @click="store.drawCard">
            <GameCard hidden />
            <span class="deck-count">{{ store.game.deck.length }}</span>
          </button>
          <div class="discard-pile"><GameCard :card="store.game.discard.at(-1)" /><span>COULEUR <b :class="`dot-${store.game.activeColor}`" /></span></div>
          <div v-if="store.game.pendingDraw" class="penalty-badge">+{{ store.game.pendingDraw }} en attente</div>
        </div>
      </div>

      <div class="player-zone" :class="{ active: isMyTurn }">
        <div class="hand-meta">
          <div class="self-avatar">{{ store.self?.name.charAt(0).toUpperCase() }}</div>
          <div><strong>{{ store.self?.name }}</strong><small>{{ store.self?.hand.length }} cartes</small></div>
        </div>
        <div class="hand" role="list" aria-label="Votre main">
          <button v-for="(card, index) in store.self?.hand" :key="card.id" class="card-button" :class="{ disabled: !playable(card.id) }" :style="{ '--index': index, '--count': store.self?.hand.length ?? 1 }" :disabled="!playable(card.id)" role="listitem" @click="store.playCard(card)">
            <GameCard :card="card" :playable="playable(card.id)" />
          </button>
        </div>
        <button class="uno-button" :class="{ armed: store.self?.declaredUno }" :disabled="!isMyTurn || ![1, 2].includes(store.self?.hand.length ?? 0)" @click="store.declareUno">UNO<span>!</span></button>
      </div>
    </div>

    <div v-if="store.selectedWild" class="modal-layer">
      <section class="modal-panel color-modal" role="dialog" aria-modal="true" aria-labelledby="color-title">
        <span class="modal-kicker">JOKER</span><h2 id="color-title">Choisissez la couleur.</h2>
        <div class="color-grid">
          <button v-for="color in COLORS" :key="color" :class="`choose-${color}`" @click="store.playCard(store.selectedWild!, color)"><span />{{ colorName(color) }}</button>
        </div>
        <button class="text-btn" @click="store.selectedWild = null">Annuler</button>
      </section>
    </div>

    <div v-if="store.game.status === 'finished'" class="modal-layer celebration">
      <section class="modal-panel finish-modal" role="dialog" aria-modal="true">
        <div class="winner-mark">♛</div><span class="modal-kicker">MANCHE TERMINÉE</span>
        <h2>{{ winner?.id === store.self?.id ? 'Victoire !' : `${winner?.name} remporte la manche.` }}</h2>
        <p>{{ winner?.score }} points au total</p>
        <button v-if="store.isHost" class="primary-btn" @click="store.replay">Rejouer avec cette table <span>→</span></button>
        <p v-else>En attente de l’hôte pour rejouer…</p>
        <button class="text-btn" @click="store.leave">Retour à l’accueil</button>
      </section>
    </div>
  </section>
</template>
