---
title: make-publish-lock-studio-11
date: 2026-09-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-publish-lock-studio-11

## Что сделано

- Починен флак публикации Make: withPublishLock сериализует publish/unpublish/
  countView на разговор; регрессионный тест переопубликации (red-check пройден).
- Студия, итерация 11: глобальные стрелки лайтбокса, «Править» и «Вариация»
  из вьюера, сториз вьюера.

## Что выяснили (факты, которых не было в KB)

- countView (fire-and-forget) с read-modify-write воскрешал публикацию после
  unpublish/publish — атомарный rename от lost-update не спасает (занесено в
  server-internals.md).

## Куда занесено

- docs/kb/server-internals.md — «Публикация Make: сериализация мутаций файла»
- docs/kb/ui.md — раздел «Студия картинок», абзац «Итерация 11»

## Открытые вопросы / что осталось

- Цикл продолжается: итерация 12 по /loop.
