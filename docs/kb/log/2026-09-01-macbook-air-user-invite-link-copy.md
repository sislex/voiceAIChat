---
title: invite-link-copy
date: 2026-09-01
machine: macbook-air-user
author: NikolayTola
---

# invite-link-copy

## Что сделано

- Дополнена тема Administration актуальным поведением формирования и копирования инвайт-ссылок.

## Что выяснили (факты, которых не было в KB)

- Host передаёт абсолютную базу из origin и pathname, а `InvitesPanel` добавляет hash-маршрут с URL-encoded токеном.
- Clipboard API имеет DOM-fallback; успех и ошибка отражаются только у соответствующего инвайта.

## Куда занесено

- `docs/kb/admin-app.md`

## Открытые вопросы / что осталось

- Нет.
