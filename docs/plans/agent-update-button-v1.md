# agent-update-button-v1 — вернуть обновление агентов в интерфейс

Ран `agent-update-button-v1`. Ветка задач — `dev`. Задачу выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

Владелец 2026-10-15: «Добавь возможность обновлять агентов в интерфейсе, раньше была такая возможность, теперь
нет». Сервер Core по-прежнему отдаёт `POST /api/agents/:id/update` (`apps/server/src/routes/agents.ts`,
`REST.agentUpdate` в `packages/shared/src/protocol.ts`) и `GET` последней версии агента (`REST.agentLatestVersion`,
ответ с `Cache-Control: no-store`). В Core UI (`sislex/sislexa-core-ui`, ветка `dev`) клиентский вызов
`'agents:update'` остался в `packages/ui/src/remote/httpApi.ts` и экшен в
`packages/ui/src/store/domains/operationsStore.ts` (~307), но ни один компонент его не вызывает: кнопка пропала при
выделении Core UI в отдельный репозиторий (коммит 1f93bdb, 2026-09-22). Карточка агента —
`packages/ui/src/modules/operations/components/AgentCard.tsx` (есть stories).

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выпуск Core UI, закрепление в Core, релиз Core и деплой; проверка на проде: у агента со старой
  версией в карточке есть кнопка обновления, нажатие запускает обновление, после переподключения версия новая.

| B01 | core-ui | — | Restore the per-machine update control in `packages/ui/src/modules/operations/components/AgentCard.tsx`, per docs/plans/agent-update-button-v1.md «Что случилось»: show the current version of the connected machine next to the latest published version (store it from the latest-version endpoint already wrapped by the http client; add the client call if missing), render an «Обновить» button when the machine is online and its version differs from the latest one, wire it to the existing `'agents:update'` action in `operationsStore.ts` (~307) with a pending state, a disabled button while the request runs and the error surfaced in the card, and keep the button hidden when versions match or the machine is offline; add a story for the outdated state and dom tests for both branches (button shown and action called; button absent when up to date). |
