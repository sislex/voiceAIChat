// Фикстуры режима «Компоненты проекта» в Make: список компонентов рабочей копии и
// сессия Storybook на машине. Одни и те же данные питают тесты и витрину.
import type { ProjectComponentsListing, ProjectStorybookSession } from '@shared/projectComponents'
import { T0 } from './chat'

export function makeProjectComponents(over: Partial<ProjectComponentsListing> = {}): ProjectComponentsListing {
  return {
    workspaceId: 'ws:ws-1',
    source: 'storybook',
    components: [
      {
        path: 'packages/ui/src/components/ui/Button.stories.tsx',
        title: 'UI/Button',
        stories: [
          { id: 'ui-button--primary', name: 'Primary' },
          { id: 'ui-button--danger', name: 'Danger' }
        ]
      },
      {
        path: 'packages/ui/src/components/VoiceBar.stories.tsx',
        title: 'Chat/VoiceBar',
        stories: [{ id: 'chat-voicebar--recording', name: 'Recording' }]
      }
    ],
    truncated: false,
    ...over
  }
}

export function makeStorybookSession(over: Partial<ProjectStorybookSession> = {}): ProjectStorybookSession {
  return {
    workspaceId: 'ws:ws-1',
    agentId: 'm1',
    machineName: 'MacBook',
    state: 'running',
    port: 6006,
    command: 'npm run storybook -- --port 6006 --no-open --ci',
    startedAt: T0,
    readyAt: T0 + 42_000,
    error: null,
    log: 'storybook v8.6.14\nLocal: http://localhost:6006/\n',
    ...over
  }
}
