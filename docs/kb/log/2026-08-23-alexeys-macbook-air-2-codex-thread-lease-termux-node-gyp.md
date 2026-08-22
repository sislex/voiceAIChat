---
title: codex-thread-lease-termux-node-gyp
date: 2026-08-23
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# codex-thread-lease-termux-node-gyp

## Что сделано

- Зафиксирована эксклюзивная аренда resumed Codex thread и отдельный безопасный конфликт HTTP-клиента.
- Уточнено окружение сборки нативных npm-модулей в Android/Termux.

## Что выяснили (факты, которых не было в KB)

- Аренда снимается только владельцем после окончательной смерти/ошибки процесса, но не сразу по SIGTERM.
- `commandEnv` сохраняет пользовательские `GYP_DEFINES`, не заменяет заданный `android_ndk_path`, а корневой `.npmrc` задаёт `nodedir=${PREFIX}`.

## Куда занесено

- `docs/kb/llm.md`
- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Нет.
