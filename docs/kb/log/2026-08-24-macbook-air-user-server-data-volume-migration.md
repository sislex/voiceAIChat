---
title: server-data-volume-migration
date: 2026-08-24
machine: macbook-air-user
author: NikolayTola
---

# server-data-volume-migration

## Что сделано

- Сверено и зафиксировано поведение безопасной миграции server data перед production deploy.

## Что выяснили (факты, которых не было в KB)

- `/data` закреплён за томом `voicechat-server-data`, независимым от Compose project name.
- Пустой канонический том принимает данные только из единственного непустого legacy-тома `vc-data`: после проверки обязательного комплекта, создания проверенного архива и повторной валидации копии.
- Неполные данные, конкурирующие источники и любая ошибка останавливают deploy до `docker compose up`.

## Куда занесено

- `docs/kb/deploy.md`

## Открытые вопросы / что осталось

- Нет.
