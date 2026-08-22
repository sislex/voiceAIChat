---
title: managed-storage-integration
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# managed-storage-integration

## Что сделано

- Сверена и актуализирована тема постоянного MachineStorage после полного перехода новых файловых сценариев на управляемые пути.

## Что выяснили (факты, которых не было в KB)

- Привязка чата лениво создаёт каталоги чата, проекта, задачи и production/staging/test environments; новые вложения идут в `attachments` выбранного storage, а CI-workspace — в task-test `temporary/repository`.
- Без настроенного storage сохраняются legacy `.voicechat_uploads` и `project_machines.reposRoot`; автоматического переноса или удаления старых данных нет.

## Куда занесено

- `docs/kb/machines.md#постоянное-хранилище-машины`

## Открытые вопросы / что осталось

- Production-transfer, мастер миграции, preview lifecycle, TTL созданных файлов и manifests ранов остаются отдельными последующими срезами.
