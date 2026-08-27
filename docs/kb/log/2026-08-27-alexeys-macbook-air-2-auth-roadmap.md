---
title: auth-roadmap
date: 2026-08-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# auth-roadmap

## Что сделано

-

## Что выяснили (факты, которых не было в KB)

-

## Куда занесено

- docs/kb/…

## Открытые вопросы / что осталось

-

П.1 (auth-roadmap): rate-limit входа 10/10 мин по IP и имени, 429 + Retry-After.
П.2 (auth-roadmap): политика пароля (10+, не пустой, не логин, не частый) + опциональный HIBP.
П.3 (auth-roadmap): блокировка после неудач (5 → замок 15 мин/423, 10 → blocked auto), бейджи в админке.
П.4 (auth-roadmap): таблица сессий с TTL/отзывом, «выйти везде», список в админке и диалог устройств.
