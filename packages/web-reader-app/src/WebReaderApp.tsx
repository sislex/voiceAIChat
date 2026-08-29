import { useSyncExternalStore } from 'react'
import { SplitChatWorkspace } from '@voicechat/chat-app'
import type { ReaderChatPort } from './contracts'
import type { WebReaderStore } from './store'
export function WebReaderApp({store,chat}:{store:WebReaderStore;chat:ReaderChatPort}):JSX.Element{
  const state=useSyncExternalStore(store.subscribe,store.getState,store.getState)
  const browser = <section className="web-reader-browser" aria-label="Web Reader browser">
    {state.status==='loading'?<p role="status">Загрузка Reader…</p>:
      state.error?<p role="alert">{state.error}</p>:
        !state.previewUrl?<p>Укажите адрес превью</p>:
          state.recorder==='unavailable'?<p role="status">Интерактивный Reader недоступен: страница отображается, но действия ассистента и запись сценария отключены. Переподключите recorder или откройте Web Reader в основном приложении.</p>:
            <iframe title="Предпросмотр сайта" src={'/api/preview?url='+encodeURIComponent(state.previewUrl)}/>}
  </section>
  return <main className="web-reader-app"><header><a href="#/">← В приложение</a><strong>Web Reader</strong><div role="tablist" aria-label="Панель"><button role="tab" aria-selected={state.mobilePane==='chat'} onClick={()=>store.setMobilePane('chat')}>Чат</button><button role="tab" aria-selected={state.mobilePane==='browser'} onClick={()=>store.setMobilePane('browser')}>Сайт</button></div></header><SplitChatWorkspace mobilePane={state.mobilePane==='browser'?'right':'chat'} chat={chat.render(state.activeId)} rightPane={browser}/></main>
}
