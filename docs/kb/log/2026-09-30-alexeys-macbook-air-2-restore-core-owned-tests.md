---
title: restore-core-owned-tests
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Тесты ядра, ушедшие вместе с канбаном

## Изменение

- При удалении встроенного канбана (PR #276) вместе с тестами кластера ушли проверки кода самого
  ядра. Возвращены: `projectMainRefresh.test.ts` (синхронизация общей копии проекта),
  `routes/rest.conversationProject.test.ts` (удаление машины, адрес превью и статус разговора,
  разговор в проекте), `kanbanBridge/eventsDelivery.test.ts` (WS-доставка событий канбана:
  доска только участнику и без снапшота, приглашение адресно, смена состава двумя кадрами).
- Тесты кластера перенесены в `sislexa-kanban` (ветка `test/port-core-kanban-tests`).

## Осталось

- e2e `projects` и `gitPane` без стенда с канбаном не запускаются ни в одном репозитории.
