<script setup lang="ts">
import { computed } from 'vue'
import { cardLabel, cardName } from '../game/cards'
import type { Card } from '../game/types'

const props = withDefaults(defineProps<{ card?: Card; hidden?: boolean; playable?: boolean; selected?: boolean }>(), {
  card: undefined,
  hidden: false,
  playable: false,
  selected: false,
})

const label = computed(() => props.card ? cardLabel(props.card) : '')
</script>

<template>
  <div
    class="game-card"
    :class="[
      hidden ? 'card-back' : `card-${card?.color ?? 'wild'}`,
      { 'is-playable': playable, 'is-selected': selected },
    ]"
    :aria-label="hidden ? 'Carte face cachée' : card ? cardName(card) : 'Carte'"
  >
    <template v-if="!hidden && card">
      <span class="card-corner top">{{ label }}</span>
      <span class="card-oval"><b>{{ label }}</b></span>
      <span class="card-corner bottom">{{ label }}</span>
    </template>
    <template v-else>
      <div class="back-orbit"><span>U</span></div>
    </template>
  </div>
</template>
