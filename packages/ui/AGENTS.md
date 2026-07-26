# @voicechat/ui — весь интерфейс

Один React-UI на web и desktop. **Транспорт-нейтрален**: ни один компонент не
знает про REST, WS или IPC — только мосты `window.api/audio/stt/claude/tts/cc/
codex/agents/session/fs/pty`, формы которых описаны в `@shared/ipc`. Мосты
устанавливает приложение-хост (`installRemoteBridges` для web, preload для desktop).

## Устройство

- `App.tsx` — единственный экспорт-компонент (`index.ts` реэкспортирует его).
- `store/voiceStore.ts` — стор как обычное замыкание (`getState/subscribe/actions`),
  **без React**: тестируется напрямую. React подключается через
  `store/useVoiceStore.ts`. Голосовые переходы — только через
  `transition()` из `@shared/stateMachine`, не руками.
- `remote/` — мосты поверх REST+WS: `wsClient` (реконнект, токен сессии),
  `httpApi`, `session` (токен в localStorage), `decode`.
- `audio/` — захват микрофона (`browserAudio`, `pcmWorkletSource`, `microphones`)
  и конвертация в Int16 PCM.
- `lib/` — плеер TTS, нарезка фраз, VAD, хоткеи, звуковые подсказки, `view.ts`
  (живые сегменты транскрипта).
- `components/` — экраны и виджеты. Крупные: `ChatColumn`, `Sidebar`, `VoiceBar`,
  `SettingsModal`, `MachineConsole`/`MachineTerminal`/`MachineStatus`/`AgentCard`,
  `FileExplorer`, `CcObserver`/`CodexObserver`, `UsersAdmin`, `QuestionsForm`,
  `MessageActivity`, `MessageImage`, `Markdown`.
- `styles/app.css` + `global.css` — стили общие, подключаются хостом как
  `@voicechat/ui/styles.css`.

## Правила

- Всплывающие панели инструментов оборачивай в общий `ToolFrame` (рамка, Esc,
  анимация разворота) — не делай свою. Нужны свои кнопки в шапке — проп
  `actions`; нужно содержимому знать про разворот (зум картинки, клик по
  превью) — `children`/`actions` принимают функцию от `ToolFrameControl`.
- **Кнопка без видимой подписи обязана иметь и `aria-label`, и `title`**: первый —
  для скринридера, второй — тултип мышью. Одного `aria-label` мало, браузер его
  не показывает. У кнопок с текстом тултип не дублируй — только когда подписи
  одинаковые и различает их лишь контекст (три «⬇ Скачать» в настройках).
- Данные и настройки — через стор, а не прямым `fetch` из компонента.
- Растущие поля ввода — через `useAutoGrow` (`lib/autoGrow.ts`): считает высоту в
  пикселях от `scrollHeight`, поэтому переносы длинных строк тоже учитываются.
  Композер `VoiceBar` и правка сообщения в `ChatColumn` — от 2 до 4 строк, дальше скролл.
- Мобильная вёрстка учитывается сразу (сайдбар выдвижной, модалки полноэкранные).
- Тесты: `*.dom.test.tsx` (jsdom + Testing Library, фейковые мосты —
  `src/test/fakeApi.ts`), проверяем поведение: клик → вызван мост → изменился экран.
  Логика стора — `store/voiceStore.test.ts` без DOM.

Гейт: `npm run -w @voicechat/ui typecheck && npm run -w @voicechat/ui test`
(+ `npm run -w @voicechat/web build`, если менялась сборка/стили).
