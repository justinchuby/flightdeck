import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AI Crew',
  description: 'Multi-Agent Copilot CLI Orchestrator',
  base: '/ai-crew/',
  head: [['link', { rel: 'icon', href: '/ai-crew/favicon.ico' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/api' },
      { text: 'GitHub', link: 'https://github.com/justinc/ai-crew' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Quick Start', link: '/guide/quickstart' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Roles & Agents', link: '/guide/roles' },
            { text: 'Agent Commands', link: '/guide/commands' },
            { text: 'Command Syntax', link: '/guide/command-syntax' },
            { text: 'Coordination', link: '/guide/coordination' },
            { text: 'TIDE Protocol', link: '/guide/tide-protocol' },
          ],
        },
        {
          text: 'Communication',
          items: [
            { text: 'Agent Communication', link: '/guide/agent-communication' },
            { text: 'Chat Groups', link: '/guide/chat-groups' },
            { text: 'Chat UI Architecture', link: '/guide/chat-architecture' },
          ],
        },
        {
          text: 'Dashboard',
          items: [
            { text: 'Lead Dashboard', link: '/guide/dashboard-lead' },
            { text: 'Agents View', link: '/guide/dashboard-agents' },
            { text: 'Settings', link: '/guide/dashboard-settings' },
            { text: 'UI Design', link: '/guide/ui-design' },
          ],
        },
        {
          text: 'Timeline',
          items: [
            { text: 'Timeline UI', link: '/guide/timeline' },
            { text: 'Accessibility', link: '/guide/timeline-accessibility' },
            { text: 'Architecture', link: '/guide/timeline-architecture' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'REST API', link: '/reference/api' },
            { text: 'WebSocket Events', link: '/reference/websocket' },
            { text: 'Timeline Components', link: '/reference/timeline-api' },
            { text: 'Database Schema', link: '/reference/database' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Architecture Decisions', link: '/reference/architecture-decisions' },
            { text: 'Design Decisions', link: '/reference/design-decisions' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/justinc/ai-crew' },
    ],
    search: { provider: 'local' },
    footer: {
      message: 'AI-generated orchestration framework',
    },
  },
})
