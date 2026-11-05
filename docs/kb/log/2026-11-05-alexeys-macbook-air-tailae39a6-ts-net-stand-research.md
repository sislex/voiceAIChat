---
title: stand-research
date: 2026-11-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-research

## Что сделано

- Операция `userStand { op: 'research' }` для инструментов исследования стендов Make: безголовая сессия browser-runner на беседу, вкладка на стенд, команда раннера `research`.
- Тело внутреннего RPC Make → Core увеличено до 4 МиБ (файлы стенда 2 МиБ в base64).

## Что выяснили (факты, которых не было в KB)

- Без увеличения тела RPC запись файла стенда в автономном Make ограничивалась ~1 МиБ (лимит Fastify по умолчанию).

## Куда занесено

- docs/kb/server-internals.md (User stands → Stand research)

## Открытые вопросы / что осталось

- Локальные стенды на серверном развёртывании (через прокси стендов) в исследование не включены.
