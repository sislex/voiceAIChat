import { Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { composeStories } from '@storybook/react'
import { UiProviders, Skeleton } from '@voicechat/ui-kit'
import { installStoryBridges } from '../test/storyBridges'
import '../styles/global.css'
import '../styles/app.css'
import '@voicechat/admin-app/styles.css'

// Reuse production screen stories and bridges; no live server or CLI is involved.
const screens = {
  shell: lazy(async () => {
    const [{ default: App }, { DEFAULT_SETTINGS }, { createFakeApi }] = await Promise.all([
      import('../App'), import('@shared/types'), import('@voicechat/ui-foundation/test/fakeApi')
    ])
    const api = createFakeApi()
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['conversations:create']({ title: 'Keyboard audit conversation' })
    return { default: () => <App api={api} /> }
  }),
  chat: lazy(async () => ({ default: composeStories(await import('../components/ChatColumn.stories')).MobileViewport })),
  board: lazy(async () => ({ default: composeStories(await import('../components/kanban/KanbanBoard.stories')).LongTitles })),
  task: lazy(async () => ({ default: composeStories(await import('../components/kanban/TaskModal.stories')).Desktop })),
  releases: lazy(async () => ({ default: composeStories(await import('../components/releases/ReleaseCenter.stories')).Releases })),
  settings: lazy(async () => ({ default: composeStories(await import('../components/SettingsModal.stories')).Loaded })),
  projectSettings: lazy(async () => ({ default: composeStories(await import('../components/ProjectSettings.stories')).Overview })),
  admin: lazy(async () => ({ default: composeStories(await import('../../../admin-app/src/AdminApp.stories')).MobileCards }))
}
installStoryBridges()
const name = new URLSearchParams(location.search).get('screen') as keyof typeof screens
const Screen = screens[name] ?? screens.chat
function Ready(): JSX.Element {
  useEffect(() => { document.body.dataset.ready = 'true' }, [])
  return <Screen />
}
createRoot(document.getElementById('root')!).render(<UiProviders>
  <Suspense fallback={<Skeleton />}><Ready /></Suspense>
</UiProviders>)
