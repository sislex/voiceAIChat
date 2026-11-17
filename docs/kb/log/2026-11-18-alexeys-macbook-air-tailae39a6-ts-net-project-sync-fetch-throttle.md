---
title: project-sync-fetch-throttle
date: 2026-11-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# project-sync-fetch-throttle

## Что сделано

- Синхронизация общей копии проекта перед ходом обращается к GitHub не чаще раза в две минуты; локальные проверки копии остались на каждом ходу.

## Что выяснили (факты, которых не было в KB)

- 9–11 с задержки хода в Workspace на проде давал `git fetch` на машине проекта перед каждым ходом (6,3 с + 2,3 с с повтором), сам CLI отрабатывал за 1,7 с.

## Куда занесено

- docs/kb/server-internals.md — «Project copy sync before a turn: the fetch is throttled»

## Открытые вопросы / что осталось

-
