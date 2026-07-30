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
  `MessageActivity`, `MessageImage`, `AgentCommands`, `Markdown`.
- `components/ui/` — примитивы без предметной логики: `Dialog` (модальное окно),
  `useDialogStack` (стек открытых окон), `Toast`/`ToastProvider` (уведомления),
  `ConfirmDialog` + `useConfirm` (подтверждение как `await`) и `UiProviders`
  (обёртка из провайдеров тостов и подтверждений — стоит в корне `App`).
- `styles/app.css` + `global.css` — стили общие, подключаются хостом как
  `@voicechat/ui/styles.css`.

## Правила

- **Модальное окно — только `Dialog`** (`components/ui/Dialog.tsx`): портал в
  `document.body`, ловушка фокуса и возврат фокуса на открывашку, Esc и клик по
  фону (`closeOnOverlay={false}` для форм с несохранёнными данными), блокировка
  скролла фона, полный экран на телефоне, слоты `title`/`actions`/`footer` и
  размер `size`. Экран даёт только содержимое: своего оверлея и `position: fixed`
  у него быть не должно. Своя логика закрытия (подтверждение) — проп `onEscape`.
- **Слои и вложенность — `useDialogStack`.** z-index выдаётся по глубине стека,
  Esc достаётся только верхнему окну, скролл возвращается после последнего.
  Всё, что рисует оверлей (`Dialog`, `PopupFrame`, страницы `ToolFrame`),
  регистрирует **один** слой — не заводи второго и не вешай свой слушатель Esc.
- Всплывающие панели инструментов оборачивай в общий `ToolFrame` (рамка, Esc,
  анимация разворота) — не делай свою. Нужны свои кнопки в шапке — проп
  `actions`; нужно содержимому знать про разворот (зум картинки, клик по
  превью) — `children`/`actions` принимают функцию от `ToolFrameControl`.
- **Кнопка без видимой подписи обязана иметь и `aria-label`, и `title`**: первый —
  для скринридера, второй — тултип мышью. Одного `aria-label` мало, браузер его
  не показывает. У кнопок с текстом тултип не дублируй — только когда подписи
  одинаковые и различает их лишь контекст (три «⬇ Скачать» в настройках).
- **Никаких `window.confirm`/`alert`/`prompt`.** Подтверждение — `useConfirm()`
  (`if (!(await confirm({ title: '…' }))) return`), результат операции — тост
  (`useToast().success/error/info`). Нативный диалог не знает про тему, блокирует
  поток и не кликается в тестах. Необратимое (удаление колонки с задачами, откат
  незакоммиченных файлов) — `requireText`: кнопка включается после ввода названия
  объекта. Тексты подтверждений менять нельзя не подумав — они выверены.
- **Ошибка вызова моста — тостом, а не тишиной.** Стор кладёт её в очередь
  `notices` (`fail(err, retry?)` в `voiceStore.ts`), `App` показывает тостом и
  добавляет «Повторить», если `retry` задан. `retry` дают только чтению и
  идемпотентной правке; создание, удаление и запуск CI-рана — без него.
  Баннер `state.error` остался для голоса, хода модели и загрузок.
- Успех показываем там, где результата не видно: «Скопировано», «Настройки
  сохранены», «Команда удалена».
- Данные и настройки — через стор, а не прямым `fetch` из компонента.
- Растущие поля ввода — через `useAutoGrow` (`lib/autoGrow.ts`): считает высоту в
  пикселях от `scrollHeight`, поэтому переносы длинных строк тоже учитываются.
  Композер `VoiceBar` и правка сообщения в `ChatColumn` — от 2 до 4 строк, дальше скролл.
- Мобильная вёрстка учитывается сразу (сайдбар выдвижной, модалки полноэкранные,
  включая тулы `ToolFrame` — `.ccobs`). Если на телефоне нужна **другая разметка**,
  а не другие стили (карточка задачи: ⋯-меню в шапке, свёрнутые «Подробности») —
  `useMediaQuery(MOBILE_QUERY)` из `lib/mediaQuery.ts`; граница 720px дублируется
  в `app.css`, правь вместе. В тестах `matchMedia` по умолчанию «десктопный».
- **Тема живёт и на `<html>`** (эффект в `App.tsx`): окна уходят порталом в
  `document.body`, вне `.app`, и иначе теряют токены `[data-theme='dark']`.
- Тесты: `*.dom.test.tsx` (jsdom + Testing Library, фейковые мосты —
  `src/test/fakeApi.ts`), проверяем поведение: клик → вызван мост → изменился экран.
  Экраны с подтверждением или тостом рендерим через `render` из
  `src/test/uiRender.tsx` (он оборачивает в `UiProviders`); подтверждение в тесте
  **кликают**, а не мокают. Ответ `confirm()` приходит промисом — после клика по
  кнопке окна ждите `waitFor`/`findBy`.
  Логика стора — `store/voiceStore.test.ts` без DOM.

Storybook: сториз примитивов — `src/components/ui/{Dialog,Toast,ConfirmDialog}.stories.tsx`,
канбана — `src/components/kanban/*.stories.tsx`; провайдеры примитивов подключены
глобальным декоратором в `.storybook/preview.tsx`;
`npm run -w @voicechat/ui storybook` (dev, порт 6006) и `build-storybook`
(смоук-сборка). В общий гейт не входят, но `*.stories.tsx` проверяются tsc.

Гейт: `npm run -w @voicechat/ui typecheck && npm run -w @voicechat/ui test`
(+ `npm run -w @voicechat/web build`, если менялась сборка/стили).
