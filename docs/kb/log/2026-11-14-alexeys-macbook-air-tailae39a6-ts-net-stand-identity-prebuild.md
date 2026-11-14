---
title: stand-identity-prebuild
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-identity-prebuild

## Что сделано

- `stand:create` собирает страницы входа и аккаунта Identity (`build:ui`) в свежем клоне; без них сервер Identity не стартует. Core пишет в журнал причину неудачного запуска API моделей.

## Что выяснили (факты, которых не было в KB)

- Раннер принимает учётный контекст с атрибуцией приложения (tokenId) только от сервисного токена приложения `core`; с мастер-токеном запуск API моделей падает `invalid_accounting_context`.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

-
