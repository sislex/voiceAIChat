---
title: conversation-groups
date: 2026-09-28
machine: macbook-air-user
author: NikolayTola
---

# conversation-groups

## Что сделано

- Добавлены публичные контракты, REST API, SQLite/PostgreSQL schema и ChatRepo для пользовательских групп, множественного членства и архива.
- Добавлены API, repository, schema и consumer-contract регрессии с обязательными test-case markers.

## Что выяснили (факты, которых не было в KB)

- Core владеет контрактом, transport и persistence групп; responsive group rail, store и DOM/Component QA принадлежат `sislex/sislexa-core-ui`.
- Системные выборки используют стабильные идентификаторы `all` и `archive`, но не хранятся как пользовательские строки.
- Архивирование и очистка membership выполняются одной транзакцией; разархивирование не восстанавливает прежние связи.

## Куда занесено

- `docs/kb/ui.md`, раздел `Core UI owner and consumer boundary`.

## Открытые вопросы / что осталось

- UI-owner должен принять обновлённый Core contract artifact и реализовать/проверить group rail в собственном репозитории.
