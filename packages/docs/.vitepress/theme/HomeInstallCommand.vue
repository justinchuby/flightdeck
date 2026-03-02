<script setup lang="ts">
import { ref } from 'vue'

const copied = ref(false)

function copyInstall() {
  navigator.clipboard.writeText('npm install -g @flightdeck-ai/flightdeck\nflightdeck')
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="hero-install">
    <div class="hero-install-header">
      Install
      <button class="copy-btn" :class="{ copied }" @click="copyInstall">
        {{ copied ? '✓ Copied' : 'Copy' }}
      </button>
    </div>
    <div class="hero-install-body">
      <code>npm install -g @flightdeck-ai/flightdeck</code>
      <code>flightdeck</code>
    </div>
  </div>
</template>

<style scoped>
.hero-install {
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-code-bg);
  max-width: 400px;
  margin: 0 auto;
  user-select: text;
  position: relative;
  z-index: 10;
  pointer-events: auto;
}
.hero-install-header {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.copy-btn {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.copy-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}
.copy-btn.copied {
  color: var(--vp-c-green-1);
  border-color: var(--vp-c-green-1);
}
.hero-install-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hero-install-body code {
  font-size: 15px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  background: none;
  padding: 0;
  display: block;
  white-space: nowrap;
  user-select: text;
  cursor: text;
}

@media (max-width: 959px) {
  .hero-install {
    margin-top: 2rem;
    max-width: 100%;
  }
}
</style>

<!-- Unscoped overrides for VitePress hero layout -->
<style>
/* Disable pointer events on the image-bg overlay so install text is clickable */
.VPHero .image-container .image-bg {
  pointer-events: none;
}

/* On mobile, push the image (install box) below the hero text */
@media (max-width: 959px) {
  .VPHero .image {
    order: 3 !important;
    margin: 0 !important;
  }
}
</style>
