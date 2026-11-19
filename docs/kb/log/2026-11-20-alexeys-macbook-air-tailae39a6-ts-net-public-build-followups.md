---
title: public-build-followups
date: 2026-11-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-build-followups

## Что сделано

- Нераспознанная ошибка сервиса хранилища больше не превращается в `node_unavailable`: Core отдаёт `storage_unavailable` с текстом сервиса.
- Событие `claude.queue` несёт `pauseReason: 'accounting'`, когда очередь ждёт расчёта стоимости прошлого ответа.
- `npm run public:limit -- --usd <$>` меняет дневной лимит в `.env` и в сохранённой политике Billing вместе; сборка задаёт `BILLING_DAILY_POLICY_REPLACE=1` (Billing #15).
- Хранилище минимальной сборки читает токен Core → Identity прямо из каталога `outgoing` Core; ротация перезапускает все контейнеры проекта, которые монтируют продлённый каталог.

## Что выяснили (факты, которых не было в KB)

- Сервис хранилища читает файлы токенов один раз при старте, поэтому после ротации его нужно перезапускать.
- Billing намеренно отказывается стартовать с другой дневной политикой (защита от устаревшего процесса при нескольких Billing на одной базе).

## Куда занесено

- docs/kb/deploy.md, deploy/public/README.md

## Открытые вопросы / что осталось

- Для Docker-сборки флаг `BILLING_DAILY_POLICY_REPLACE` заработает после выпуска Billing с #15 и пина образа.
