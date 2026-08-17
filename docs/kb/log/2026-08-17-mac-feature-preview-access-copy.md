---
title: feature-preview-access-copy
date: 2026-08-17
machine: mac
author: alexeyrozhnov
---

# feature-preview-access-copy

## Что сделано

Актуализирован доступ к локальным и удалённым feature-preview и поведение копирования ручной SSH-команды.

## Что выяснили (факты, которых не было в KB)

Локальность определяется точным совпадением ID preview-agent и companion-agent текущего устройства. Ручной SSH fallback использует только явно сохранённые SSH hostname/IP и пользователя машины проекта, а app и Storybook — собственные host-порты. Копирование идёт через общий helper с Clipboard API и textarea fallback; компонент защищён от повторных и устаревших async-обновлений.

## Куда занесено

`docs/kb/features/feature-preview.md`.

## Открытые вопросы / что осталось

Нет.
