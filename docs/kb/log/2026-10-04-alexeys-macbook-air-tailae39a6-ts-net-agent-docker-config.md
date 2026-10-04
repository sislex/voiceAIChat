---
title: agent-docker-config
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# agent-docker-config

## Что сделано

- Агенту на Mac задан собственный `DOCKER_CONFIG` с входом в GHCR по токену только на чтение пакетов; агент
  перезапущен, получение манифеста закрытого образа через агента работает.

## Что выяснили (факты, которых не было в KB)

- Под launchd `credsStore: desktop` Docker Desktop зависает на `docker-credential-desktop get`, и агент
  не может скачать закрытые образы GHCR (U03: `docker pull` make-api висел 50 минут).

## Куда занесено

- docs/kb/deploy.md — модули стенда на второй машине.

## Открытые вопросы / что осталось

- Постоянное решение без токена на машине — короткоживущие токены от ядра (следующий этап).
