---
title: accessibility-performance-kb
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accessibility-performance-kb

## Что сделано

- Уточнены источники истины для focus trap, скрытых панелей, live-регионов и visibility-aware polling.
- Зафиксирована подготовка зависимостей трёх Electron-приложений вне root workspaces.

## Что выяснили (факты, которых не было в KB)

- Settings metadata больше не импортирует ленивый SettingsModal; ReleaseCenter также загружается лениво, а три чанка защищены production-бюджетами.
- Дополнительные серверные таймеры перенесены на общий usePolling; Sessions не дублирует refresh, когда видимостью управляет host.
- PopupFrame использует общий focus trap, `[hidden]` исключает скрытые панели из Tab, а каждый toast сам владеет единственным объявлением.
- Root npm install намеренно не устанавливает Electron-зависимости desktop, agent-tray и login-application.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Ручная проверка VoiceOver/NVDA и device-level zoom остаётся отдельным аудитом.
