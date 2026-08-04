---
title: image-history-prompt
date: 2026-08-04
machine: 2470-com
author: alexeyrozhnov
---

# image-history-prompt

## Что сделано

- Актуализирована тема о пересборке prompt: служебные изображения AI-ответа исключаются из повторно собранной истории.

## Что выяснили (факты, которых не было в KB)

- `buildConversationPrompt` очищает через `parseImages` только AI-реплики; корректные fenced-блоки `image` и локальные markdown-картинки остаются метаданными UI, а inline data-URL не меняются.

## Куда занесено

- `docs/kb/server-internals.md`, раздел «Uploads и файлы».

## Открытые вопросы / что осталось

- Нет.
