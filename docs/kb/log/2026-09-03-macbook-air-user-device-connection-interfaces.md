---
title: device-connection-interfaces
date: 2026-09-03
machine: macbook-air-user
author: NikolayTola
---

# device-connection-interfaces

## Что сделано

- Сверены интерфейсы подключения устройства и их production-контракты; дополнена тема клиентов.

## Что выяснили (факты, которых не было в KB)

- Web-диалог использует `loginApplication:artifacts`, `loginApplication:issueEnrollment` и `loginApplication:enrollmentStatus`; desktop renderer ограничен preload-операциями `configured` и `addCurrentDevice` и очищает пароль.

## Куда занесено

- `docs/kb/clients.md`

## Открытые вопросы / что осталось

- Нет.
