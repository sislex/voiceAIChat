---
title: remove-preparation-polling
date: 2026-08-24
machine: mac
author: alexeyrozhnov
---

# Удалён polling истории подготовки

## Что сделано

- Зафиксирована адресная синхронизация истории preparation-run через WebSocket, debounce, reconnect и пользовательские мутации без интервала polling.
- Обновлена свежесть затронутых тем и перегенерирован индекс базы знаний.

## Что выяснили (факты, которых не было в KB)

- На MacBook активный Homebrew Git искал credential helper в нестандартном exec-path без `git-credential-osxkeychain`; абсолютный путь к системному helper восстановил HTTPS push.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/projects.md`
- `docs/kb/shared.md`

## Открытые вопросы / что осталось

- Нет.
