---
title: release-center-cycle-8
date: 2026-09-17
machine: pc-radvilovich
author: voiceAIChat agent
---

# release-center-cycle-8

## Что сделано

- Добавлены состав релиза и сравнение двух выпусков, подтверждение deploy, JSON-экспорт, мобильная sticky-панель и объявления статуса.
- Добавлены уведомления владельца и архивирование старых failed-подготовок без удаления веток.

## Что выяснили (факты, которых не было в KB)

- Колокольчик использует общий снимок `tasks:listPreparationNotifications`; release-уведомления включены в него через таблицу `release_notifications` и тот же WS invalidate.
- Production SHA берётся из последней успешной deploy-попытки, а отсутствие production представлено `changes:null`, не пустым массивом.

## Куда занесено

- docs/kb/features/releases.md, docs/kb/protocol.md

## Открытые вопросы / что осталось

- Нет.
