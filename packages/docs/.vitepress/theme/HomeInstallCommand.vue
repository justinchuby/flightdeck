<template>
  <div class="hero-install">
    <div class="hero-install-header">Install</div>
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
}
.hero-install-header {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
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
  user-select: all;
  cursor: text;
}

@media (max-width: 959px) {
  .hero-install {
    margin-top: 2rem;
    max-width: 100%;
  }
}
</style>
