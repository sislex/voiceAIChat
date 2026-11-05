---
title: external-stand-origin-rewrite
date: 2026-11-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# external-stand-origin-rewrite

## Что сделано

- Прокси внешнего стенда подменяет адрес стенда на адрес аренды в текстовых ответах (HTML, JSON, JS, CSS, text/*), включая gzip/br/deflate, протокол-относительные, экранированные и ws/wss формы.
- Access-Control-Allow-Origin и CSP с адресом стенда тоже переписываются.

## Что выяснили (факты, которых не было в KB)

- Angular-приложение стенда берёт абсолютные адреса API из assets/config.json, поэтому вход шёл напрямую на стенд и падал на CORS.

## Куда занесено

- docs/kb/server-internals.md (External stands)

## Открытые вопросы / что осталось

- Ответы больше 10 МиБ и бинарные типы не переписываются.
