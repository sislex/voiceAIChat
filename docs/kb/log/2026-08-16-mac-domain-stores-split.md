---
title: domain-stores-split
date: 2026-08-16
machine: mac
author: alexeyrozhnov
---

# domain-stores-split (CHAT-236)

## Что сделано

- Глобальный `packages/ui/src/store/voiceStore.ts` (4567 строк) и его React-биндинг
  `useVoiceStore.ts` удалены. Состояние разобрано на независимые доменные
  хранилища `store/domains/*`: `shell`, `session`, `settings`, `chat`, `voice`,
  `operations`, `admin` (+ `projects`, который пока живёт здесь же).
- Общая основа — `store/createStore.ts`: `getState/subscribe/actions/dispose`,
  владение таймерами и «немой» режим после `dispose`.
- Введён `runtime/appRuntime.ts`: создаёт stores, ведёт bootstrap после входа,
  маршрутизирует realtime-кадры владельцу, применяет logout ко всем доменам и
  освобождает ресурсы. Своих копий доменных данных не хранит.
- Введены доменные клиенты (`clients/types.ts`) и адаптеры мостов
  (`clients/browser.ts`, `clients/realtime.ts`). Транспорт не переписан.
- `App.tsx` переведён на предметные selector-hooks из `store/react.tsx`.
- Добавлены `src/architecture.test.ts`, `store/domains/stores.contract.test.ts`,
  `runtime/appRuntime.test.ts`; прежние тесты стора переименованы в
  `store/appRuntime.*.test.ts` и работают через `src/test/appHarness.ts`.

## Что выяснили (факты, которых не было в KB)

- Копировать методы `RendererApi` в объект клиента нельзя: подменённый позже мост
  (в тестах — `vi.spyOn(api, '...')`) до стора не доедет. Поэтому клиент строится
  `withApi(api, ports)` — Proxy с живой ссылкой на мост.
- Дебаунс-таймеры списка бесед и поиска нельзя вешать на общий `clearTimers()`
  ядра: его дёргают смена чата и отмена хода, и окно склейки осталось бы
  «открытым» навсегда — список перестал бы обновляться по событиям.
- Ход модели пришлось явно развести между доменами: автомат и озвучка — во
  `voiceStore`, стрим и активные ходы — в `chatStore`; Chat дёргает автомат через
  порт `ChatVoicePort`, который выдаёт runtime.

## Куда занесено

- docs/kb/ui.md (раздел «Слои», карта доменов, bootstrap и logout)
- docs/kb/architecture.md (голосовой цикл)
- packages/ui/AGENTS.md (устройство пакета, тесты)
- docs/kb/projects.md, machines.md, features/{ci-runner,kb-usage,playwright-reader,qa-stage-runs}.md — пути и имена

## Открытые вопросы / что осталось

- Проектное состояние (`projectsStore`) всё ещё в `packages/ui`: предусловие
  задачи — перенос в `@voicechat/projects-app` — на момент CHAT-236 не выполнено
  (см. docs/kb/ui.md, раздел про пакет). Это отдельный шаг.
