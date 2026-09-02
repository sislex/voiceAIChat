---
title: wake-lock
date: 2026-09-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# wake-lock

## Что сделано

- Зафиксирован process-scoped wake lock компаньон-агента на macOS и Android/Termux, включая lifecycle при остановке и самообновлении.
- Описана подготовка Termux:API установщиком и обновлена каноническая версия агента до 0.16.0.

## Что выяснили (факты, которых не было в KB)

- Wake lock получает только процесс, победивший single-instance lock; ошибки платформенных команд не препятствуют подключению.
- macOS использует `caffeinate -i -w <pid>`, Termux — парные `termux-wake-lock`/`termux-wake-unlock`; Linux вне Termux и Windows команд не запускают.
- При обновлении старый экземпляр освобождает wake lock до запуска нового владельца.

## Куда занесено

- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Нет.
