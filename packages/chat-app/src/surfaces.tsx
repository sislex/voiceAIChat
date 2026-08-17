import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { ChatState, ChatStore } from './store/chatStore'

const StoreContext = createContext<ChatStore | null>(null)

export function ChatProvider({ store, children }: { store: ChatStore; children: ReactNode }): JSX.Element {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useChatStore<T>(selector: (state: Readonly<ChatState>) => T): T {
  const store = useContext(StoreContext)
  if (!store) throw new Error('ChatProvider is missing')
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()))
}

export interface ChatNavigationItem {
  id: string
  title: string
  subtitle?: string
  badge?: string
  active: boolean
  open(): void
  remove?(): void
}
export interface ChatNavigationModel {
  items: readonly ChatNavigationItem[]
  loading?: boolean
  emptyLabel?: string
  create(): void
}
export function ChatNavigation({ model }: { model: ChatNavigationModel }): JSX.Element {
  return <nav className="chat-navigation" aria-label="Разговоры">
    <button type="button" onClick={model.create}>+ Новый разговор</button>
    {model.loading ? <p role="status">Загрузка…</p> : model.items.length === 0 ? <p>{model.emptyLabel ?? 'Разговоров пока нет'}</p> :
      <ul>{model.items.map((item) => <li key={item.id} data-active={item.active || undefined}>
        <button type="button" onClick={item.open}><strong>{item.title}</strong>{item.subtitle && <span>{item.subtitle}</span>}{item.badge && <span>{item.badge}</span>}</button>
      </li>)}</ul>}
  </nav>
}

export interface ChatAppProps { navigation?: ChatNavigationModel; children: ReactNode }
export function ChatPage({ children }: { children: ReactNode }): JSX.Element { return <main className="chat-page">{children}</main> }
export function ChatApp({ navigation, children }: ChatAppProps): JSX.Element {
  return <section className="chat-app">{navigation && <ChatNavigation model={navigation} />}<ChatPage>{children}</ChatPage></section>
}

export interface EmbeddedChatProps { children: ReactNode; header?: ReactNode }
export function EmbeddedChat({ children, header }: EmbeddedChatProps): JSX.Element {
  return <section className="embedded-chat" aria-label="Встроенный чат">{header}<div className="embedded-chat__body">{children}</div></section>
}

export interface SplitChatWorkspaceProps { chat: ReactNode; rightPane: ReactNode; mobilePane?: 'chat' | 'right'; className?: string }
export function SplitChatWorkspace({ chat, rightPane, mobilePane = 'chat', className }: SplitChatWorkspaceProps): JSX.Element {
  return <section className={['split-chat-workspace', className].filter(Boolean).join(' ')} data-mobile-pane={mobilePane}>
    <div className="split-chat-workspace__chat">{chat}</div>
    <div className="split-chat-workspace__right">{rightPane}</div>
  </section>
}
