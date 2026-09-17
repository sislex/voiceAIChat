---
title: development-preview
date: 2026-09-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# development-preview

## Что сделано

- Добавлена отдельная тема о managed development preview: настройки, Docker-изоляция, scoped LLM grant, browser evidence, failure policy и очистка.
- В корневой карте знаний добавлен прямой указатель на тему.

## Что выяснили (факты, которых не было в KB)

- Preview снимает точный текущий worktree, поднимает отдельные Compose project и SQLite volume и выпускает ограниченный grant только на text-only Claude generation.
- Успех browser-check подтверждает только trusted Reader evidence, привязанное к URL, SHA и config digest; текст модели доказательством не считается.
- Политика continue сохраняет model_work, typecheck и tests при исчерпанных инфраструктурных попытках, а block запрещает успешное завершение.

## Куда занесено

- docs/kb/features/development-preview.md
- AGENTS.md

## Открытые вопросы / что осталось

- Codex preview generation остаётся закрыт до появления проверенного tool-free запуска.
