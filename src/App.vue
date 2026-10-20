<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useGameStore } from './stores/gameStore'
import HomeView from './views/HomeView.vue'
import LobbyView from './views/LobbyView.vue'
import GameView from './views/GameView.vue'

const store = useGameStore()
onBeforeUnmount(() => store.leave())
</script>

<template>
  <main class="app-shell">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />
    <HomeView v-if="store.screen === 'home'" />
    <LobbyView v-else-if="store.screen === 'lobby'" />
    <GameView v-else />

    <Transition name="toast">
      <div v-if="store.error" class="toast toast-error" role="alert">
        <span class="toast-icon">!</span>
        <span>{{ store.error }}</span>
        <button aria-label="Fermer" @click="store.error = null">×</button>
      </div>
    </Transition>
    <Transition name="toast">
      <div v-if="store.notice" class="toast toast-info" role="status">
        <span class="toast-icon">i</span>
        <span>{{ store.notice }}</span>
        <button aria-label="Fermer" @click="store.notice = null">×</button>
      </div>
    </Transition>
    <div v-if="store.migrationMessage" class="migration-banner" role="status" aria-live="assertive">
      <span class="radar" />
      {{ store.migrationMessage }}
    </div>
  </main>
</template>
