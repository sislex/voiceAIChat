---
title: deploy-400-poisoned-manifest
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# deploy-400-poisoned-manifest

## Что сделано

- Диагностирован `POST /api/projects/:id/releases/deploy → 400` на сервере
  89.125.68.35 (проект ChatAI, managed production). Корень: managed preflight
  падал на сравнении `environment.json`. Файл на диске был в generic-форме
  (`taskId:null`, без `machineId`/`storageId`, `createdAt=now`), не совпадающей
  с манифестом resolver-а (identity + `createdAt`=project.createdAt).
- Виновник — `ensureManagedChat` (routes/agents.ts, триггер `PUT /api/conversations/:id/storage`):
  storage-bootstrap чата стамповал `environment.json` во всех managed-каталогах
  через `writeJsonIfMissing`, пере-отравляя каталог уже после managed-миграции;
  релиз-менеджер существующий файл не перезаписывает (`if [ ! -e ]`).
- Код-фикс: bootstrap больше не пишет `environment.json` (только каталоги);
  манифест принадлежит релиз/preview-менеджерам. Тест — rest.test.ts. Коммит 105ddfbd.
- Прод-фикс: восстановил `environment.json` production в форму resolver-а
  (identity + createdAt=project.createdAt), кривой сохранён как `.poisoned-bak`;
  preflight-сравнение подтверждено вручную (MATCH).
- Собран релиз 0.1.130 из main (с фиксом) и задеплоен (см. отдельную проверку).

## Что выяснили (факты, которых не было в KB)

- `codex login status`-аналог для preflight: `codex ...` не при чём — здесь
  важно, что preflight сравнивает manifest ПОБАЙТОВО (whitespace вырезается),
  поэтому даже семантически-эквивалентный, но иной по составу манифест валит deploy.
- Минт админ-токена на сервере: `signToken`+`loadOrCreateSecret('/data')` из
  `apps/server/src/users/accounts.ts` через `npx tsx` в контейнере — для вызова
  REST от имени владельца без пароля.
- Формат версий релиза: `release/x.y.z`; следующий после 0.1.129 — 0.1.130.

## Куда занесено

- docs/kb/features/releases.md — «Инцидент 2026-08-25» в разделе «Защищённая публикация».

## Открытые вопросы / что осталось

- staging-каталог мог быть отравлен тем же bootstrap — при первом deploy staging
  проверить его environment.json (в этот раз чинил только production).
