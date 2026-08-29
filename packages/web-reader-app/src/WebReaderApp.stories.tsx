import type { Meta, StoryObj } from '@storybook/react'
import { WebReaderApp } from './WebReaderApp'
import type { WebReaderState, WebReaderStore } from './store'

const chat = { render: () => <p>Chat harness</p> } as never
const makeStore = (patch: Partial<WebReaderState>): WebReaderStore => {
  const state: WebReaderState = { status: 'ready', conversations: [], activeId: 'reader-1', previewUrl: null, mobilePane: 'browser', recorder: 'ready', error: null, ...patch }
  return { getState: () => state, subscribe: () => () => {}, load: async () => {}, activate: async () => {}, setMobilePane: () => {}, dispose: () => {} }
}
export default { title: 'Reader/Web Reader App', component: WebReaderApp, args: { store: makeStore({}), chat } } satisfies Meta<typeof WebReaderApp>
type Story = StoryObj<typeof WebReaderApp>
export const Empty: Story = { args: { store: makeStore({ activeId: null }) } }
export const Loading: Story = { args: { store: makeStore({ status: 'loading' }) } }
export const Error: Story = { args: { store: makeStore({ status: 'error', error: 'Страница не ответила' }) } }
export const ChromiumUnavailable: Story = { args: { store: makeStore({ previewUrl: 'https://example.test', recorder: 'unavailable' }) } }

// Ниже — состояния, которые требует гейт качества (scripts/frontend-quality.mjs,
// STORY_MATRIX). Задача CHAT-376 переписала витрину и удалила их, из-за чего
// `npm test` падал с «missing required story state», хотя ветку уже вмержили.
export const Default: Story = {}
export const RecorderReady: Story = { args: { store: makeStore({ previewUrl: 'https://example.test', recorder: 'ready' }) } }
export const ActionPending: Story = { args: { store: makeStore({ previewUrl: 'https://example.test', recorder: 'pending' }) } }
export const Mobile: Story = {
  args: { store: makeStore({ mobilePane: 'chat' }) },
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}
