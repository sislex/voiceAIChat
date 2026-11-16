---
title: core-zombie-git-processes
date: 2026-11-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-zombie-git-processes

## Что сделано

- Сервис `voicechat` в Compose запускается с `init: true`; обновление баз знаний модулей вызывает git без фонового обслуживания.

## Что выяснили (факты, которых не было в KB)

- На проде контейнер Core за 43 часа накопил 9362 зомби-процесса git (72 каждые 10 минут), упёрся в `pids.max` и перестал запускать процессы; `docker exec` отвечал `procReady not received`, HTTP работал.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

-
