---
title: machine-storage
date: 2026-08-21
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machine-storage

## Что сделано

- Уточнён действующий первый срез постоянного хранилища машин и чатов.

## Что выяснили (факты, которых не было в KB)

- Сервер создаёт только минимальную `.voicechat`, а полное дерево проектов и окружений пока не материализует.
- Shared-контракт уже задаёт переносимые рекомендуемые пути production, staging и task-test окружений.

## Куда занесено

- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Production/task-preview lifecycle и безопасный перенос постоянных данных ещё не реализованы.
