---
title: sisl-853-universal-search-repeat-race
date: 2026-11-03
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# sisl-853-universal-search-repeat-race

## Что сделано

- Повторный запрос в открытой палитре теперь предваряется завершённым запросом
  с отдельным reset-query, после чего observer ставится для целевого query.
- Добавлена проверка точного порядка reset-query → requested-query.
- Acceptance-режим сохраняет отдельные результаты 20 последовательных полных
  прогонов universalSearch без retries.

## Что выяснили (факты, которых не было в KB)

- Простое `fill('')` перед немедленным восстановлением прежнего query не является
  барьером клиентского поколения: React может схлопнуть переход, а отложенный
  debounce прежнего поколения может попасть в новый observer.

## Куда занесено

- docs/kb/testing-operations.md#universal-search-browser-synchronization

## Открытые вопросы / что осталось

- Browser-проверка в worker sandbox требует уже установленного Playwright
  Chromium; download недоступен. Полные 20 прогонов выполняет supervisor gate.
