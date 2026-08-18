import type { Meta, StoryObj } from '@storybook/react'
import { ChatApp, EmbeddedChat, SplitChatWorkspace } from './index'

const meta = { title: 'Chat/Public surfaces', component: ChatApp } satisfies Meta<typeof ChatApp>
export default meta
type Story = StoryObj<typeof meta>

const navigation = {
  items: [{ id: 'c1', title: 'Первый разговор', subtitle: 'Только что', badge: 'CI', active: true, open() {} }],
  create() {}
}

export const Empty: Story = { args: { navigation: { items: [], create() {} }, children: <p>Начните новый разговор</p> } }
export const Messages: Story = { args: { navigation, children: <div><p>Пользователь: Привет</p><p>Ассистент: Чем помочь?</p></div> } }
export const Embedded: Story = { args: { children: <EmbeddedChat header={<strong>Задача CHAT-237</strong>}><p>Встроенный разговор</p></EmbeddedChat> } }
export const Split: Story = { args: { children: <SplitChatWorkspace chat={<p>Чат</p>} rightPane={<div aria-label="Правая панель">Reader</div>} /> } }
export const StreamingQueued: Story = { args: { navigation, children: <div aria-live="polite"><p>Ассистент печатает…</p><p>В очереди: 1 сообщение</p></div> } }
export const Disconnected: Story = { args: { navigation, children: <p role="status">Соединение потеряно. Переподключение…</p> } }
