---
title: files-snapshot-disk-incident
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# files-snapshot-disk-incident

## Что сделано

- `environment-files-snapshot.sh`: `docker run --log-driver none` для потока архива и проверка
  свободного места (кажущийся размер тома + запас 1 ГиБ или 10 %) до записи.

## Что выяснили (факты, которых не было в KB)

- Инцидент 2026-10-04 ~23:38 UTC: U04 `migrate` (том `voicechat-server-data`, 6,1 ГиБ) заполнил диск
  прода до 100 %: архив писался в файл и одновременно, через stdout контейнера, в JSON-журнал Docker.
  Postgres прода: одна ошибка `could not extend file "base/16384/36921": No space left on device`;
  Kanban перезапустился, миграция прервана («Migration interrupted by Kanban restart»), архив удалён
  скриптом, через несколько минут свободно снова 12 ГиБ, все контейнеры прода работают.

## Куда занесено

- docs/kb/deploy.md — снимок тома файлов.

## Открытые вопросы / что осталось

- Повтор `migrate` только после выпуска исправления и обновления production-checkout окружений.
