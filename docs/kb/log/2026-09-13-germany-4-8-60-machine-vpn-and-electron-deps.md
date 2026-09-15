---
title: machine-vpn-and-electron-deps
date: 2026-09-13
machine: germany-4-8-60
author: unknown
---

# machine-vpn-and-electron-deps

## Что сделано

- Сверена реализация управления Tailscale VPN и её проверки с рабочей копией.
- Сверена отдельная установка зависимостей Electron-приложений.

## Что выяснили (факты, которых не было в KB)

- VPN использует отдельный протокол агент–сервер, зашифрованные административные данные, персистентные переходы и привилегированный guard для Linux/macOS; реальные сетевые проверки остаются opt-in.
- Desktop, Agent Tray и Login application имеют собственные lockfile и требуют отдельного `npm ci --prefix apps/<application>`.

## Куда занесено

- `docs/kb/machines.md`
- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Реальная матрица сетевой защиты VPN и сценарии отказа шлюза не запускались в этом KB-ходе.
