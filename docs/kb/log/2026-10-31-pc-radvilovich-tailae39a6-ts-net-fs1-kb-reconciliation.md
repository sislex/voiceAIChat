---
title: fs1-kb-reconciliation
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# fs1-kb-reconciliation

## Что сделано

- Сверены темы из строгой проверки с diff их areas от checked до HEAD. Отметки обновлены через KB CLI, без исключений из проверки.
- Дополнены shared.md (контракт хранилища), deploy.md (Docker target и два узла), glossary.md (сервис и диагностические маркеры).

## Доказательства сверки по темам

| Тема | Изменения в areas после checked и результат |
| --- | --- |
| conversation-groups | types.ts и protocol.ts: только optional storage у вложений; модель групп и REST не менялись. |
| data-auth | types.ts: только MessageAttachment.storage; авторизация и SQL без изменений. |
| deploy | Dockerfile: отдельный file-storage-node; affected-check.test.mjs: новый пакет и изоляция BASE_BRANCH; docker-compose.yml: обновлён pin Kanban. Сверены node/main.ts, node/server.ts и compose.file-storage.example.yml; описание запуска дополнено. |
| features/feature-preview | Dockerfile: добавлен отдельный storage target; существующие preview targets не изменены. |
| features/kanban-assistant | protocol.ts: только UploadInfo.storage, без изменений widget/assistant протокола. |
| features/manual-qa | protocol.ts: только UploadInfo.storage, без изменений QA. |
| features/merge-runner | protocol.ts: только UploadInfo.storage, без изменений merge-контракта. |
| features/playwright-reader | types.ts: только MessageAttachment.storage; browser bridge и routes не изменены. |
| glossary | applicationCatalog.ts: сервис file-storage; task-gate.mjs: повтор ошибок в конце отчёта. Определения дополнены. |
| image-retouch | types.ts и protocol.ts: optional storage; обработчики ретуши не менялись, автоматическая интеграция хранилища не заявлена. |
| llm | protocol.ts: только UploadInfo.storage; LLM execution без изменений. |
| machines | protocol.ts: только UploadInfo.storage; файловый API агента без изменений. |
| projects | types.ts: только MessageAttachment.storage; проектный workflow без изменений. |
| shared | Прочитан fileStorage.ts: типы, REST/node paths, квоты, права, placement; проверены re-export, optional поля и applicationCatalog.ts. Описание дополнено. |
| ui | types.ts и protocol.ts: только optional storage; Core UI integration без изменений. |
| agent-api-access | Дополнительно выявлена локальным strict check: protocol.ts содержит только UploadInfo.storage; API token routes и интеграционные тесты не менялись. |

## Что выяснили (факты, которых не было в KB)

- Shared экспортирует storage-контракт и optional StorageFileRef у вложений; каталог регистрирует отдельный сервис без build/deploy isolation.
- Docker example использует два отдельных тома и token-файла, 10/60 GB и loopback-порты 8795/8796; это пример, не включение в production.

## Куда занесено

- docs/kb/shared.md, docs/kb/deploy.md, docs/kb/glossary.md.

## Открытые вопросы / что осталось

- Полный гейт повторяет workflow. В этом ходе менялась только документация и выполнялась строгая проверка KB.
