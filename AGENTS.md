# voiceAIChat — инструкции для агента

Голосовой чат-бот: браузер/десктоп говорит с Claude или Codex CLI, речь распознаётся
Whisper, ответ озвучивается Piper. Плюс «машины» — компаньон-агенты на чужих
хостах, на которых модель выполняет команды и держит живой терминал.

**Этот файл читается в начале каждой сессии — он должен остаться коротким.**
Детали живут в `docs/kb/` и в `AGENTS.md` внутри пакетов; читай их по мере надобности,
а не заранее. **Перед завершением работы обнови базу знаний — см. «Обновление KB».**

## Карта монорепо (npm workspaces)

| Путь | Пакет | Что это | Детали |
|---|---|---|---|
| `packages/shared` | `@voicechat/shared` | Типы, контракт REST/WS, чистая логика (без зависимостей) | [AGENTS](packages/shared/AGENTS.md) |
| `packages/ui` | `@voicechat/ui` | Весь React-UI и стор; транспорт-нейтрален (мосты `window.*`) | [AGENTS](packages/ui/AGENTS.md) |
| `packages/sessions-core` | `@voicechat/sessions-core` | Переносимое ядро «сессий и устройств»: разбор устройства, политики, порт хранилища с контрактом | [README](packages/sessions-core/README.md) |
| `packages/sessions-app` | `@voicechat/sessions-app` | UI-модуль «Сессии и устройства» (окно аккаунта + панель в админке) | [AGENTS](packages/sessions-app/AGENTS.md) |
| `apps/server` | `@voicechat/server` | Fastify: REST + WS, SQLite, Whisper, Piper, claude/codex CLI, реестр машин | [AGENTS](apps/server/AGENTS.md) |
| `apps/llm-runner` | `@voicechat/llm-runner` | Исполнитель LLM: единственный, кто делает spawn claude/codex; HTTP `/v1/run` | [AGENTS](apps/llm-runner/AGENTS.md) |
| `apps/web` | `@voicechat/web` | Тонкий браузерный клиент: `@voicechat/ui` + мосты поверх REST/WS | [AGENTS](apps/web/AGENTS.md) |
| `apps/web-recorder` | `@voicechat/web-recorder` | Независимый Vite-веб-рекордер; интеграция с ChatAI только через `postMessage`-контракт | [UI KB](docs/kb/ui.md#независимый-веб-рекордер-и-контракт-хоста) |
| `apps/agent` | `@voicechat/agent` | Компаньон-агент на машине пользователя (exec/fs/pty/телеметрия) | [AGENTS](apps/agent/AGENTS.md) |
| `apps/agent-tray` | `@voicechat/agent-tray` | Electron-трей вокруг агента (установка, лог, разрешения) | [AGENTS](apps/agent-tray/AGENTS.md) |
| `apps/desktop` | `@voicechat/desktop` | Тонкая Electron-оболочка web/server + legacy-импорт БД (вне workspaces) | [AGENTS](apps/desktop/AGENTS.md) |

`apps/desktop` и `apps/agent-tray` **намеренно не в** `workspaces`: у них свой
`node_modules` с Electron, корневой `npm install` их не трогает.

## Команды

```bash
npm install                  # корневые воркспейсы (desktop/agent-tray — отдельно)
npm run dev:web              # сервер :8787 + Vite-клиент вместе (scripts/dev-web.sh)
npm run typecheck            # все воркспейсы; отдельно: typecheck:desktop, typecheck:agent-tray
npm run test                 # все воркспейсы (vitest run)
npm run gate:fast            # гейт шага: только затронутое + related-тесты
npm run gate                 # полный гейт перед коммитом/PR
npm run test:coverage        # покрытие shared/server/ui с порогами-трещоткой
npm run -w @voicechat/ui test        # тесты одного пакета — так быстрее
npm run docker               # docker compose up --build -d → http://localhost:8787
npm run kb:check             # что в базе знаний устарело относительно кода
```

**Dev-сервер запускает пользователь, а не агент.** Не оставляй свой процесс на
:8787 — он ловит `EADDRINUSE` у пользователя. Нужен запуск — попроси, или подними
на другом порту (`PORT=8799`).

## Гейт (обязателен для каждого шага)

Шаг не считается сделанным, пока не зелёные: `typecheck` затронутых пакетов +
`test` затронутых пакетов. Где менялся UI/сборка — плюс `build`. Тесты пишутся
в том же шаге, что и код, а не «потом».

**На шаге разработки — `npm run gate:fast`.** Он смотрит дифф рабочего дерева от
`HEAD`, берёт затронутые пакеты и их потребителей по графу зависимостей и гоняет
`vitest related` вместо полных наборов; сборки web/витрины — только если правился
сам клиент или сториз. Правка одного компонента `packages/ui` проходит за ~30 с
против ~3,5 мин у полного гейта.

**Перед коммитом и PR — `npm run gate`** (typecheck + test + сборка web + витрина,
сцеплены `&&`). `gate:fast` узкий по построению: он не заменяет полный гейт, а
экономит круги внутри шага.

Не собирай гейт из кусков руками: конструкция вида
`npm run typecheck | grep error; echo "ok"` печатает «ok» всегда — `echo`
выполняется независимо от результата, а `grep` в конвейере подменяет код
возврата. Так однажды пять кругов подряд прятался красный typecheck. Гейт
объявляется зелёным **по коду возврата**, а не по отсутствию строк в выводе.

## Что нужно знать до первой правки

- **Единый источник контракта — `packages/shared`.** Новое поле/сообщение/роут
  добавляется сначала там (`protocol.ts`, `agentProtocol.ts`, `ipc.ts`, `types.ts`),
  потом на сервере и в UI. Списки `CLIENT_MESSAGE_TYPES` / `SERVER_MESSAGE_TYPES`
  проверяются тестами контракта — пополняй их.
- **UI один на всех.** Фича в `packages/ui` появляется и в web, и в desktop. Прямых
  обращений к транспорту в компонентах нет: только `window.api/audio/stt/claude/tts/
  cc/codex/agents/session/fs/pty` (формы — в `@shared/ipc`).
- **Сервер не компилируется в JS** — запускается `tsx` прямо из исходников, поэтому
  в импортах внутри `apps/server` пишутся расширения `.js` (`./config.js`), хотя
  файлы — `.ts`. В `packages/ui`/`shared` — без расширений, алиас `@shared/*`.
- **Комментарии и документация — по-русски**, объясняют «почему», а не «что»
  (см. соседний код). Тесты — `*.test.ts` / `*.dom.test.tsx` рядом с исходником.
- **Язык общения с пользователем — русский.**
- **В прод-чекауте не работают.** `target.path` (сейчас `/root/ChatAI`) — это корень
  **данных** прода, git-репозитория там нет. Деплой-чекаут задаёт `VC_REPO_DIR` в
  `/etc/voicechat/production.env`, он лежит внутри данных проекта и стоит на ветке
  релиза, а не на `main`; им управляет релизный поток. Правки и гейт — только в
  своём клоне ([deploy.md](docs/kb/deploy.md)).

## База знаний (`docs/kb/`)

Читай нужный файл по теме — не весь каталог:

| Файл | Когда открывать |
|---|---|
| [architecture.md](docs/kb/architecture.md) | как связаны клиент, сервер, CLI и машины; где чей стейт |
| [shared.md](docs/kb/shared.md) | типы, REST/WS/agent-контракты, мосты и чистые парсеры |
| [ui.md](docs/kb/ui.md) | React-компоненты, store, remote-мосты, voice/TTS UX |
| [server-internals.md](docs/kb/server-internals.md) | внутренности Fastify, маршруты, сессии, DB и сервисы |
| [clients.md](docs/kb/clients.md) | web, Electron desktop, legacy-миграция и agent-tray |
| [testing-operations.md](docs/kb/testing-operations.md) | тестовая матрица, диагностика, backup и эксплуатация |
| [protocol.md](docs/kb/protocol.md) | добавляешь/меняешь REST-роут, WS-сообщение, мост `window.*` |
| [llm.md](docs/kb/llm.md) | claude/codex CLI, stream-json, ходы, наблюдатели сессий, Anthropic-gateway |
| [stt-tts.md](docs/kb/stt-tts.md) | Whisper, Piper/say, голоса, скачивание моделей, лимиты по памяти |
| [machines.md](docs/kb/machines.md) | компаньон-агент, политика команд, PTY, проводник, телеметрия, версии |
| [data-auth.md](docs/kb/data-auth.md) | SQLite-схема, пользователи, роли, токены, права |
| [projects.md](docs/kb/projects.md) | проекты + канбан: членство, доска, порядок задач, живой board.update |
| [deploy.md](docs/kb/deploy.md) | Docker, Caddy/HTTPS, прод-сервер, переменные окружения |
| [conventions.md](docs/kb/conventions.md) | стиль кода, тесты, как устроены гейты и коммиты |
| [features/feature-preview.md](docs/kb/features/feature-preview.md) | feature-preview задачи: состояния, Docker/Storybook, seed, UI и Playwright-гейт |
| [features/manual-qa.md](docs/kb/features/manual-qa.md) | критерии, версии, QA sessions, результаты, скриншоты и допуск к merge |
| [features/merge-runner.md](docs/kb/features/merge-runner.md) | отдельный merge-ран: безопасное слияние в main, проверки, reconcile и realtime-лента |
| [features/releases.md](docs/kb/features/releases.md) | release/x.y.z, фиксация SHA, обязательные ворота и публикация в production |
| [kb-workflow.md](docs/kb/kb-workflow.md) | правила ведения самой базы знаний |

Историю решений по фичам — только если нужен контекст «почему так»: `docs/plans/`
(живые планы с чек-листами), `docs/kb/log/` (журнал сессий), `docs/docker.md`.

## Поиск знаний перед разработкой

Перед исследованием кода сформулируй запрос и выполни `npm run kb:context -- "задача"`.
Сначала открывай найденные `areas` и символы; расширяй поиск только если KB не
ответила или устарела. После изменений `npm run kb:impact` покажет рекомендуемые
статьи. Это рекомендация, а не блокирующий гейт; строгость можно повышать в CI.

## Обновление KB (делает каждый агент, на любой машине)

Узнал факт, которого не было в KB, или изменил поведение, описанное в KB, —
занеси. Иначе следующая сессия снова платит за исследование.

**Спросил базу знаний и не получил ответа (или получил неполный) — это долг.**
Нашёл ответ в коде или получил его по итогам разработки → занеси недостающее в
тот раздел, где искал: дополни существующий раздел (не заводи второй про то же),
сверив факт по коду. Неподтверждённое не записывай — незакрытый пробел лучше
записанной догадки. В CI-ране это же правило работает через блок `kb-gaps` и шаг
«Актуализировать базу знаний» ([kb-workflow.md](docs/kb/kb-workflow.md)).

1. Правь **тематический файл** в `docs/kb/` (или `AGENTS.md` пакета, если факт
   локален для пакета) и поставь сегодняшнюю дату: `node scripts/kb.mjs touch <файл>`.
2. Заведи запись журнала: `npm run kb:log -- <короткий-slug>` — создаст
   `docs/kb/log/<дата>-<машина>-<slug>.md`. **Один файл на запись** — поэтому
   параллельные агенты на разных машинах никогда не конфликтуют в журнале.
3. `npm run kb:index` — перегенерирует `docs/kb/README.md`.
4. Коммить правки KB **вместе с кодом** одним коммитом.

Конфликты: `docs/kb/README.md` генерируемый — не разрешай его руками, возьми любую
версию и прогони `npm run kb:index`. В тематических файлах пиши абзацами по теме
(а не одним растущим списком) — так параллельные правки ложатся в разные места файла.

В Claude Code для шагов 1–3 есть `/kb-update`.

В CI-ране это же делает шаг **«Актуализировать базу знаний»** (слот «после
модели», перед коммитом): он приносит правки `docs/kb/*` и статьи раздела проекта
по дифу ветки. Шаг — страховка, а не замена: работаешь руками — заноси сам.
