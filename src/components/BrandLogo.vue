<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <div class="brand" :class="{ compact }" aria-label="UN'EAU">
    <div class="brand-mark"><span>U</span></div>
    <div>
      <div class="brand-name">UN'EAU</div>
      <div v-if="!compact" class="brand-tagline">CARTES SANS FRONTIÈRES</div>
    </div>
  </div>
</template>
