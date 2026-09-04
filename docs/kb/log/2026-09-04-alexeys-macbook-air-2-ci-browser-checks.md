---
title: ci-browser-checks
date: 2026-09-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-browser-checks

## Что сделано

- Настройка задачи «Проверка в браузере» (`off` | `chromium` | `user_panel`) с
  портом dev-сервера и стартовым путём: контракт в `shared/ci.ts`, таблица
  `ci_task_browser_checks`, поле `browserCheck` в GET/PUT task CI, секция в
  `CiTaskSettings`.
- Инструменты `mcp__browser__*` подключаются к ходу работы модели CI-рана
  (`withBrowserTools` в `ci/modelHooks.ts`) — раньше ход рана их не получал
  вовсе, потому что строит `LlmRequest` сам, минуя `turns.ts`.
- Изолированный Chromium стал вторым входом браузерных действий:
  `browserCheckTarget` выбирает сессию (`task-<taskId>` для задачи,
  разговор — для Playwright Reader).
- Dev-сервер машины открывается Chromium через прокси превью
  (`withMachinePreviewTarget` + `PreviewRunKeys` + cookie `vc_preview_run`,
  раннер принимает `cookies` в `StartSessionRequest`).
- `previewSurface` в контракте хода: свой текст хинта и расширенный
  allow-list браузерных инструментов для headless-режима.
- Сессия проверки гасится перед новым раном (`resetBrowserCheck`).
- Кадры проверки: файл в `<dataDir>/ci-browser-shots/<runId>/<n>.png`, строка со
  ссылкой в логе рана (`REST.ciRunBrowserShot`), роут отдачи в
  `routes/browser.ts`, уборка каталогов исчезнувших и старых ранов.

## Что выяснили (факты, которых не было в KB)

- **Ход CI-рана не проходит через `turns.ts`.** `modelHooks.ts` собирает
  `LlmRequest` сам, поэтому все MCP-поверхности ему нужно подключать отдельно;
  preview там не было подключено вовсе.
- **Гейт `browser-runner` смотрит резолвленный адрес, а не литерал.**
  Сначала я решил, что имени `voicechat:8787` достаточно (`validatePublicUrl`
  режет только `localhost`, `*.local` и приватные IP). Живой прогон это
  опроверг: после DNS-резолва адрес внутренней сети получает
  `route.abort('blockedbyclient')`, и Chromium показывает белый экран с
  `ERR_BLOCKED_BY_CLIENT`. Поэтому добавлен `VC_BROWSER_PREVIEW_ORIGIN` —
  доверенный origin сервера в `allowedTargets` раннера.
- **`/api/preview` авторизуется Bearer или preview-cookie**, а cookie читается
  только на точном пути прокси (`previewSession` в `auth.ts`) — на этом же
  свойстве построен ключ `vc_preview_run`.
- **Claude in Chrome** (проверено на CLI 2.1.260, к плану): расширение и CLI
  соединяются через облачный мост `wss://bridge.claudeusercontent.com` в скоупе
  аккаунта, каждый вызов несёт `target_device_id`; в headless `claude -p
  --chrome` MCP `claude-in-chrome` подключается, есть env
  `CLAUDE_CHROME_PERMISSION_MODE` (`ask` | `skip_all_permission_checks` |
  `follow_a_plan`). Путь рабочий, но требует единого аккаунта Anthropic и живого
  Chrome на машине — поэтому выбран путь через свои Reader/Chromium.

## Куда занесено

- docs/kb/features/ci-runner.md — раздел «Браузерная проверка результата на
  стадии разработки»
- docs/kb/features/playwright-reader.md — «Второй вход в Chromium»
- docs/kb/ui.md — секция настройки в карточке задачи
- docs/kb/data-auth.md — ключ `vc_preview_run`
- docs/plans/ci-browser-checks.md — план и его чек-лист

## Живой прогон (04.09.2026)

Стенд: сервер на 8799 с `VC_BROWSER_PREVIEW_BASE=http://voicechat:8799`,
компаньон-агент на этой же машине, `browser-runner` в Docker с
`--add-host=voicechat:host-gateway` и `VC_BROWSER_PREVIEW_ORIGIN`, страница
«Счётчик задачи» на `127.0.0.1:5173`, задача с `mode: chromium` и единственным
включённым этапом `model_work`.

- Первый прогон нашёл баг гейта раннера (см. выше): модель дошла до Chromium,
  кадр и ссылка в ленте появились, но страница не загрузилась.
- Второй прогон после починки: `open` → `read` → `wait` → `screenshot` →
  `click` → `read` → `errors` → `evaluate`, вывод модели «значение изменилось с
  0 на 1», два кадра в `ci-browser-shots/<runId>/`, ссылки в логе рана,
  REST-отдача 200 `image/png`, без авторизации 401.
- Заодно проверено: прокси превью доставляет страницу с машины (HTML
  переписан), а без Bearer и с поддельным `vc_preview_run` отвечает 401.
- Ход модели шёл на Codex: локальный профиль CLI Claude в `<dataDir>/cli-users`
  сеется из `~/.claude/.credentials.json`, а на macOS авторизация лежит в
  Keychain — файла нет, и профиль стенда остаётся незалогиненным
  (`Not logged in · Please run /login`). Для локальных стендов это означает
  либо отдельный `/login` в профиль стенда, либо движок Codex.

## Открытые вопросы / что осталось

- Превью кадров картинкой в `RunFeed`: сейчас ссылка остаётся текстом (лента
  текстовая, линкификации в `RunFeed` нет вовсе). Если понадобится — это новый
  тип события ленты, а не правка формата логов.
- Автопредложение записать пройденную проверку сценарием Automated QA (шаг 8).
- Прокси превью инъектирует шимы и переписывает адреса; если страница в
  проверке разойдётся с реальной, следующий круг — серверный TCP-listener
  поверх `tunnel.connect` вместо прокси.
