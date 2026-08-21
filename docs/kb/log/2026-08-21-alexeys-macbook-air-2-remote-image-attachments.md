---
title: remote-image-attachments
date: 2026-08-21
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# remote-image-attachments

## Что сделано

Актуализировано описание загрузки и передачи изображений с выбранной удалённой машины в LLM-runner и `remote:image`.

## Что выяснили (факты, которых не было в KB)

Удалённое вложение передаётся как `LlmAttachment` с `preserveServerPath=true`: runner сохраняет путь машины в prompt, а отдельную временную копию предоставляет CLI для визуального анализа только на время рана.

## Куда занесено

`docs/kb/server-internals.md`, раздел «Uploads и файлы», и `docs/kb/image-retouch.md`, раздел «Доверенная граница и обработка».

## Открытые вопросы / что осталось

Нет.
