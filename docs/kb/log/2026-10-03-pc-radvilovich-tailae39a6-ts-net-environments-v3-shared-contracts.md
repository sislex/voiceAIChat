---
title: environments-v3-shared-contracts
date: 2026-10-03
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# environments-v3-shared-contracts

## Что сделано

- Добавлены environments-v3, внешние задачи и integration-token контракты Shared.
- Подготовлены тесты parser-ветвей и полного отображения состояний внешних задач.
- Контракт выпуска обновлён до `@voicechat/shared` 0.1.16.

## Что выяснили (факты, которых не было в KB)

- Размещение задаётся необязательным `ModuleSelection.machineId`; отсутствие означает основную машину.
- Секрет integration token не входит в view и возвращается потребителем только при создании.

## Куда занесено

- docs/kb/shared.md

## Открытые вопросы / что осталось

- Реализация хранения и маршрутов остаётся в последующих задачах владельцев Core и Kanban.
