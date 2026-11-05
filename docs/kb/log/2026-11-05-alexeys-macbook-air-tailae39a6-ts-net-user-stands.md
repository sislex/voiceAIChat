---
title: user-stands
date: 2026-11-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# user-stands

## Что сделано

- Ядро реализует `userStand` для библиотеки стендов Make: стенды пользователя без проекта (папка, команда, порт на своей или расшаренной машине), запуск/статус/остановка, файлы внутри папки, превью через StandProxy с id `us-<machineId>-<port>`.

## Что выяснили (факты, которых не было в KB)

- Доступные пользователю машины вне проекта — свои плюс расшаренные в любой проект, где он действующий участник (`listUserMachineAccess`); share `read` не даёт запуск и запись.

## Куда занесено

- docs/kb/server-internals.md (раздел «User stands (Make stands library)»)

## Открытые вопросы / что осталось

- После закрепления make-contracts 1.8.16 убрать локальную схему `userStand` из `coreRpc.ts` и локальные типы из `userStand.ts`.
