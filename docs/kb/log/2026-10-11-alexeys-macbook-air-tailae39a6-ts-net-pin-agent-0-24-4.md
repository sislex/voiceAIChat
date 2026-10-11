---
title: pin-agent-0-24-4
date: 2026-10-11
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-agent-0-24-4

## Что сделано

- Закреплён агент 0.24.4 (`vendor/sislexa-agent-0.24.4-98267387ecfc.tgz`, ссылки в `package.json` корня и
  `apps/server`, lock). Контракты остаются 1.4.2 без изменений.

## Что выяснили (факты, которых не было в KB)

- Восстановление dev-процессов агентом 0.24.3 после перезапуска не работало: сохранённый PID — `npm run …`,
  npm переписывает заголовок процесса и затирает блок argv/environ, поэтому `ps -E` (macOS) и
  `/proc/<pid>/environ` (Linux) не показывают маркер лидера. 0.24.4 читает маркер у остальной группы процессов.
- После `npm ci --ignore-scripts` в клоне Core тесты сервера падают на `better-sqlite3` («Could not locate the
  bindings file») — нужен `npm rebuild better-sqlite3`.

## Куда занесено

- docs/kb/deploy.md — абзац о закреплённом агенте.

## Открытые вопросы / что осталось

- Стенды, чьи записи реестра потеряны при неудачном восстановлении, по-прежнему чинятся вручную (убить сирот,
  пересоздать стенд).
