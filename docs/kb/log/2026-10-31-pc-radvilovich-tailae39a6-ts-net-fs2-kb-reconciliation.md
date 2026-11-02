---
title: fs2-kb-reconciliation
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# fs2-kb-reconciliation

## Что сделано

Устранена причина падения strict KB freshness после `8bb433d2` (FS-2).
Прочитаны зависимые темы и их areas; сверено пересечение с diff этого коммита.
Команда гейта и правила свежести не менялись. Ниже — основания по каждой теме.

| Тема | Проверенный код и результат сверки |
| --- | --- |
| agent-api-access.md | В server.ts добавлены регистрация storage и чтение вложений; выдача agent API tokens и их auth-пути не менялись. |
| clients.md | config.ts добавляет fileStorageConfig, server.ts — storage runtime. Сборка, доставка UI-артефактов, Android и клиентская авторизация не менялись. |
| conversation-groups.md | types.ts добавляет только chatFilesBackend; schema.ts — STORAGE_SCHEMA, database.ts — storageMetadata(). Группы, archive и запросы chat repo не менялись. |
| features/feature-preview.md | database.ts добавляет отдельный storageMetadata(); preview/agent registry/Compose и Kanban bridge не менялись. |
| features/kanban-assistant.md | turns.ts передаёт userId в resolveUpload; rest.ts добавляет storage read и проверку настройки. WidgetContextStore, relay и маршрутизация Kanban MCP не менялись. |
| features/kb-usage.md | В server.ts, turns.ts, schema.ts и database.ts изменения ограничены storage. KB tracker, turn broker, auto-context, usage schema и writer не менялись. |
| features/llm-runners.md | server.ts возвращает существующий LlmAttachment с dataBase64 и preserveServerPath для storage-upload. Уточнена граница Core; протокол и реализация раннера не менялись. |
| features/make-browser.md | resolveUpload теперь получает userId, данные вложений собираются тем же путём loadedAttachments. Browser binding, preview token, toolOnly и Make bridge не менялись. |
| features/manual-qa.md | Добавлен STORAGE_SCHEMA и метод storageMetadata(); QA upload flow, QA repo и Kanban bridge не менялись. Новая ветка POST /api/uploads включается только настройкой chatFilesBackend=storage. |
| features/merge-runner.md | Изменения server/turns относятся к storage и разрешению вложений. Merge stages, isolation, cleanup и владелец исполнения не менялись. |
| features/playwright-reader.md | types.ts и rest.ts добавляют настройку и storage read; browser contract, bridge и DB браузера не менялись. |
| features/qa-stage-runs.md | schema/database добавляют storage; QA transitions, stage execution и сохранение run state не менялись. |
| features/task-autopilot.md | schema/database изменены только добавлением storage; task transitions и autopilot/QA wiring не менялись. |
| features/task-preparation.md | schema/database/server дополнены storage; brief, preparation result и task repo не менялись. |
| image-retouch.md | server.ts allowed() сверяет storage.spaceId/path и владельца/разговор upload; readAttachment читает storage через service. Исправлено описание доверенной границы и выбора backend. |
| llm.md | turns.ts передаёт userId в resolveUpload; server.ts проверяет владельца upload и читает storage-ссылку. Описан синтетический путь и существующий транспорт вложений. |
| machines.md | rest.ts читает storage-пути, settings repo нормализует backend; agent bindings и machine/workspace схемы не менялись. Добавлено различие backend для чата. |
| projects.md | schema/database добавляют storage, turns/rest — чтение вложений и настройку. Projects/Kanban bridge, owner repo и task contracts не менялись. |
| protocol.md | rest.ts валидирует chatFilesBackend и читает storage через service. Добавлено описание Core storage REST и serverFile. |
| shared.md | Settings, DEFAULT_SETTINGS и sanitizeSettingsPatch поддерживают machine/storage. Удалено устаревшее утверждение об отсутствии Core storage routes. |
| ui.md | Shared и Core поддерживают новый backend; закреплённый UI-артефакт и frontend gateway не менялись. Уточнена граница серверного контракта и UI owner. |

## Что выяснили

Причина freshness — один новый коммит в общих areas, а не изменение всех
перечисленных подсистем. Дополнены описания реально изменившегося поведения;
для остальных тем подтверждено отсутствие изменения их контрактов.
Исторические разделы извлечённых owner-компонентов проверялись в части Core
integration; новые свойства внешних реализаций не заявляются.

## Куда занесено

- shared.md, protocol.md, image-retouch.md, llm.md, machines.md, ui.md,
  features/llm-runners.md — поведение FS-2.
- Все 21 тема из ошибки — отметки сверки через KB CLI.
- README.md — индекс через kb:index.

## Проверки

Для исправления документации: kb:index, kb:check --strict, git diff --check.
Полный гейт повторяет workflow. Исходный код и команда гейта не изменены.
