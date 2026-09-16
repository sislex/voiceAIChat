---
title: chat-473-route-budgets-kb
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-473-route-budgets-kb

## Что сделано

- Уточнены знания о полном initial route cost, причине ранней загрузки Monaco, восстановлении после ошибки чанка и безопасной нормализации DevelopmentReadiness.

## Что выяснили (факты, которых не было в KB)

- Initial — уникальные наблюдавшиеся JS/CSS плюс полное статическое замыкание; неполное наблюдение отклоняется.
- Vite preload helper создавал статическое ребро к Monaco; runtime helpers перенесены в React chunk.
- После трёх локальных повторов доступно только явное обновление с HTTP preflight, session guard и veto для несохранённого chat draft/attachments.
- Разрешены только два точных нейтральных префикса и целая JSON-ограда перед полной строгой проверкой.

## Куда занесено

- docs/kb/testing-operations.md
- docs/kb/ui.md
- docs/kb/features/task-preparation.md

## Открытые вопросы / что осталось

- Нет.
