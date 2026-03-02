<template>
  <div class="install-command">
    <div class="install-box">
      <code>npm install -g @flightdeck-ai/flightdeck</code>
      <code>flightdeck</code>
    </div>
  </div>
</template>

<style scoped>
.install-command {
  max-width: 480px;
  margin: 0 auto 1rem;
  text-align: center;
  padding: 0 24px;
}
.install-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.install-box code {
  font-size: 1.1rem;
  padding: 0.5rem 1.5rem;
  background: var(--vp-code-bg);
  border-radius: 8px;
  display: block;
}
</style>
