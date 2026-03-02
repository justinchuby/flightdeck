import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeInstallCommand from './HomeInstallCommand.vue'
import DocFooter from './DocFooter.vue'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(HomeInstallCommand),
      'doc-after': () => h(DocFooter)
    })
  }
} satisfies Theme
