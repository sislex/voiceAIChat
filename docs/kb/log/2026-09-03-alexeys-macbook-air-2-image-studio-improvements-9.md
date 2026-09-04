---
title: image-studio-improvements-9
date: 2026-09-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio-improvements-9

## Что сделано

- Итерация 9: пагинация сетки (60 + «Показать ещё»), счётчик найденного,
  «Промпты в буфер», свайп и метрики в лайтбоксе, подсказка при долгой
  генерации, «Повторить» в баннере ошибки (захваченный launch), aria-busy.

## Что выяснили (факты, которых не было в KB)

- Electron-десктопу отдельные imgstudio-мосты не нужны: renderer ставит
  installRemoteBridges из @voicechat/ui (та же httpApi, что и web).

## Куда занесено

- docs/kb/ui.md — раздел «Студия картинок», абзац «Итерация 9»

## Открытые вопросы / что осталось

- Цикл продолжается: итерация 10 по /loop.
