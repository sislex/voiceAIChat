---
title: android-termux-native-modules
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# android-termux-native-modules

## Что сделано

- Актуализирована тема машин после изменений установки и обновления Android/Termux-агента.

## Что выяснили (факты, которых не было в KB)

- Установщик ставит toolchain и проверяет его установкой и загрузкой `better-sqlite3@11.10.0` с операцией над in-memory БД.
- Агент добавляет `GYP_DEFINES=android_ndk_path=$PREFIX` ко всем exec- и PTY-командам в Termux, не меняя проектные `npm ci` и `.npmrc`.

## Куда занесено

- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Нет.
