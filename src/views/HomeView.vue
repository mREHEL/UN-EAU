<script setup lang="ts">
import { ref, watch } from 'vue'
import BrandLogo from '../components/BrandLogo.vue'
import { useGameStore } from '../stores/gameStore'

const store = useGameStore()
const mode = ref<'create' | 'join'>(store.roomCode ? 'join' : 'create')
const showSettings = ref(false)
const name = ref(store.playerName)

watch(name, (value) => store.setName(value))
</script>

<template>
  <section class="home-view">
    <header class="home-header">
      <BrandLogo />
      <button class="icon-btn" aria-label="Paramètres" @click="showSettings = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 3.5-2.1-1.2.1-2.4-2.4-2.4-2.4.1L12 3 10.8 5.1l-2.4-.1L6 7.4l.1 2.4L4 11v3l2.1 1.2-.1 2.4L8.4 20l2.4-.1L12 22l1.2-2.1 2.4.1 2.4-2.4-.1-2.4L20 14l1-2Z" /></svg>
      </button>
    </header>

    <div class="hero-grid">
      <div class="hero-copy">
        <div class="eyebrow"><span class="live-dot" /> MULTIJOUEUR P2P</div>
        <h1>Les cartes changent.<br><em>La partie continue.</em></h1>
        <p>Un jeu de cartes rapide entre amis, sans compte et sans serveur de partie. Même si l’hôte s’en va, UN'EAU garde la table en vie.</p>
        <div class="feature-pills">
          <span>2–10 joueurs</span><span>Migration d’hôte</span><span>100% navigateur</span>
        </div>
      </div>

      <div class="entry-card">
        <div class="entry-tabs" role="tablist">
          <button :class="{ active: mode === 'create' }" role="tab" @click="mode = 'create'">Créer</button>
          <button :class="{ active: mode === 'join' }" role="tab" @click="mode = 'join'">Rejoindre</button>
        </div>

        <form @submit.prevent="mode === 'create' ? store.createRoom() : store.joinRoom()">
          <label class="field-label" for="player-name">Votre pseudonyme</label>
          <div class="input-wrap">
            <span class="input-icon">☺</span>
            <input id="player-name" v-model="name" maxlength="24" autocomplete="nickname" placeholder="Ex. Nova" required />
          </div>

          <template v-if="mode === 'create'">
            <div class="field-row">
              <div>
                <label class="field-label" for="max-players">Joueurs max.</label>
                <select id="max-players" v-model.number="store.maxPlayers">
                  <option v-for="count in 9" :key="count + 1" :value="count + 1">{{ count + 1 }} joueurs</option>
                </select>
              </div>
              <div>
                <label class="field-label" for="turn-time">Temps / tour</label>
                <select id="turn-time" v-model.number="store.rules.turnSeconds">
                  <option :value="30">30 sec.</option><option :value="45">45 sec.</option><option :value="60">60 sec.</option>
                </select>
              </div>
            </div>
            <button class="primary-btn" :disabled="store.connectionState === 'connecting'">
              <span v-if="store.connectionState === 'connecting'" class="spinner" />
              <span v-else>Créer une partie</span>
              <span aria-hidden="true">→</span>
            </button>
          </template>

          <template v-else>
            <label class="field-label room-label" for="room-code">Code du salon</label>
            <input id="room-code" v-model="store.roomCode" class="code-input" maxlength="6" autocomplete="off" placeholder="ABC123" required />
            <button class="primary-btn" :disabled="store.connectionState === 'connecting'">
              <span v-if="store.connectionState === 'connecting'" class="spinner" />
              <span v-else>Rejoindre la table</span>
              <span aria-hidden="true">→</span>
            </button>
          </template>
        </form>
        <div class="entry-foot"><span>◇</span> Connexion chiffrée de navigateur à navigateur</div>
      </div>
    </div>

    <div class="floating-cards" aria-hidden="true">
      <div class="float-card fc-one">↻</div><div class="float-card fc-two">+2</div><div class="float-card fc-three">7</div>
    </div>

    <footer class="home-footer"><span>Aucun compte requis</span><i /> <span>Open source</span><i /> <span>Parties privées</span></footer>

    <div v-if="showSettings" class="modal-layer" @click.self="showSettings = false">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button class="modal-close" aria-label="Fermer" @click="showSettings = false">×</button>
        <span class="modal-kicker">PRÉFÉRENCES</span>
        <h2 id="settings-title">Votre table, vos règles.</h2>
        <label class="setting-line"><span><b>Sons</b><small>Effets sonores pendant la partie</small></span><input type="checkbox" :checked="store.soundEnabled" @change="store.toggleSound" /></label>
        <label class="setting-line"><span><b>Règle officielle du +4</b><small>Interdit si la couleur active est en main</small></span><input v-model="store.rules.strictWildDrawFour" type="checkbox" /></label>
        <label class="setting-line"><span><b>Cumul des +2</b><small>Permet de transmettre la pénalité</small></span><input v-model="store.rules.stackDrawTwo" type="checkbox" /></label>
        <label class="setting-line"><span><b>Cumul des +4</b><small>Variante non officielle</small></span><input v-model="store.rules.stackDrawFour" type="checkbox" /></label>
        <button class="primary-btn" @click="showSettings = false">Enregistrer</button>
      </section>
    </div>
  </section>
</template>
