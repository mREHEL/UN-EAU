<script setup lang="ts">
import BrandLogo from '../components/BrandLogo.vue'
import { useGameStore } from '../stores/gameStore'

const store = useGameStore()
</script>

<template>
  <section class="lobby-view">
    <header class="topbar">
      <BrandLogo compact />
      <div class="connection-pill"><span /> Connexion directe</div>
      <button class="ghost-btn danger-text" @click="store.leave">Quitter</button>
    </header>

    <div class="lobby-layout">
      <section class="lobby-main">
        <div class="section-heading">
          <div><span class="overline">SALON PRIVÉ</span><h1>La table se prépare.</h1></div>
          <span class="player-count">{{ store.game?.players.length }} / {{ store.maxPlayers }}</span>
        </div>

        <div class="room-code-card">
          <div><small>CODE DU SALON</small><strong>{{ store.roomCode }}</strong></div>
          <button class="copy-btn" @click="store.copyInvite">{{ store.inviteCopied ? 'Copié !' : 'Copier le lien' }}</button>
        </div>

        <div class="players-grid">
          <article v-for="(player, index) in store.game?.players" :key="player.id" class="player-tile" :class="{ ready: player.ready }">
            <div class="avatar" :style="{ '--hue': `${(index * 67 + 220) % 360}` }"><span>{{ player.name.charAt(0).toUpperCase() }}</span></div>
            <div class="player-info">
              <strong>{{ player.name }} <span v-if="player.id === store.self?.id">(vous)</span></strong>
              <small v-if="player.id === store.game?.hostId" class="host-label">HÔTE</small>
              <small v-else>{{ player.ready ? 'Prêt à jouer' : 'Se prépare…' }}</small>
            </div>
            <span class="ready-indicator">{{ player.ready ? '✓' : '…' }}</span>
            <button v-if="store.isHost && player.id !== store.self?.id" class="kick-btn" :aria-label="`Expulser ${player.name}`" @click="store.kickPlayer(player.id)">×</button>
          </article>
          <article v-for="slot in Math.max(0, store.maxPlayers - (store.game?.players.length ?? 0))" :key="`slot-${slot}`" class="player-tile empty">
            <div class="avatar">+</div><span>En attente d’un joueur</span>
          </article>
        </div>
      </section>

      <aside class="lobby-sidebar">
        <span class="overline">RÈGLES DE LA TABLE</span>
        <h2>Partie classique</h2>
        <div class="rules-list">
          <div><span>Cartes au départ</span><b>{{ store.rules.startingHandSize }}</b></div>
          <div><span>Temps par tour</span><b>{{ store.rules.turnSeconds }} s</b></div>
          <label><span>Cumul des +2</span><input v-model="store.rules.stackDrawTwo" :disabled="!store.isHost" type="checkbox" @change="store.syncLobby" /></label>
          <label><span>Cumul des +4</span><input v-model="store.rules.stackDrawFour" :disabled="!store.isHost" type="checkbox" @change="store.syncLobby" /></label>
          <label><span>+4 officiel</span><input v-model="store.rules.strictWildDrawFour" :disabled="!store.isHost" type="checkbox" @change="store.syncLobby" /></label>
        </div>
        <div class="p2p-note"><span>⬡</span><p><b>Table résiliente</b><br>Chaque joueur garde une copie de secours. Si l’hôte part, un autre prend automatiquement le relais.</p></div>

        <button v-if="store.isHost" class="primary-btn start-btn" :disabled="!store.canStart" @click="store.startGame">
          <span>{{ store.canStart ? 'Lancer la partie' : 'En attente des joueurs' }}</span><span>→</span>
        </button>
        <button v-else class="primary-btn start-btn" :class="{ ready: store.self?.ready }" @click="store.toggleReady">
          <span>{{ store.self?.ready ? 'Je suis prêt ✓' : 'Je suis prêt' }}</span>
        </button>
        <p v-if="store.isHost" class="start-hint">2 joueurs minimum · tout le monde doit être prêt</p>
      </aside>
    </div>
  </section>
</template>
