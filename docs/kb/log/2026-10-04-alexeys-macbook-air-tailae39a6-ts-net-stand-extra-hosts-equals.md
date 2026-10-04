---
title: stand-extra-hosts-equals
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-extra-hosts-equals

## Что сделано

- Проверка модуля стенда принимает запись `extra_hosts` в обеих формах Compose: `host.docker.internal:host-gateway`
  и `host.docker.internal=host-gateway`.

## Что выяснили (факты, которых не было в KB)

- U03 на 0.1.380: снимок прода перенёсся и восстановился, основной стенд на M1 поднялся и прошёл проверку
  здоровья. Упал модуль Make на Маке: Docker Desktop выводит `extra_hosts` через `=`, и шаг `config`
  отвергал модель с ошибкой `missing Docker host gateway`.

## Куда занесено

- docs/kb/deploy.md — раздел о модулях стенда на второй машине.

## Открытые вопросы / что осталось

- Релиз, деплой и повтор U03.
